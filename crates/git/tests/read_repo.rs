use agai_git::GitReader;
use std::{path::Path, process::Command};
fn git(p: &Path, args: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(p)
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).trim().into()
}
fn repo() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    git(d.path(), &["init", "-q", "--initial-branch=main"]);
    git(d.path(), &["config", "core.autocrlf", "false"]);
    git(d.path(), &["config", "user.name", "Fixture"]);
    git(
        d.path(),
        &["config", "user.email", "fixture@example.invalid"],
    );
    std::fs::write(d.path().join("a.cs"), b"class A {}\r\n").unwrap();
    git(d.path(), &["add", "."]);
    git(d.path(), &["commit", "-qm", "initial"]);
    d
}
#[test]
fn dirty_generation_changes_with_bytes_not_only_status() {
    let d = repo();
    let r = GitReader::new(d.path()).unwrap();
    std::fs::write(d.path().join("a.cs"), "one").unwrap();
    let a = r.state().unwrap();
    std::fs::write(d.path().join("a.cs"), "two").unwrap();
    let b = r.state().unwrap();
    assert_ne!(a.generation, b.generation);
    assert_eq!(b.status_entries.len(), 1);
}
#[test]
fn rename_unicode_and_newline_paths_survive() {
    use std::os::unix::ffi::OsStringExt;
    let d = repo();
    git(d.path(), &["mv", "a.cs", "код.cs"]);
    let raw = std::ffi::OsString::from_vec(b"-\xc3\xbf\n.cs".to_vec());
    std::fs::write(d.path().join(&raw), "x").unwrap();
    let s = GitReader::new(d.path()).unwrap().state().unwrap();
    assert!(s.status_entries.iter().any(|e| {
        e.original_path
            .as_ref()
            .is_some_and(|p| p.bytes().unwrap() == b"a.cs")
    }));
    assert!(
        s.status_entries
            .iter()
            .any(|e| e.path.bytes().unwrap() == b"-\xc3\xbf\n.cs")
    );
}
#[test]
fn history_has_real_parents_and_bound_cursor() {
    let d = repo();
    git(d.path(), &["commit", "--allow-empty", "-qm", "second"]);
    let r = GitReader::new(d.path()).unwrap();
    let a = r.history(None, 1).unwrap();
    let b = r.history(a.cursor.as_deref(), 1).unwrap();
    assert_eq!(a.commits[0].parents, vec![b.commits[0].oid.clone()]);
    git(d.path(), &["commit", "--allow-empty", "-qm", "third"]);
    assert!(r.history(a.cursor.as_deref(), 1).is_err());
}
#[test]
fn linked_worktree_shares_repo_but_not_worktree_id() {
    let d = repo();
    let second = tempfile::tempdir().unwrap();
    let p = second.path().join("linked");
    git(
        d.path(),
        &["worktree", "add", "-b", "feature", p.to_str().unwrap()],
    );
    let a = GitReader::new(d.path()).unwrap().state().unwrap();
    let b = GitReader::new(&p).unwrap().state().unwrap();
    assert_eq!(a.repo_id, b.repo_id);
    assert_ne!(a.worktree_id, b.worktree_id);
}
#[test]
fn cancelled_reader_returns_no_partial_output() {
    use std::sync::atomic::AtomicBool;
    let d = repo();
    let error =
        agai_git::runner::run(d.path(), &["log".into()], &AtomicBool::new(true)).unwrap_err();
    assert_eq!(error.code, "CANCELLED");
}
#[test]
fn worktree_read_refuses_symlinked_parent() {
    let d = repo();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
    let r = GitReader::new(d.path()).unwrap();
    assert!(
        r.read_worktree(&agai_protocol::RepoPath::from_bytes(b"link/secret").unwrap())
            .is_err()
    );
}

#[test]
fn status_parser_preserves_non_utf8_without_filesystem_roundtrip() {
    let entries = agai_git::parse_status(b"?? -\xff\n.cs\0").unwrap();
    assert_eq!(entries[0].path.bytes().unwrap(), b"-\xff\n.cs");
}
#[test]
fn cancellation_bounds_helper_pipe_lifetime() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use std::time::{Duration, Instant};
    let d = repo();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let timer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        flag.store(true, Ordering::Relaxed)
    });
    let start = Instant::now();
    let result = agai_git::runner::run(
        d.path(),
        &[
            "-c".into(),
            "alias.probe=!sleep 4 & exit 0".into(),
            "probe".into(),
        ],
        &cancelled,
    );
    timer.join().unwrap();
    assert_eq!(result.unwrap_err().code, "CANCELLED");
    assert!(start.elapsed() < Duration::from_secs(2));
}
#[test]
fn history_race_worker() {
    if let Some(path) = std::env::var_os("AGAI_RACE_REPO") {
        let r = GitReader::new(Path::new(&path)).unwrap();
        assert_eq!(r.history(None, 1).unwrap_err().code, "STALE_STATE");
    }
}
#[test]
fn history_revalidates_refs_after_traversal() {
    use std::os::unix::fs::PermissionsExt;
    let d = repo();
    let shim = tempfile::tempdir().unwrap();
    let real = String::from_utf8(Command::new("which").arg("git").output().unwrap().stdout)
        .unwrap()
        .trim()
        .to_owned();
    let path = shim.path().join("git");
    std::fs::write(&path,"#!/bin/sh\nfor arg do\n if [ \"$arg\" = log ]; then \"$AGAI_REAL_GIT\" -C \"$AGAI_RACE_REPO\" update-ref refs/heads/race HEAD; fi\ndone\nexec \"$AGAI_REAL_GIT\" \"$@\"\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "history_race_worker", "--nocapture"])
        .env("AGAI_RACE_REPO", d.path())
        .env("AGAI_REAL_GIT", real)
        .env(
            "PATH",
            format!(
                "{}:{}",
                shim.path().display(),
                std::env::var("PATH").unwrap()
            ),
        )
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn history_rows_include_author_and_iso_date() {
    let d = repo();
    let page = GitReader::new(d.path()).unwrap().history(None, 10).unwrap();
    let json = serde_json::to_value(&page).unwrap();
    assert_eq!(json["commits"][0]["author"], "Fixture");
    assert!(
        json["commits"][0]["date"]
            .as_str()
            .unwrap_or("")
            .contains('T')
    );
}
