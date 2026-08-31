//! Connecting a Google account, read-only.
//!
//! Two deliberate limits. Scopes are read-only, so Errand can look at the
//! inbox and the calendar but cannot send, delete, or move anything — a 7B
//! model should never be one bad inference away from emailing someone's boss.
//! And there is no client secret, because an installed app cannot keep one:
//! this is the PKCE flow, with the exchange logic and its RFC test vectors in
//! `errand-core::oauth`.

use errand_core::oauth::{self, Pkce};
use errand_core::timefmt;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Public by design for installed apps. A shipped build bakes the vendor's ID
/// in at compile time; a developer build reads it from the environment.
pub fn client_id() -> Option<String> {
    option_env!("ERRAND_GOOGLE_CLIENT_ID")
        .map(str::to_string)
        .or_else(|| std::env::var("ERRAND_GOOGLE_CLIENT_ID").ok())
        .filter(|id| !id.is_empty())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Account {
    pub email: String,
    pub refresh_token: String,
}

fn account_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("google.json"))
}

pub fn load_account(app: &AppHandle) -> Option<Account> {
    let text = std::fs::read_to_string(account_file(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

/// The refresh token is a long-lived credential, so the file is owner-only.
/// It still belongs in the OS keychain — see the README.
fn save_account(app: &AppHandle, account: &Account) {
    let Some(path) = account_file(app) else { return };
    let Ok(json) = serde_json::to_string_pretty(account) else {
        return;
    };
    if std::fs::write(&path, json).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

pub fn disconnect(app: &AppHandle) {
    if let Some(path) = account_file(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// What the browser shows after Google redirects back. The person is looking
/// at a browser tab, not the app, so it has to say what to do next.
const DONE_PAGE: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
<!doctype html><meta charset=utf-8><title>Connected</title>\
<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#14181f\">\
<div style=\"text-align:center\"><h1 style=\"font-size:1.4rem\">That's connected.</h1>\
<p style=\"color:#5d6672\">You can close this tab and go back to Errand.</p></div>";

/// Wait for Google to redirect the browser back to us, once.
///
/// Other processes on the machine can also reach this port, so connections
/// that don't carry our `state` are answered and ignored rather than trusted.
fn wait_for_code(listener: TcpListener, state: &str) -> Option<String> {
    listener
        .set_nonblocking(false)
        .expect("loopback listener should block");

    for _ in 0..20 {
        let Ok((stream, _)) = listener.accept() else {
            continue;
        };
        let mut stream = stream;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

        let mut first_line = String::new();
        if BufReader::new(&stream).read_line(&mut first_line).is_err() {
            continue;
        }
        let code = oauth::code_from_request(&first_line, state);
        let _ = stream.write_all(DONE_PAGE.as_bytes());
        let _ = stream.flush();
        if code.is_some() {
            return code;
        }
    }
    None
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

async fn post_form(body: String) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|_| "I couldn't reach Google.".to_string())?;

    if !response.status().is_success() {
        return Err("Google wouldn't complete the sign-in. Try connecting again.".into());
    }
    response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "Google sent back something I couldn't read.".to_string())
}

/// Run the whole sign-in: open the browser, catch the redirect, swap the code.
pub async fn connect(app: AppHandle) -> Result<String, String> {
    let client = client_id().ok_or(
        "This build has no Google sign-in configured yet. See the README under Connecting Google.",
    )?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Couldn't open a local port to finish signing in.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Couldn't open a local port.".to_string())?
        .port();
    let redirect = format!("http://127.0.0.1:{port}");

    let pkce = Pkce::generate();
    let state = oauth::random_state();
    let url = oauth::authorize_url(&client, &redirect, &pkce, &state);

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "I couldn't open your browser to sign in.".to_string())?;

    // Blocking socket work must not sit on the async runtime's thread.
    let waiter = { let state = state.clone(); tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state)) };
    let code = waiter
        .await
        .map_err(|_| "Sign-in was interrupted.".to_string())?
        .ok_or("Sign-in didn't finish. Nothing was connected.")?;

    let tokens = post_form(oauth::token_exchange_body(
        &client, &code, &pkce.verifier, &redirect,
    ))
    .await?;

    let refresh_token = tokens
        .refresh_token
        .ok_or("Google didn't send a lasting sign-in. Try connecting again.")?;
    let email = fetch_email_address(&tokens.access_token)
        .await
        .unwrap_or_else(|_| "your account".into());

    let account = Account {
        email: email.clone(),
        refresh_token,
    };
    save_account(&app, &account);
    Ok(email)
}

async fn fetch_email_address(access_token: &str) -> Result<String, String> {
    let value: serde_json::Value = reqwest::Client::new()
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| "no userinfo".to_string())?
        .json()
        .await
        .map_err(|_| "no userinfo".to_string())?;
    Ok(value["email"].as_str().unwrap_or("your account").to_string())
}

/// Access tokens last an hour; we simply mint a fresh one per request rather
/// than caching one and getting the expiry logic subtly wrong.
async fn access_token(account: &Account) -> Result<String, String> {
    let client = client_id().ok_or("Google sign-in isn't configured in this build.")?;
    let tokens = post_form(oauth::token_refresh_body(&client, &account.refresh_token)).await?;
    Ok(tokens.access_token)
}

async fn get_json(url: &str, token: &str) -> Result<serde_json::Value, String> {
    reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "I couldn't reach Google.".to_string())?
        .json()
        .await
        .map_err(|_| "Google sent back something I couldn't read.".to_string())
}

/// Recent or matching messages, as lines a small model can actually use.
/// Headers and snippets only — never the full body of every message, which
/// would fill an 8k context with three emails.
pub async fn list_email(account: &Account, query: &str, max: usize) -> Result<String, String> {
    let token = access_token(account).await?;
    let list = get_json(
        &format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={max}&q={}",
            oauth::urlencode(query)
        ),
        &token,
    )
    .await?;

    let Some(messages) = list["messages"].as_array() else {
        return Ok("No messages matched.".into());
    };
    if messages.is_empty() {
        return Ok("No messages matched.".into());
    }

    let mut lines = Vec::new();
    for message in messages.iter().take(max) {
        let Some(id) = message["id"].as_str() else {
            continue;
        };
        let detail = get_json(
            &format!(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}\
                 ?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
            ),
            &token,
        )
        .await?;

        let header = |name: &str| {
            detail["payload"]["headers"]
                .as_array()
                .and_then(|hs| {
                    hs.iter()
                        .find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name)))
                })
                .and_then(|h| h["value"].as_str())
                .unwrap_or("")
                .to_string()
        };
        lines.push(format!(
            "From: {} | Subject: {} | {} | {}",
            header("From"),
            header("Subject"),
            header("Date"),
            detail["snippet"].as_str().unwrap_or("")
        ));
    }
    Ok(lines.join("\n"))
}

/// Calendar entries between now and `days` ahead.
pub async fn list_events(account: &Account, days: u32) -> Result<String, String> {
    let token = access_token(account).await?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let from = timefmt::rfc3339(timefmt::start_of_day(now));
    let to = timefmt::rfc3339(timefmt::start_of_day(now) + u64::from(days).max(1) * 86_400);

    let value = get_json(
        &format!(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events\
             ?singleEvents=true&orderBy=startTime&timeMin={}&timeMax={}",
            oauth::urlencode(&from),
            oauth::urlencode(&to)
        ),
        &token,
    )
    .await?;

    let Some(items) = value["items"].as_array() else {
        return Ok("Nothing in the calendar for that period.".into());
    };
    if items.is_empty() {
        return Ok("Nothing in the calendar for that period.".into());
    }

    Ok(items
        .iter()
        .map(|event| {
            // All-day events carry `date`; timed ones carry `dateTime`.
            let start = event["start"]["dateTime"]
                .as_str()
                .or_else(|| event["start"]["date"].as_str())
                .unwrap_or("");
            format!(
                "{} — {}{}",
                start,
                event["summary"].as_str().unwrap_or("(no title)"),
                event["location"]
                    .as_str()
                    .map(|l| format!(" (at {l})"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n"))
}
