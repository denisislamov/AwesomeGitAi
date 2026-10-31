use agai_domain::*;
use agai_git::GitReader;
use agai_protocol::*;
use agai_storage::Store;
use std::{path::Path, process::Command};
use uuid::Uuid;
fn git(p: &Path, a: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(p)
        .args(a)
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
    std::fs::write(d.path().join("a.cs"), b"one\r\n").unwrap();
    git(d.path(), &["add", "."]);
    git(d.path(), &["commit", "-qm", "first"]);
    d
}
#[test]
fn preserves_head_index_and_worktree_independently() {
    let d = repo();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    std::fs::write(d.path().join("a.cs"), b"two\r\n").unwrap();
    git(d.path(), &["add", "a.cs"]);
    std::fs::write(d.path().join("a.cs"), b"three\r\n").unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let ids = capture_now(&r, &mut db, &[RepoPath::from_bytes(b"a.cs").unwrap()]).unwrap();
    for (id, bytes) in [
        (ids.head_snapshot_id, b"one\r\n".as_slice()),
        (ids.index_snapshot_id, b"two\r\n"),
        (ids.worktree_snapshot_id, b"three\r\n"),
    ] {
        assert_eq!(db.snapshot(id).unwrap().files[0].bytes, bytes);
    }
    git(d.path(), &["reset", "--hard", "HEAD"]);
    git(d.path(), &["reflog", "expire", "--expire=now", "--all"]);
    git(d.path(), &["gc", "--prune=now"]);
    assert_eq!(
        db.snapshot(ids.worktree_snapshot_id).unwrap().files[0].bytes,
        b"three\r\n"
    );
}
#[test]
fn symlink_and_large_file_are_explicit_exclusions() {
    let d = repo();
    let state = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink("/etc/passwd", d.path().join("link")).unwrap();
    std::fs::write(d.path().join("large"), vec![b'x'; 2097153]).unwrap();
    std::fs::write(d.path().join(".env"), "SECRET=value").unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let paths = ["link", "large", ".env"].map(|p| RepoPath::from_bytes(p.as_bytes()).unwrap());
    let ids = capture_now(&r, &mut db, &paths).unwrap();
    let s = db.snapshot(ids.worktree_snapshot_id).unwrap();
    assert!(s.files.is_empty());
    assert_eq!(s.exclusions.len(), 3);
}
#[test]
fn rejects_stale_capture() {
    let d = repo();
    let r = GitReader::new(d.path()).unwrap();
    let gen1 = r
        .generation_for_paths(&[RepoPath::from_bytes(b"a.cs").unwrap()])
        .unwrap();
    std::fs::write(d.path().join("a.cs"), "new").unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    assert_eq!(
        capture(
            &r,
            &mut db,
            &[RepoPath::from_bytes(b"a.cs").unwrap()],
            &gen1
        )
        .unwrap_err()
        .code,
        "STALE_STATE"
    );
}
fn snapshot(bytes: &[u8]) -> Snapshot {
    Snapshot {
        id: Uuid::new_v4(),
        repo_id: Uuid::nil(),
        worktree_id: Uuid::nil(),
        layer: Layer::Worktree,
        generation: "g".into(),
        files: vec![SnapshotFile::new(
            RepoPath::from_bytes(b"a").unwrap(),
            Some(bytes.to_vec()),
            None,
        )],
        exclusions: vec![],
        captured_at: "fixture".into(),
    }
}
#[test]
fn conservative_anchor_resolution() {
    let original = snapshot(b"a\nbody\nz\n");
    let anchor = Anchor {
        comparison_id: Uuid::new_v4(),
        snapshot_id: original.id,
        path: original.files[0].path.clone(),
        side: Side::New,
        start_line: 2,
        end_line: 2,
        content_hash: hash(b"body\n"),
        context_hash: hash(&original.files[0].bytes),
        symbol: None,
    };
    assert_eq!(
        resolve(&anchor, &original, &original).unwrap(),
        AnchorResolution::Exact
    );
    assert_eq!(
        resolve(&anchor, &original, &snapshot(b"a\nother\nz\n")).unwrap(),
        AnchorResolution::Stale
    );
    assert_eq!(
        resolve(&anchor, &original, &snapshot(b"body\nbody\n")).unwrap(),
        AnchorResolution::Ambiguous
    );
    assert!(matches!(
        resolve(&anchor, &original, &snapshot(b"prefix\na\nbody\nz\n")).unwrap(),
        AnchorResolution::Relocated {
            start_line: 3,
            end_line: 3
        }
    ));
}
#[test]
fn conflict_index_retains_three_stages() {
    let d = repo();
    git(d.path(), &["checkout", "-qb", "other"]);
    std::fs::write(d.path().join("a.cs"), "other\n").unwrap();
    git(d.path(), &["commit", "-qam", "other"]);
    git(d.path(), &["checkout", "-q", "main"]);
    std::fs::write(d.path().join("a.cs"), "main\n").unwrap();
    git(d.path(), &["commit", "-qam", "main"]);
    let output = Command::new("git")
        .arg("-C")
        .arg(d.path())
        .args(["merge", "other"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let r = GitReader::new(d.path()).unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let c = capture_now(&r, &mut db, &[RepoPath::from_bytes(b"a.cs").unwrap()]).unwrap();
    let file = db.snapshot(c.index_snapshot_id).unwrap().files.remove(0);
    assert_eq!(file.state, FileState::Conflicted);
    assert_eq!(
        file.stages.iter().map(|s| s.stage).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(file.stages[1].bytes, b"main\n");
}
#[test]
fn commit_comparison_survives_rewrite_and_gc_with_rename_delete() {
    let d = repo();
    let first = git(d.path(), &["rev-parse", "HEAD"]);
    git(d.path(), &["mv", "a.cs", "renamed.cs"]);
    git(d.path(), &["commit", "-qm", "rename"]);
    let second = git(d.path(), &["rev-parse", "HEAD"]);
    let r = GitReader::new(d.path()).unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let paths = ["a.cs", "renamed.cs"].map(|p| RepoPath::from_bytes(p.as_bytes()).unwrap());
    let old = capture_commit(&r, &mut db, &paths, &first).unwrap();
    let new = capture_commit(&r, &mut db, &paths, &second).unwrap();
    let c = compare(&mut db, old, new).unwrap();
    assert!(
        c.file_pairs
            .iter()
            .any(|p| p.old_path.is_some() && p.new_path.is_none())
    );
    assert!(
        c.file_pairs
            .iter()
            .any(|p| p.new_path.is_some() && p.old_path.is_none())
    );
    git(d.path(), &["reset", "--hard", &first]);
    git(d.path(), &["reflog", "expire", "--expire=now", "--all"]);
    git(d.path(), &["gc", "--prune=now"]);
    assert_eq!(db.snapshot(new).unwrap().files[1].bytes, b"one\r\n");
    assert_eq!(db.comparison(c.id).unwrap().target_snapshot_id, new);
}
#[test]
fn worktree_and_index_comparisons_use_distinct_endpoints() {
    let d = repo();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let c = capture_now(&r, &mut db, &[RepoPath::from_bytes(b"a.cs").unwrap()]).unwrap();
    let hi = compare(&mut db, c.head_snapshot_id, c.index_snapshot_id).unwrap();
    let iw = compare(&mut db, c.index_snapshot_id, c.worktree_snapshot_id).unwrap();
    assert_ne!(hi.id, iw.id);
    assert_eq!(hi.target_snapshot_id, iw.base_snapshot_id);
}
#[test]
fn autocrlf_does_not_confuse_git_bytes_with_worktree_bytes() {
    let d = repo();
    git(d.path(), &["config", "core.autocrlf", "input"]);
    std::fs::write(d.path().join("a.cs"), b"normalized\r\n").unwrap();
    git(d.path(), &["add", "--renormalize", "a.cs"]);
    let r = GitReader::new(d.path()).unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let c = capture_now(&r, &mut db, &[RepoPath::from_bytes(b"a.cs").unwrap()]).unwrap();
    assert_eq!(
        db.snapshot(c.index_snapshot_id).unwrap().files[0].bytes,
        b"normalized\n"
    );
    assert_eq!(
        db.snapshot(c.worktree_snapshot_id).unwrap().files[0].bytes,
        b"normalized\r\n"
    );
}
#[test]
fn partial_capture_is_not_a_deletion() {
    let d = repo();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    std::fs::write(d.path().join("b.cs"), "b").unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let pa = [RepoPath::from_bytes(b"a.cs").unwrap()];
    let pb = [RepoPath::from_bytes(b"b.cs").unwrap()];
    let a = capture_now(&r, &mut db, &pa).unwrap();
    let b = capture_now(&r, &mut db, &pb).unwrap();
    assert_eq!(
        compare(&mut db, a.worktree_snapshot_id, b.worktree_snapshot_id)
            .unwrap_err()
            .code,
        "INCOMPLETE_COMPARISON"
    );
}
#[test]
fn binary_files_are_explicitly_excluded() {
    let d = repo();
    std::fs::write(d.path().join("binary"), b"abc\0def").unwrap();
    git(d.path(), &["add", "binary"]);
    git(d.path(), &["commit", "-qm", "binary"]);
    let r = GitReader::new(d.path()).unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let ids = capture_now(&r, &mut db, &[RepoPath::from_bytes(b"binary").unwrap()]).unwrap();
    for id in [
        ids.head_snapshot_id,
        ids.index_snapshot_id,
        ids.worktree_snapshot_id,
    ] {
        let s = db.snapshot(id).unwrap();
        assert!(s.files.is_empty());
        assert_eq!(s.exclusions[0].reason, "BINARY_FILE");
    }
}
#[test]
fn snapshots_too_large_for_ipc_are_rejected_before_persistence() {
    let d = repo();
    std::fs::write(d.path().join("big-a"), vec![b'x'; 2097152]).unwrap();
    std::fs::write(d.path().join("big-b"), vec![b'x'; 2097152]).unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let paths = ["big-a", "big-b"].map(|p| RepoPath::from_bytes(p.as_bytes()).unwrap());
    assert_eq!(
        capture_now(&r, &mut db, &paths).unwrap_err().code,
        "CAPTURE_TOO_LARGE"
    );
}

fn capture_now(r: &GitReader, db: &mut Store, paths: &[RepoPath]) -> Result<CapturedState> {
    capture(r, db, paths, &r.generation_for_paths(paths)?)
}
#[test]
fn selected_ignored_bytes_invalidate_capture() {
    let d = repo();
    std::fs::write(d.path().join(".gitignore"), "ignored\n").unwrap();
    std::fs::write(d.path().join("ignored"), "before").unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let paths = [RepoPath::from_bytes(b"ignored").unwrap()];
    let expected = r.generation_for_paths(&paths).unwrap();
    std::fs::write(d.path().join("ignored"), "after").unwrap();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    assert_eq!(
        capture(&r, &mut db, &paths, &expected).unwrap_err().code,
        "STALE_STATE"
    );
}

#[test]
fn immutable_navigation_reuses_snapshots_and_comparisons_without_writes() {
    let d = repo();
    let state = tempfile::tempdir().unwrap();
    let mut db = Store::open(&state.path().join("db")).unwrap();
    let r = GitReader::new(d.path()).unwrap();
    let oid = r.head().unwrap();
    let paths = [RepoPath::from_bytes(b"a.cs").unwrap()];
    let a = capture_commit(&r, &mut db, &paths, &oid).unwrap();
    let c = compare(&mut db, a, a).unwrap();
    let revision = db.history_revision().unwrap();
    for _ in 0..5 {
        assert_eq!(capture_commit(&r, &mut db, &paths, &oid).unwrap(), a);
        assert_eq!(compare(&mut db, a, a).unwrap().id, c.id);
    }
    assert_eq!(db.history_revision().unwrap(), revision);
    let other = capture_commit(
        &r,
        &mut db,
        &[RepoPath::from_bytes(b"missing.cs").unwrap()],
        &oid,
    )
    .unwrap();
    assert_ne!(a, other);
}
