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
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};
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
async fn grant_folder(window: tauri::Window, app: State<'_, App>) -> Fallible<Option<String>> {
    let chosen = window.dialog().file().blocking_pick_folder();
    let Some(picked) = chosen else {
        return Ok(None);
    };
    let path: PathBuf = picked
        .into_path()
        .map_err(|e| format!("Couldn't open that folder: {e}"))?;
    let granted = app
        .sandbox
        .lock()
        .unwrap()
        .grant(&path)
        .map_err(|e| e.to_string())?;
    Ok(Some(granted.display().to_string()))
}

#[tauri::command]
fn revoke_folder(path: String, app: State<App>) {
    app.sandbox.lock().unwrap().revoke(path);
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
#[tauri::command]
async fn read_web_page(url: String) -> Fallible<String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("That doesn't look like a web address.".into());
    }
    let response = reqwest::Client::new()
        .get(&url)
        .header("user-agent", "Errand/0.1")
        .send()
        .await
        .map_err(|_| "I couldn't open that page.".to_string())?;
    let body = response
        .text()
        .await
        .map_err(|_| "That page didn't send anything I could read.".to_string())?;
    let mut text = html_to_text(&body);
    text.truncate(MAX_PAGE_CHARS);
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

/// Downloading a model is a long job; Ollama streams progress, and we simply
/// wait for it to finish. The UI says so, because it can take minutes.
#[tauri::command]
async fn pull_model(model: String) -> Fallible<()> {
    let response = reqwest::Client::new()
        .post("http://127.0.0.1:11434/api/pull")
        .json(&serde_json::json!({ "model": model, "stream": false }))
        .send()
        .await
        .map_err(|_| "I couldn't reach Ollama. Is it open?".to_string())?;

    if !response.status().is_success() {
        return Err("That download didn't finish.".into());
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(App::default());
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
        ])
        .run(tauri::generate_context!())
        .expect("Errand failed to start");
}
