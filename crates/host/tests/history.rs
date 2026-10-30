use agai_host::HostService;
use agai_protocol::*;
use agai_storage::Store;
use serde_json::json;
use std::{path::Path, process::Command};
fn git(path: &Path, args: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8(o.stdout).unwrap().trim().into()
}
fn repo(p: &Path) {
    std::fs::create_dir(p).unwrap();
    git(p, &["init", "-q"]);
    std::fs::write(p.join("keep"), "code").unwrap();
}
#[test]
fn migrates_and_recovers_from_sibling_without_code_changes() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let r = agai_git::GitReader::new(&p).unwrap();
    let mut store = Store::open(&d.path().join("db")).unwrap();
    store
        .put_doc(
            "decision",
            "d",
            r.repo_id,
            r.worktree_id,
            0,
            &json!({"revision":1,"summary":"kept","rationale":"reason"}),
        )
        .unwrap();
    store
        .put_doc(
            "agent_grant",
            "secret",
            r.repo_id,
            r.worktree_id,
            0,
            &json!({"revision":1}),
        )
        .unwrap();
    let h = HostService::new(store);
    let state = h.register_repository(&p).unwrap();
    let history = d.path().join("project.history");
    assert!(history.join("HEAD").exists());
    let oid = git(&history, &["rev-parse", "HEAD"]);
    h.register_repository(&p).unwrap();
    assert_eq!(git(&history, &["rev-parse", "HEAD"]), oid);
    assert_eq!(git(&p, &["status", "--porcelain"]), "?? keep");
    let fresh = HostService::new(Store::open(&d.path().join("fresh")).unwrap());
    fresh.register_repository(&p).unwrap();
    assert_eq!(
        fresh.store.doc("decision", "d").unwrap(),
        h.store.doc("decision", "d").unwrap()
    );
    assert_eq!(fresh.store.doc("agent_grant", "secret").unwrap(), None);
    assert_eq!(state.repo_id, r.repo_id);
}
#[test]
fn rejects_unrelated_sibling_and_symlink() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let dest = d.path().join("project.history");
    std::fs::create_dir(&dest).unwrap();
    std::fs::write(dest.join("keep"), "mine").unwrap();
    let h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    assert!(h.register_repository(&p).is_err());
    assert_eq!(std::fs::read_to_string(dest.join("keep")).unwrap(), "mine");
    std::fs::remove_file(dest.join("keep")).unwrap();
    std::fs::remove_dir(&dest).unwrap();
    std::os::unix::fs::symlink(&p, &dest).unwrap();
    assert!(h.register_repository(&p).is_err());
}
#[test]
fn relocated_pair_keeps_identity_and_pending_changes_checkpoint() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let state = h.register_repository(&p).unwrap();
    h.store
        .put_doc(
            "trace",
            "t",
            state.repo_id,
            state.worktree_id,
            0,
            &json!({"revision":1,"steps":[{"value":75}]}),
        )
        .unwrap();
    let new = d.path().join("renamed");
    std::fs::rename(&p, &new).unwrap();
    std::fs::rename(
        d.path().join("project.history"),
        d.path().join("renamed.history"),
    )
    .unwrap();
    let moved = h.register_repository(&new).unwrap();
    assert_eq!(moved.repo_id, state.repo_id);
    assert_eq!(moved.worktree_id, state.worktree_id);
    assert!(h.reader(moved.repo_id, moved.worktree_id).is_ok());
    let recovered = HostService::new(Store::open(&d.path().join("fresh")).unwrap());
    recovered.register_repository(&new).unwrap();
    assert!(recovered.store.doc("trace", "t").unwrap().is_some());
}
#[test]
fn erase_purges_old_history_objects() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&p).unwrap();
    h.store
        .put_doc(
            "decision",
            "d",
            s.repo_id,
            s.worktree_id,
            0,
            &json!({"revision":1,"summary":"sensitive"}),
        )
        .unwrap();
    h.register_repository(&p).unwrap();
    let history = d.path().join("project.history");
    let old = git(&history, &["rev-parse", "HEAD"]);
    h.desktop(
        &Principal::LocalUser,
        DesktopRequest::MemoryErase {
            scope: RepoScope {
                repo_id: s.repo_id,
                worktree_id: s.worktree_id,
            },
            confirmation: "ERASE STORED CONTEXT".into(),
        },
    )
    .unwrap();
    assert_eq!(git(&history, &["rev-list", "--count", "HEAD"]), "1");
    assert!(
        !Command::new("git")
            .arg("-C")
            .arg(&history)
            .args(["cat-file", "-e", &old])
            .status()
            .unwrap()
            .success()
    );
    let fresh = HostService::new(Store::open(&d.path().join("fresh")).unwrap());
    fresh.register_repository(&p).unwrap();
    assert!(fresh.store.doc("decision", "d").unwrap().is_none());
}
#[test]
fn failed_checkpoint_retains_sql_and_retries_without_duplicates() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&p).unwrap();
    let history = d.path().join("project.history");
    h.store
        .put_doc(
            "trace",
            "t",
            s.repo_id,
            s.worktree_id,
            0,
            &json!({"revision":1,"value":"pending"}),
        )
        .unwrap();
    std::fs::write(history.join("refs/heads/main.lock"), "").unwrap();
    assert!(h.register_repository(&p).is_err());
    assert!(h.store.doc("trace", "t").unwrap().is_some());
    std::fs::remove_file(history.join("refs/heads/main.lock")).unwrap();
    h.register_repository(&p).unwrap();
    let oid = git(&history, &["rev-parse", "HEAD"]);
    h.register_repository(&p).unwrap();
    assert_eq!(oid, git(&history, &["rev-parse", "HEAD"]));
}
#[test]
fn corrupted_history_never_replaces_local_context() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&p).unwrap();
    let history = d.path().join("project.history");
    let before = h.store.history_image(s.repo_id, s.worktree_id).unwrap();
    std::fs::write(history.join("config"), "[include]\n path=/tmp/evil\n").unwrap();
    assert!(h.register_repository(&p).is_err());
    assert_eq!(
        h.store.history_image(s.repo_id, s.worktree_id).unwrap(),
        before
    );
}
#[test]
fn pending_erase_is_finished_even_when_git_already_has_new_root() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&p).unwrap();
    h.store
        .put_doc(
            "decision",
            "d",
            s.repo_id,
            s.worktree_id,
            0,
            &json!({"revision":1,"summary":"sensitive"}),
        )
        .unwrap();
    h.register_repository(&p).unwrap();
    let history = d.path().join("project.history");
    let old = git(&history, &["rev-parse", "HEAD"]);
    // Simulate interrupted erase cleanup by retaining the old commit through a reflog.
    h.store
        .redact_memory_scope(s.repo_id, s.worktree_id)
        .unwrap();
    let image = h.store.history_image(s.repo_id, s.worktree_id).unwrap();
    std::fs::write(history.join("agai-erase-pending"), format!("{old}\n")).unwrap();
    h.register_repository(&p).unwrap();
    assert!(!history.join("agai-erase-pending").exists());
    assert!(
        !Command::new("git")
            .arg("-C")
            .arg(&history)
            .args(["cat-file", "-e", &old])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert_eq!(
        h.store.history_image(s.repo_id, s.worktree_id).unwrap(),
        image
    );
}
#[test]
fn missing_previous_project_does_not_block_opening_another() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a");
    let b = d.path().join("b");
    repo(&a);
    repo(&b);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    h.register_repository(&a).unwrap();
    std::fs::rename(&a, d.path().join("moved")).unwrap();
    assert!(
        h.desktop(
            &Principal::LocalUser,
            DesktopRequest::OpenRepository {
                path: b.to_string_lossy().into()
            }
        )
        .is_ok()
    );
}
#[test]
fn copied_live_identity_cannot_rebind_existing_grants() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a");
    let b = d.path().join("b");
    repo(&a);
    repo(&b);
    let h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&a).unwrap();
    assert!(
        Command::new("cp")
            .args(["-R"])
            .arg(d.path().join("a.history"))
            .arg(d.path().join("b.history"))
            .status()
            .unwrap()
            .success()
    );
    assert!(h.register_repository(&b).is_err());
    assert_eq!(
        h.reader(s.repo_id, s.worktree_id).unwrap().root,
        a.canonicalize().unwrap()
    );
}
#[test]
fn unchanged_large_history_uses_fast_read_path() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("project");
    repo(&p);
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let s = h.register_repository(&p).unwrap();
    h.store
        .put_doc(
            "trace",
            "large",
            s.repo_id,
            s.worktree_id,
            0,
            &json!({"revision":1,"payload":"x".repeat(32*1024*1024)}),
        )
        .unwrap();
    h.register_repository(&p).unwrap();
    let request = || DesktopRequest::MemoryCatalog {
        scope: RepoScope {
            repo_id: s.repo_id,
            worktree_id: s.worktree_id,
        },
    };
    h.desktop(&Principal::LocalUser, request()).unwrap();
    let start = std::time::Instant::now();
    h.desktop(&Principal::LocalUser, request()).unwrap();
    assert!(
        start.elapsed() < std::time::Duration::from_secs(2),
        "unchanged catalog took {:?}",
        start.elapsed()
    );
}
