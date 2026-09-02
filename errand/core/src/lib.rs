//! The part of Errand that actually touches the user's machine.
//!
//! Deliberately free of any Tauri dependency: the desktop shell is a thin
//! wrapper over this crate, so the rules that keep people's files safe can be
//! unit-tested on their own, without a windowing system.

pub mod files;
pub mod oauth;
pub mod plan;
pub mod sandbox;
pub mod text;
pub mod timefmt;
pub mod web;

pub use files::{kind_of, list, propose_organize, read_text, search, Entry, Scheme};
pub use plan::{apply, undo, ApplyError, Change, Plan, Receipt};
pub use sandbox::{AccessError, Sandbox};
pub use text::{html_to_text, parse_csv};
pub use web::{parse_results, SearchHit};
