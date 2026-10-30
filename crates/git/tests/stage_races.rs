use agai_git::{
    GitReader,
    operations::{IndexTransaction, Mutation},
};
use agai_protocol::*;
use std::{path::Path, process::Command, sync::atomic::AtomicBool};
fn git(p: &Path, a: &[&str]) {
    assert!(
        Command::new("git")
            .arg("-C")
            .arg(p)
            .args(a)
            .output()
            .unwrap()
            .status
            .success()
    );
}
fn fixture() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    git(d.path(), &["init", "-q"]);
    git(d.path(), &["config", "user.name", "Test"]);
    git(d.path(), &["config", "user.email", "test@example.invalid"]);
    std::fs::write(d.path().join("a"), "before\n").unwrap();
    git(d.path(), &["add", "a"]);
    git(d.path(), &["commit", "-qm", "base"]);
    std::fs::write(d.path().join("a"), "after\n").unwrap();
    d
}
fn prepare(r: &GitReader) -> IndexTransaction {
    IndexTransaction::prepare(
        r,
        Mutation::Stage {
            path: RepoPath::from_bytes(b"a").unwrap(),
        },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    )
    .unwrap()
}
#[test]
fn external_index_change_is_never_overwritten() {
    let d = fixture();
    let r = GitReader::new(d.path()).unwrap();
    let tx = prepare(&r);
    git(d.path(), &["add", "a"]);
    let before = std::fs::read(d.path().join(".git/index")).unwrap();
    assert_eq!(
        tx.commit(&AtomicBool::new(false)).unwrap_err().code,
        "STALE_STATE"
    );
    assert_eq!(std::fs::read(d.path().join(".git/index")).unwrap(), before);
}
#[test]
fn foreign_index_lock_is_preserved() {
    let d = fixture();
    let r = GitReader::new(d.path()).unwrap();
    let tx = prepare(&r);
    std::fs::write(d.path().join(".git/index.lock"), "foreign").unwrap();
    assert_eq!(
        tx.commit(&AtomicBool::new(false)).unwrap_err().code,
        "INDEX_LOCKED"
    );
    assert_eq!(
        std::fs::read(d.path().join(".git/index.lock")).unwrap(),
        b"foreign"
    );
}
#[test]
fn changed_worktree_and_cancel_leave_index_untouched() {
    for cancel in [false, true] {
        let d = fixture();
        let r = GitReader::new(d.path()).unwrap();
        let before = std::fs::read(d.path().join(".git/index")).unwrap();
        let tx = prepare(&r);
        if !cancel {
            std::fs::write(d.path().join("a"), "raced\n").unwrap();
        }
        assert!(tx.commit(&AtomicBool::new(cancel)).is_err());
        assert_eq!(std::fs::read(d.path().join(".git/index")).unwrap(), before);
        assert!(!d.path().join(".git/index.lock").exists());
    }
}
#[test]
fn linked_worktrees_share_mutation_lock() {
    let d = fixture();
    let linked = tempfile::tempdir().unwrap();
    let p = linked.path().join("linked");
    git(
        d.path(),
        &["worktree", "add", "-b", "linked", p.to_str().unwrap()],
    );
    let a = GitReader::new(d.path()).unwrap();
    let b = GitReader::new(&p).unwrap();
    let _held = prepare(&a);
    let result = IndexTransaction::prepare(
        &b,
        Mutation::Stage {
            path: RepoPath::from_bytes(b"a").unwrap(),
        },
        &b.state().unwrap().generation,
        &AtomicBool::new(false),
    );
    assert!(matches!(result,Err(e)if e.code=="REPOSITORY_BUSY"));
}
#[test]
fn external_head_change_refuses_install() {
    let d = fixture();
    let r = GitReader::new(d.path()).unwrap();
    let tx = prepare(&r);
    git(d.path(), &["commit", "--allow-empty", "-qm", "external"]);
    let before = std::fs::read(d.path().join(".git/index")).unwrap();
    assert_eq!(
        tx.commit(&AtomicBool::new(false)).unwrap_err().code,
        "STALE_STATE"
    );
    assert_eq!(std::fs::read(d.path().join(".git/index")).unwrap(), before);
}
#[test]
fn partial_staging_rejects_git_normalization_instead_of_corrupting_unselected_lines() {
    let d = fixture();
    git(d.path(), &["config", "core.autocrlf", "true"]);
    let r = GitReader::new(d.path()).unwrap();
    let result = IndexTransaction::prepare(
        &r,
        Mutation::IndexBytes {
            path: RepoPath::from_bytes(b"a").unwrap(),
            bytes: Some(b"after\r\n".to_vec()),
        },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    );
    assert!(matches!(result,Err(e)if e.code=="PARTIAL_FILTER_UNSUPPORTED"));
}
