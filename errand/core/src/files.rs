//! The agent's eyes and hands for the filesystem.
//!
//! Reads are direct; anything that changes a file comes back as a `Plan` for
//! the person to approve. The grouping in `propose_organize` is done here in
//! Rust rather than by the model on purpose: a 7B model asked to emit 200 move
//! operations will mislabel some and hallucinate others, but asked to call one
//! tool named "tidy this folder by kind" it is reliable. Let the model choose
//! the intent; let real code do the bookkeeping.

use crate::plan::{Change, Plan};
use crate::timefmt::month_folder;
use crate::sandbox::{AccessError, Sandbox};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub size: u64,
    pub ext: String,
    /// Seconds since the epoch; 0 when the platform won't say.
    pub modified: u64,
}

fn entry_for(path: &Path) -> Option<Entry> {
    let meta = std::fs::metadata(path).ok()?;
    Some(Entry {
        name: path.file_name()?.to_string_lossy().to_string(),
        path: path.to_path_buf(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        ext: path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

/// Anything starting with a dot, plus our own trash, stays invisible: people
/// don't think of these as their files and the agent shouldn't reason about them.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

pub fn list(sandbox: &Sandbox, dir: impl AsRef<Path>) -> Result<Vec<Entry>, AccessError> {
    let real = sandbox.resolve(dir)?;
    let mut out = Vec::new();
    let reader = std::fs::read_dir(&real).map_err(|e| AccessError::Io(e.to_string()))?;
    for item in reader.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        if let Some(e) = entry_for(&item.path()) {
            out.push(e);
        }
    }
    out.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
    Ok(out)
}

/// Filename search across every granted folder. Substring, case-insensitive —
/// what someone means by "find my tax stuff" far more often than a regex.
pub fn search(sandbox: &Sandbox, query: &str, limit: usize) -> Result<Vec<Entry>, AccessError> {
    let needle = query.to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for root in sandbox.roots() {
        for item in walkdir::WalkDir::new(root)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| !is_hidden(&e.file_name().to_string_lossy()) || e.depth() == 0)
            .flatten()
        {
            if out.len() >= limit {
                return Ok(out);
            }
            let name = item.file_name().to_string_lossy().to_lowercase();
            if name.contains(&needle) {
                if let Some(e) = entry_for(item.path()) {
                    out.push(e);
                }
            }
        }
    }
    Ok(out)
}

/// Read a document as text, truncated so one oversized file can't blow the
/// model's context window — the caller is told when that happened.
///
/// PDFs are the point of this function existing. "Pull the totals out of my
/// receipts" is the errand people actually want, and receipts are PDFs; handing
/// a local model the raw bytes of one wastes its whole context on binary and
/// then invites it to hallucinate a number.
pub fn read_text(
    sandbox: &Sandbox,
    path: impl AsRef<Path>,
    max_bytes: usize,
) -> Result<(String, bool), AccessError> {
    let real = sandbox.resolve(path)?;
    let bytes = std::fs::read(&real).map_err(|e| AccessError::Io(e.to_string()))?;

    let text = if bytes.starts_with(b"%PDF") {
        pdf_extract::extract_text_from_mem(&bytes).map_err(|_| {
            AccessError::Io(
                "I couldn't read the text out of that PDF — it may be a scan rather than                  a document with real text in it."
                    .into(),
            )
        })?
    } else if let Ok(text) = std::str::from_utf8(&bytes) {
        text.to_string()
    } else if looks_like_text(&bytes) {
        // Not valid UTF-8, but mostly readable — an old file in some other
        // encoding. Better a slightly mangled read than a refusal.
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        return Err(AccessError::Io(format!(
            "\u{201c}{}\u{201d} isn't something I can read as text.",
            real.file_name().unwrap_or_default().to_string_lossy()
        )));
    };

    let truncated = text.len() > max_bytes;
    let mut out = text;
    if truncated {
        // Cut on a character boundary; `truncate` panics mid-codepoint.
        let mut end = max_bytes;
        while end > 0 && !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
    }
    Ok((out, truncated))
}

/// A rough "is this prose?" test: mostly printable, few NULs.
fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(1024)];
    if sample.is_empty() {
        return true;
    }
    let printable = sample
        .iter()
        .filter(|b| **b >= 0x20 || matches!(b, b'\n' | b'\r' | b'\t'))
        .count();
    !sample.contains(&0) && printable * 10 >= sample.len() * 9
}

/// Buckets named the way a person would name them, not by MIME type.
pub fn kind_of(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "heic" | "webp" | "bmp" | "tiff" | "svg" => "Pictures",
        "pdf" | "doc" | "docx" | "txt" | "rtf" | "odt" | "pages" | "md" => "Documents",
        "xls" | "xlsx" | "csv" | "numbers" | "ods" => "Spreadsheets",
        "ppt" | "pptx" | "key" | "odp" => "Presentations",
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" => "Music",
        "mp4" | "mov" | "avi" | "mkv" | "webm" | "wmv" => "Videos",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" => "Archives",
        "dmg" | "exe" | "msi" | "pkg" | "deb" | "appimage" => "Installers",
        _ => "Other",
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Scheme {
    /// Pictures, Documents, Spreadsheets… — the "sort out my Downloads" case.
    ByKind,
    /// 2024-06, 2024-07… — for photo dumps and scanned post.
    ByMonth,
}

/// Build a tidy-up plan for one folder. Only loose files at the top level are
/// touched: folders the person already made are left exactly as they are,
/// because those represent decisions they took deliberately.
pub fn propose_organize(
    sandbox: &Sandbox,
    dir: impl AsRef<Path>,
    scheme: Scheme,
) -> Result<Plan, AccessError> {
    let real = sandbox.resolve(&dir)?;
    let entries = list(sandbox, &real)?;
    let loose: Vec<&Entry> = entries.iter().filter(|e| !e.is_dir).collect();

    let mut changes = Vec::new();
    let mut folders: Vec<String> = Vec::new();
    for file in &loose {
        let bucket = match scheme {
            Scheme::ByKind => kind_of(&file.ext).to_string(),
            Scheme::ByMonth => month_folder(file.modified),
        };
        if !folders.contains(&bucket) {
            folders.push(bucket.clone());
            changes.push(Change::CreateFolder {
                path: real.join(&bucket),
            });
        }
        changes.push(Change::Move {
            from: file.path.clone(),
            to: real.join(&bucket).join(&file.name),
        });
    }

    let moves = loose.len();
    let summary = if moves == 0 {
        format!(
            "Nothing loose to tidy in {}.",
            real.file_name().unwrap_or_default().to_string_lossy()
        )
    } else {
        format!(
            "Sort {moves} file{} in {} into {} folder{}.",
            if moves == 1 { "" } else { "s" },
            real.file_name().unwrap_or_default().to_string_lossy(),
            folders.len(),
            if folders.len() == 1 { "" } else { "s" }
        )
    };
    Ok(Plan::new(summary, changes))
}
