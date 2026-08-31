//! Which folders the agent is allowed to touch.
//!
//! The agent is driven by a small model running on the user's own laptop, and
//! small models get things wrong. So capability, not intention, is what keeps
//! people safe: every path the agent names is resolved against a set of folders
//! the user explicitly granted, and anything landing outside them is refused
//! before it reaches the filesystem. Symlinks are resolved first, so a link
//! inside a granted folder can't be used to reach out of one.

use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum AccessError {
    /// The path resolved to somewhere the user never granted.
    Outside(PathBuf),
    /// No folders have been granted yet.
    NothingGranted,
    Io(String),
}

impl std::fmt::Display for AccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Worded for the person, not the programmer — this text reaches the UI.
            AccessError::Outside(p) => write!(
                f,
                "\u{201c}{}\u{201d} is outside the folders you've given access to.",
                p.display()
            ),
            AccessError::NothingGranted => {
                write!(f, "You haven't given access to any folders yet.")
            }
            AccessError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AccessError {}

/// The set of folders the user has granted, in the order they granted them.
#[derive(Debug, Default, Clone)]
pub struct Sandbox {
    roots: Vec<PathBuf>,
}

impl Sandbox {
    pub fn new() -> Self {
        Self::default()
    }

    /// Grant a folder. It must already exist — we can't pre-authorise somewhere
    /// that isn't there, because we can't resolve what it will turn out to be.
    pub fn grant(&mut self, path: impl AsRef<Path>) -> Result<PathBuf, AccessError> {
        let real = std::fs::canonicalize(path.as_ref()).map_err(io_err)?;
        if !real.is_dir() {
            return Err(AccessError::Io(format!(
                "\u{201c}{}\u{201d} isn't a folder.",
                real.display()
            )));
        }
        if !self.roots.contains(&real) {
            self.roots.push(real.clone());
        }
        Ok(real)
    }

    pub fn revoke(&mut self, path: impl AsRef<Path>) {
        if let Ok(real) = std::fs::canonicalize(path.as_ref()) {
            self.roots.retain(|r| r != &real);
        }
    }

    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// Resolve a path the agent named, and prove it lands inside a granted root.
    ///
    /// Handles paths that don't exist yet (a file about to be written): the
    /// deepest existing ancestor is canonicalized, and the remainder appended
    /// only after being checked for `..` escapes.
    pub fn resolve(&self, path: impl AsRef<Path>) -> Result<PathBuf, AccessError> {
        if self.roots.is_empty() {
            return Err(AccessError::NothingGranted);
        }
        let requested = path.as_ref();

        // Walk up to the deepest ancestor that exists, so symlinks anywhere
        // along the path are resolved before we compare against the roots.
        let mut existing = requested.to_path_buf();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        while !existing.exists() {
            match existing.file_name() {
                Some(name) => {
                    tail.push(name.to_os_string());
                    match existing.parent() {
                        Some(p) if !p.as_os_str().is_empty() => existing = p.to_path_buf(),
                        // Relative path with no existing ancestor — resolve it
                        // against the granted roots, never the process cwd.
                        _ => return self.resolve_relative(requested),
                    }
                }
                None => return Err(AccessError::Outside(requested.to_path_buf())),
            }
        }

        let mut real = std::fs::canonicalize(&existing).map_err(io_err)?;
        for name in tail.iter().rev() {
            // A `..` in the not-yet-existing tail could climb out of a root.
            if name == ".." {
                return Err(AccessError::Outside(requested.to_path_buf()));
            }
            real.push(name);
        }

        self.check(real, requested)
    }

    /// A bare relative path like "photos/holiday.jpg" is interpreted against the
    /// granted roots, never the process working directory.
    fn resolve_relative(&self, requested: &Path) -> Result<PathBuf, AccessError> {
        if requested
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            return Err(AccessError::Outside(requested.to_path_buf()));
        }
        for root in &self.roots {
            let candidate = root.join(requested);
            if candidate.exists() {
                let real = std::fs::canonicalize(&candidate).map_err(io_err)?;
                return self.check(real, requested);
            }
        }
        // Doesn't exist anywhere yet: place it under the first granted root.
        let first = self.roots.first().ok_or(AccessError::NothingGranted)?;
        self.check(first.join(requested), requested)
    }

    fn check(&self, real: PathBuf, requested: &Path) -> Result<PathBuf, AccessError> {
        if self.roots.iter().any(|root| real.starts_with(root)) {
            Ok(real)
        } else {
            Err(AccessError::Outside(requested.to_path_buf()))
        }
    }
}

fn io_err(e: io::Error) -> AccessError {
    AccessError::Io(e.to_string())
}
