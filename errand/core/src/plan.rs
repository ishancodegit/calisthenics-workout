//! Nothing the agent decides is applied straight away.
//!
//! Every action that changes a file becomes a `Change` in a `Plan`, which the
//! app shows the person in plain English before anything happens: "Move 34
//! files into Receipts". They press Do it, or they don't. Applying returns a
//! `Receipt` that can undo the whole thing, because the second thing a
//! non-technical person needs — after seeing what will happen — is to be able
//! to take it back when it wasn't what they meant.

use crate::sandbox::{AccessError, Sandbox};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Change {
    CreateFolder {
        path: PathBuf,
    },
    Move {
        from: PathBuf,
        to: PathBuf,
    },
    Write {
        path: PathBuf,
        contents: String,
    },
    /// Deliberately not a delete: files go to a trash folder inside the
    /// sandbox, so "delete" is always reversible.
    Trash {
        path: PathBuf,
    },
}

fn name_of(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.display().to_string())
}

impl Change {
    /// One line, readable by someone who has never seen a file path.
    pub fn describe(&self) -> String {
        match self {
            Change::CreateFolder { path } => format!("Make a folder called {}", name_of(path)),
            Change::Move { from, to } => {
                let dest = to
                    .parent()
                    .map(name_of)
                    .unwrap_or_else(|| "the folder".into());
                if name_of(from) == name_of(to) {
                    format!("Move {} into {}", name_of(from), dest)
                } else {
                    format!("Rename {} to {}", name_of(from), name_of(to))
                }
            }
            Change::Write { path, contents } => format!(
                "Write {} ({})",
                name_of(path),
                human_size(contents.len() as u64)
            ),
            Change::Trash { path } => format!("Move {} to the trash", name_of(path)),
        }
    }
}

pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{size:.1} {}", UNITS[unit])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Plan {
    /// What the agent says it is about to do, in one sentence.
    pub summary: String,
    pub changes: Vec<Change>,
}

impl Plan {
    pub fn new(summary: impl Into<String>, changes: Vec<Change>) -> Self {
        Self {
            summary: summary.into(),
            changes,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    /// The preview the UI renders — one readable line per change.
    pub fn preview(&self) -> Vec<String> {
        self.changes.iter().map(Change::describe).collect()
    }
}

/// A single reversal step, recorded as each change is applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Step {
    RemoveFolder {
        path: PathBuf,
    },
    MoveBack {
        from: PathBuf,
        to: PathBuf,
    },
    /// `previous: None` means the file did not exist before we wrote it.
    RestoreFile {
        path: PathBuf,
        previous: Option<String>,
    },
}

/// Proof of what was applied, and everything needed to take it back.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Receipt {
    steps: Vec<Step>,
    pub applied: usize,
}

#[derive(Debug)]
pub enum ApplyError {
    Access(AccessError),
    /// Refusing to overwrite something that is already there.
    WouldOverwrite(PathBuf),
    Io(String),
}

impl std::fmt::Display for ApplyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApplyError::Access(e) => write!(f, "{e}"),
            ApplyError::WouldOverwrite(p) => write!(
                f,
                "There's already something called \u{201c}{}\u{201d} there, so I stopped.",
                name_of(p)
            ),
            ApplyError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl From<AccessError> for ApplyError {
    fn from(e: AccessError) -> Self {
        ApplyError::Access(e)
    }
}

fn io(e: std::io::Error) -> ApplyError {
    ApplyError::Io(e.to_string())
}

/// Apply a plan. If any step fails, everything already done is rolled back, so
/// the user is never left with half of a change they approved.
pub fn apply(sandbox: &Sandbox, plan: &Plan) -> Result<Receipt, ApplyError> {
    let mut receipt = Receipt::default();
    for change in &plan.changes {
        if let Err(e) = apply_one(sandbox, change, &mut receipt) {
            let _ = undo(&receipt); // best effort: leave them where they started
            return Err(e);
        }
        receipt.applied += 1;
    }
    Ok(receipt)
}

fn apply_one(sandbox: &Sandbox, change: &Change, receipt: &mut Receipt) -> Result<(), ApplyError> {
    match change {
        Change::CreateFolder { path } => {
            let real = sandbox.resolve(path)?;
            if real.exists() {
                return Ok(()); // already there; nothing to undo
            }
            std::fs::create_dir_all(&real).map_err(io)?;
            receipt.steps.push(Step::RemoveFolder { path: real });
        }
        Change::Move { from, to } => {
            let src = sandbox.resolve(from)?;
            let dst = sandbox.resolve(to)?;
            if dst.exists() {
                return Err(ApplyError::WouldOverwrite(dst));
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(io)?;
            }
            rename_or_copy(&src, &dst)?;
            receipt.steps.push(Step::MoveBack { from: dst, to: src });
        }
        Change::Write { path, contents } => {
            let real = sandbox.resolve(path)?;
            let previous = if real.exists() {
                Some(std::fs::read_to_string(&real).map_err(io)?)
            } else {
                None
            };
            if let Some(parent) = real.parent() {
                std::fs::create_dir_all(parent).map_err(io)?;
            }
            std::fs::write(&real, contents).map_err(io)?;
            receipt.steps.push(Step::RestoreFile {
                path: real,
                previous,
            });
        }
        Change::Trash { path } => {
            let src = sandbox.resolve(path)?;
            let bin = trash_dir(sandbox, &src)?;
            std::fs::create_dir_all(&bin).map_err(io)?;
            let dst = unique_in(&bin, &name_of(&src));
            rename_or_copy(&src, &dst)?;
            receipt.steps.push(Step::MoveBack { from: dst, to: src });
        }
    }
    Ok(())
}

/// Put back everything a receipt describes, most recent step first.
pub fn undo(receipt: &Receipt) -> Result<usize, ApplyError> {
    let mut reversed = 0;
    for step in receipt.steps.iter().rev() {
        match step {
            Step::RemoveFolder { path } => {
                // Only if still empty — the user may have put things in it since.
                let _ = std::fs::remove_dir(path);
            }
            Step::MoveBack { from, to } => {
                if from.exists() && !to.exists() {
                    if let Some(parent) = to.parent() {
                        std::fs::create_dir_all(parent).map_err(io)?;
                    }
                    rename_or_copy(from, to)?;
                }
            }
            Step::RestoreFile { path, previous } => match previous {
                Some(text) => std::fs::write(path, text).map_err(io)?,
                None => {
                    let _ = std::fs::remove_file(path);
                }
            },
        }
        reversed += 1;
    }
    Ok(reversed)
}

/// The trash lives inside whichever granted folder the file came from, so
/// trashing never moves data across a boundary the user approved.
fn trash_dir(sandbox: &Sandbox, file: &Path) -> Result<PathBuf, ApplyError> {
    let root = sandbox
        .roots()
        .iter()
        .find(|r| file.starts_with(r))
        .ok_or_else(|| ApplyError::Access(AccessError::Outside(file.to_path_buf())))?;
    Ok(root.join(".errand-trash"))
}

fn unique_in(dir: &Path, name: &str) -> PathBuf {
    let mut candidate = dir.join(name);
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{n}-{name}"));
        n += 1;
    }
    candidate
}

/// `rename` fails across filesystems (an external drive, a network share),
/// which is exactly where people keep the folders they want tidied.
fn rename_or_copy(src: &Path, dst: &Path) -> Result<(), ApplyError> {
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(src, dst).map_err(io)?;
            std::fs::remove_file(src).map_err(io)?;
            Ok(())
        }
    }
}
