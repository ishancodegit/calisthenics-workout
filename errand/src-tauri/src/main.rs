#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The desktop shell.
//!
//! Deliberately thin: every rule that protects the user's files lives in
//! `errand-core`, which is unit-tested on its own. What happens here is
//! plumbing — take a request from the webview, hand it to the core, hand the
//! answer back. The one thing this layer owns is that the sandbox is *its*
//! state, not the frontend's, so a confused or compromised webview cannot
//! widen its own access: it can only ask.

use errand_core::{
    apply, files, html_to_text, parse_csv, plan::Change, propose_organize, undo, Plan, Receipt,
    Sandbox, Scheme,
};
mod google;
mod net;
mod store;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Big enough for a long document, small enough not to blow an 8k context.
const MAX_READ_BYTES: usize = 40_000;
const MAX_PAGE_CHARS: usize = 20_000;

#[derive(Default)]
struct App {
    sandbox: Mutex<Sandbox>,
    /// Undo receipts, keyed by the token handed to the frontend.
    receipts: Mutex<HashMap<String, Receipt>>,
    next_token: Mutex<u64>,
}

/// What the frontend sees: a plan plus its plain-English preview.
#[derive(Serialize)]
struct PlanDto {
    summary: String,
    changes: Vec<Change>,
    preview: Vec<String>,
}

impl From<Plan> for PlanDto {
    fn from(plan: Plan) -> Self {
        PlanDto {
            preview: plan.preview(),
            summary: plan.summary,
            changes: plan.changes,
        }
    }
}

#[derive(Deserialize)]
struct PlanIn {
    summary: String,
    changes: Vec<Change>,
}

#[derive(Serialize)]
struct ReceiptDto {
    applied: usize,
    token: String,
}

#[derive(Serialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
    models: Vec<String>,
}

/// Errors reach the person as sentences, so this is just their text.
type Fallible<T> = Result<T, String>;

/* ------------------------------------------------------------------ */
/* Remembering which folders were granted                              */
/* ------------------------------------------------------------------ */

/// Granted folders survive a restart, because being asked to re-pick your
/// Downloads folder every launch would train people to click through the one
/// prompt that matters.
const FOLDERS_FILE: &str = "folders.json";
const SETTINGS_FILE: &str = "settings.json";

fn save_folders(app: &AppHandle, sandbox: &Sandbox) {
    let roots: Vec<String> = sandbox
        .roots()
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    store::write(app, FOLDERS_FILE, &roots);
}

/// Re-grant on startup. A folder since deleted or unmounted is dropped
/// silently rather than failing the launch — `grant` re-validates each one, so
/// a stale entry can never widen access.
fn load_folders(app: &AppHandle, sandbox: &mut Sandbox) {
    let saved: Vec<String> = store::read(app, FOLDERS_FILE);
    for folder in saved {
        let _ = sandbox.grant(folder);
    }
}

/// Which model was chosen, and the optional API key. Kept out of the webview's
/// localStorage so the key sits in one owner-only file alongside the Google
/// token, rather than in browser storage.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    model: String,
    #[serde(default)]
    api_key: String,
}

#[tauri::command]
fn load_settings(handle: AppHandle) -> Settings {
    store::read(&handle, SETTINGS_FILE)
}

#[tauri::command]
fn save_settings(settings: Settings, handle: AppHandle) {
    store::write(&handle, SETTINGS_FILE, &settings);
}

/* ------------------------------------------------------------------ */
/* Folder access                                                       */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn granted_folders(app: State<App>) -> Vec<String> {
    app.sandbox
        .lock()
        .unwrap()
        .roots()
        .iter()
        .map(|p| p.display().to_string())
        .collect()
}

/// Opens the OS folder picker. Access is granted by the act of choosing —
/// there is no way for the agent to add a folder on its own.
#[tauri::command]
async fn grant_folder(
    window: tauri::Window,
    handle: AppHandle,
    app: State<'_, App>,
) -> Fallible<Option<String>> {
    let chosen = window.dialog().file().blocking_pick_folder();
    let Some(picked) = chosen else {
        return Ok(None);
    };
    let path: PathBuf = picked
        .into_path()
        .map_err(|e| format!("Couldn't open that folder: {e}"))?;
    let granted = {
        let mut sandbox = app.sandbox.lock().unwrap();
        let granted = sandbox.grant(&path).map_err(|e| e.to_string())?;
        save_folders(&handle, &sandbox);
        granted
    };
    Ok(Some(granted.display().to_string()))
}

#[tauri::command]
fn revoke_folder(path: String, handle: AppHandle, app: State<App>) {
    let mut sandbox = app.sandbox.lock().unwrap();
    sandbox.revoke(path);
    save_folders(&handle, &sandbox);
}

/* ------------------------------------------------------------------ */
/* Looking at things                                                   */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn list_folder(folder: String, app: State<App>) -> Fallible<Vec<files::Entry>> {
    let sandbox = app.sandbox.lock().unwrap();
    files::list(&sandbox, folder).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_files(query: String, app: State<App>) -> Fallible<Vec<files::Entry>> {
    let sandbox = app.sandbox.lock().unwrap();
    files::search(&sandbox, &query, 100).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct FileText {
    text: String,
    truncated: bool,
}

#[tauri::command]
fn read_file(path: String, app: State<App>) -> Fallible<FileText> {
    let sandbox = app.sandbox.lock().unwrap();
    let (text, truncated) =
        files::read_text(&sandbox, path, MAX_READ_BYTES).map_err(|e| e.to_string())?;
    Ok(FileText { text, truncated })
}

#[tauri::command]
fn read_sheet(path: String, app: State<App>) -> Fallible<Vec<Vec<String>>> {
    let sandbox = app.sandbox.lock().unwrap();
    let (text, _) = files::read_text(&sandbox, path, MAX_READ_BYTES).map_err(|e| e.to_string())?;
    Ok(parse_csv(&text))
}

/// Fetching happens here rather than in the webview so the page can't run in
/// our origin, and so the CSP stays closed to everything but Ollama.
///
/// `net::fetch_public` refuses anything that isn't on the public internet —
/// see the reasoning there; it is what stops a prompt-injected email turning
/// this tool into an exfiltration channel.
#[tauri::command]
async fn read_web_page(url: String) -> Fallible<String> {
    let body = net::fetch_public(&url).await?;
    let mut text = html_to_text(&body);
    net::truncate_chars(&mut text, MAX_PAGE_CHARS);
    Ok(text)
}

/* ------------------------------------------------------------------ */
/* Changing things                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn propose_tidy(folder: String, by: String, app: State<App>) -> Fallible<PlanDto> {
    let scheme = if by == "by_month" {
        Scheme::ByMonth
    } else {
        Scheme::ByKind
    };
    let sandbox = app.sandbox.lock().unwrap();
    propose_organize(&sandbox, folder, scheme)
        .map(PlanDto::from)
        .map_err(|e| e.to_string())
}

/// Changes the model composed itself. They are still only a *proposal*: the
/// sandbox is re-checked when the plan is applied, not here.
#[tauri::command]
fn propose_changes(summary: String, changes: Vec<Change>) -> PlanDto {
    PlanDto::from(Plan::new(summary, changes))
}

#[tauri::command]
fn apply_plan(plan: PlanIn, app: State<App>) -> Fallible<ReceiptDto> {
    let sandbox = app.sandbox.lock().unwrap();
    let plan = Plan::new(plan.summary, plan.changes);
    let receipt = apply(&sandbox, &plan).map_err(|e| e.to_string())?;

    let mut counter = app.next_token.lock().unwrap();
    *counter += 1;
    let token = format!("r{counter}");

    let dto = ReceiptDto {
        applied: receipt.applied,
        token: token.clone(),
    };
    app.receipts.lock().unwrap().insert(token, receipt);
    Ok(dto)
}

#[tauri::command]
fn undo_plan(token: String, app: State<App>) -> Fallible<usize> {
    let receipt = app
        .receipts
        .lock()
        .unwrap()
        .remove(&token)
        .ok_or("There's nothing left to undo for that one.")?;
    undo(&receipt).map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ */
/* The local model                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
async fn ollama_status() -> OllamaStatus {
    let response = reqwest::Client::new()
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .await;

    let Ok(response) = response else {
        return OllamaStatus {
            installed: false,
            running: false,
            models: Vec::new(),
        };
    };
    let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    let models = body["models"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| m["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    OllamaStatus {
        installed: true,
        running: true,
        models,
    }
}

/// Downloading a model is a long job — several gigabytes, several minutes — so
/// the person needs to see it moving. Ollama streams NDJSON progress lines; we
/// forward them to the window as percentages and let the UI draw a bar.
/// Without this the app looks frozen at exactly the moment someone decides
/// whether to trust it.
#[derive(Clone, Serialize)]
struct PullProgress {
    model: String,
    /// 0-100, or -1 while Ollama is still working out what to fetch.
    percent: i32,
    /// Ollama's own wording, e.g. "pulling manifest", "verifying sha256".
    status: String,
    done: bool,
}

#[tauri::command]
async fn pull_model(model: String, handle: AppHandle) -> Fallible<()> {
    let response = reqwest::Client::new()
        .post("http://127.0.0.1:11434/api/pull")
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|_| "I couldn't reach Ollama. Is it open?".to_string())?;

    if !response.status().is_success() {
        return Err("That download didn't start. Check the name and try again.".into());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut last_percent = -2;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "The download was interrupted.".to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Ollama sends one JSON object per line, and a chunk can split a line
        // in half — so only parse up to the last newline and keep the rest.
        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue;
            };
            if let Some(error) = value["error"].as_str() {
                return Err(format!("The download failed: {error}"));
            }

            let completed = value["completed"].as_u64();
            let total = value["total"].as_u64().filter(|t| *t > 0);
            let percent = match (completed, total) {
                (Some(done), Some(total)) => ((done as f64 / total as f64) * 100.0) as i32,
                _ => -1,
            };
            let status = value["status"].as_str().unwrap_or("working").to_string();

            // Only emit on a real change, or the UI repaints hundreds of
            // times a second for a multi-gigabyte file.
            if percent != last_percent {
                last_percent = percent;
                let _ = handle.emit(
                    "pull-progress",
                    PullProgress {
                        model: model.clone(),
                        percent,
                        status,
                        done: false,
                    },
                );
            }
        }
    }

    let _ = handle.emit(
        "pull-progress",
        PullProgress {
            model: model.clone(),
            percent: 100,
            status: "ready".into(),
            done: true,
        },
    );
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Email and calendar                                                  */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
struct ConnectionStatus {
    /// False when the build has no Google client ID compiled in.
    available: bool,
    connected: bool,
    email: String,
}

#[tauri::command]
fn google_status(handle: AppHandle) -> ConnectionStatus {
    let account = google::load_account(&handle);
    ConnectionStatus {
        available: google::client_id().is_some(),
        connected: account.is_some(),
        email: account.map(|a| a.email).unwrap_or_default(),
    }
}

#[tauri::command]
async fn connect_google(handle: AppHandle) -> Fallible<String> {
    google::connect(handle).await
}

#[tauri::command]
fn disconnect_google(handle: AppHandle) {
    google::disconnect(&handle);
}

/// `query` uses Gmail's own search syntax, which the model is told about.
#[tauri::command]
async fn read_email(query: String, handle: AppHandle) -> Fallible<String> {
    let account = google::load_account(&handle)
        .ok_or("No email account is connected. Connect one in Settings.")?;
    google::list_email(&account, &query, 12).await
}

#[tauri::command]
async fn read_calendar(days: u32, handle: AppHandle) -> Fallible<String> {
    let account = google::load_account(&handle)
        .ok_or("No calendar is connected. Connect one in Settings.")?;
    google::list_events(&account, days).await
}

/* ------------------------------------------------------------------ */
/* Searching the web                                                   */
/* ------------------------------------------------------------------ */

/// No search API, so no per-search cost — see `errand_core::web`.
#[tauri::command]
async fn search_web(query: String) -> Fallible<String> {
    let response = reqwest::Client::new()
        .post("https://html.duckduckgo.com/html/")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", "Mozilla/5.0 (compatible; Errand/0.1)")
        .body(format!("q={}", errand_core::oauth::urlencode(&query)))
        .send()
        .await
        .map_err(|_| "I couldn't reach the search engine.".to_string())?;

    let body = response
        .text()
        .await
        .map_err(|_| "The search engine sent back nothing I could read.".to_string())?;

    let hits = errand_core::parse_results(&body, 8);
    if hits.is_empty() {
        return Ok("No results came back for that.".into());
    }
    Ok(hits
        .iter()
        .map(|h| format!("{}\n{}\n{}", h.title, h.url, h.snippet))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = App::default();
            load_folders(app.handle(), &mut state.sandbox.lock().unwrap());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            granted_folders,
            grant_folder,
            revoke_folder,
            list_folder,
            find_files,
            read_file,
            read_sheet,
            read_web_page,
            propose_tidy,
            propose_changes,
            apply_plan,
            undo_plan,
            ollama_status,
            pull_model,
            load_settings,
            save_settings,
            google_status,
            connect_google,
            disconnect_google,
            read_email,
            read_calendar,
            search_web,
        ])
        .run(tauri::generate_context!())
        .expect("Errand failed to start");
}
