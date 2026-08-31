//! These tests are the product promise: an agent driven by a small local model
//! cannot reach outside the folders it was given, cannot silently overwrite,
//! and cannot do anything the person can't take back.

use errand_core::{apply, files, plan::Change, propose_organize, undo, Plan, Sandbox, Scheme};
use std::fs;
use std::path::Path;

fn touch(path: &Path, body: &str) {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).unwrap();
    }
    fs::write(path, body).unwrap();
}

fn sandboxed() -> (tempfile::TempDir, Sandbox) {
    let tmp = tempfile::tempdir().unwrap();
    let downloads = tmp.path().join("Downloads");
    fs::create_dir_all(&downloads).unwrap();
    let mut sb = Sandbox::new();
    sb.grant(&downloads).unwrap();
    (tmp, sb)
}

#[test]
fn refuses_paths_outside_granted_folders() {
    let (tmp, sb) = sandboxed();
    let secret = tmp.path().join("private.txt");
    touch(&secret, "bank details");

    // A sibling of the granted folder, named directly.
    assert!(sb.resolve(&secret).is_err());
    // The classic climb-out.
    assert!(sb.resolve("../private.txt").is_err());
    assert!(sb
        .resolve(tmp.path().join("Downloads/../private.txt"))
        .is_err());
    // Absolute paths elsewhere on the machine.
    assert!(sb.resolve("/etc/passwd").is_err());
    // Inside the grant is fine.
    assert!(sb.resolve(tmp.path().join("Downloads/report.pdf")).is_ok());
}

#[test]
fn a_symlink_cannot_be_used_to_escape() {
    let (tmp, sb) = sandboxed();
    let secret = tmp.path().join("private.txt");
    touch(&secret, "bank details");

    #[cfg(unix)]
    {
        let link = tmp.path().join("Downloads").join("innocent.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        // The link sits inside the granted folder, but resolves outside it.
        assert!(sb.resolve(&link).is_err(), "symlink escaped the sandbox");
    }
}

#[test]
fn nothing_happens_without_applying_the_plan() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    touch(&dl.join("holiday.jpg"), "x");
    touch(&dl.join("invoice.pdf"), "x");

    let plan = propose_organize(&sb, &dl, Scheme::ByKind).unwrap();
    assert!(!plan.is_empty());
    // Building a plan is inspection only — the files have not moved.
    assert!(dl.join("holiday.jpg").exists());
    assert!(!dl.join("Pictures").exists());

    // And it reads as English, not as paths.
    let preview = plan.preview();
    assert!(
        preview
            .iter()
            .any(|l| l == "Move holiday.jpg into Pictures"),
        "unreadable preview: {preview:?}"
    );
    assert!(plan.summary.contains("Sort 2 files"), "{}", plan.summary);
}

#[test]
fn organizing_then_undoing_leaves_the_folder_exactly_as_it_was() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    for name in ["a.jpg", "b.png", "c.pdf", "d.csv", "setup.dmg"] {
        touch(&dl.join(name), name);
    }
    // A folder the person made themselves must survive untouched.
    fs::create_dir_all(dl.join("My Stuff")).unwrap();
    touch(&dl.join("My Stuff").join("keep.txt"), "keep");

    let plan = propose_organize(&sb, &dl, Scheme::ByKind).unwrap();
    let receipt = apply(&sb, &plan).unwrap();

    assert!(dl.join("Pictures").join("a.jpg").exists());
    assert!(dl.join("Documents").join("c.pdf").exists());
    assert!(dl.join("Spreadsheets").join("d.csv").exists());
    assert!(dl.join("Installers").join("setup.dmg").exists());
    assert!(!dl.join("a.jpg").exists());
    // Their own folder was never considered.
    assert!(dl.join("My Stuff").join("keep.txt").exists());

    undo(&receipt).unwrap();

    for name in ["a.jpg", "b.png", "c.pdf", "d.csv", "setup.dmg"] {
        assert!(dl.join(name).exists(), "{name} was not put back");
    }
    assert!(!dl.join("Pictures").exists(), "empty folder left behind");
    assert!(dl.join("My Stuff").join("keep.txt").exists());
}

#[test]
fn refuses_to_overwrite_and_rolls_back_the_whole_plan() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    touch(&dl.join("one.txt"), "one");
    touch(&dl.join("two.txt"), "two");
    touch(&dl.join("Archive").join("two.txt"), "ALREADY HERE");

    let plan = Plan::new(
        "move both",
        vec![
            Change::Move {
                from: dl.join("one.txt"),
                to: dl.join("Archive").join("one.txt"),
            },
            Change::Move {
                from: dl.join("two.txt"),
                to: dl.join("Archive").join("two.txt"), // collides
            },
        ],
    );

    let err = apply(&sb, &plan).unwrap_err();
    assert!(
        err.to_string().contains("already something called"),
        "{err}"
    );

    // The first move succeeded, then was rolled back: all-or-nothing.
    assert!(dl.join("one.txt").exists(), "partial change left behind");
    assert!(dl.join("two.txt").exists());
    assert_eq!(
        fs::read_to_string(dl.join("Archive").join("two.txt")).unwrap(),
        "ALREADY HERE",
        "existing file was clobbered"
    );
}

#[test]
fn writing_a_file_is_reversible_whether_or_not_it_existed() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    touch(&dl.join("notes.md"), "original");

    let plan = Plan::new(
        "write two files",
        vec![
            Change::Write {
                path: dl.join("notes.md"),
                contents: "rewritten".into(),
            },
            Change::Write {
                path: dl.join("summary.md"),
                contents: "brand new".into(),
            },
        ],
    );
    let receipt = apply(&sb, &plan).unwrap();
    assert_eq!(
        fs::read_to_string(dl.join("notes.md")).unwrap(),
        "rewritten"
    );
    assert!(dl.join("summary.md").exists());

    undo(&receipt).unwrap();
    assert_eq!(fs::read_to_string(dl.join("notes.md")).unwrap(), "original");
    assert!(!dl.join("summary.md").exists(), "new file not removed");
}

#[test]
fn deleting_means_trashing_so_it_can_come_back() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    touch(&dl.join("oops.txt"), "precious");

    let plan = Plan::new(
        "delete it",
        vec![Change::Trash {
            path: dl.join("oops.txt"),
        }],
    );
    let receipt = apply(&sb, &plan).unwrap();
    assert!(!dl.join("oops.txt").exists());
    assert!(dl.join(".errand-trash").join("oops.txt").exists());

    undo(&receipt).unwrap();
    assert_eq!(fs::read_to_string(dl.join("oops.txt")).unwrap(), "precious");
}

#[test]
fn search_and_list_ignore_dotfiles_and_the_trash() {
    let (tmp, sb) = sandboxed();
    let dl = tmp.path().join("Downloads");
    touch(&dl.join("tax-2024.pdf"), "x");
    touch(&dl.join(".hidden-config"), "x");
    touch(&dl.join(".errand-trash").join("tax-old.pdf"), "x");

    let listed = files::list(&sb, &dl).unwrap();
    let names: Vec<&str> = listed.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["tax-2024.pdf"]);

    let found = files::search(&sb, "tax", 10).unwrap();
    assert_eq!(found.len(), 1, "trashed file surfaced in search: {found:?}");
    assert_eq!(found[0].name, "tax-2024.pdf");
}

#[test]
fn an_empty_sandbox_can_reach_nothing() {
    let sb = Sandbox::new();
    assert!(sb.resolve("/etc/passwd").is_err());
    assert!(sb.resolve("anything.txt").is_err());
    assert!(files::search(&sb, "tax", 10).unwrap().is_empty());
}
