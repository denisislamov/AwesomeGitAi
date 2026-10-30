use agai_git::{
    GitReader,
    operations::{Mutation, execute, select_lines},
};
use agai_protocol::*;
use std::{path::Path, process::Command, sync::atomic::AtomicBool};
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
fn fixture() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    git(d.path(), &["init", "-q"]);
    git(d.path(), &["config", "user.name", "Test"]);
    git(d.path(), &["config", "user.email", "test@example.invalid"]);
    std::fs::write(d.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
    git(d.path(), &["add", "a.txt"]);
    git(d.path(), &["commit", "-qm", "initial"]);
    d
}
fn run(r: &GitReader, m: Mutation) -> Result<()> {
    execute(r, m, &r.state()?.generation, &AtomicBool::new(false))
}
#[test]
fn selected_insertions_and_deletions_preserve_unselected_bytes() {
    let old = b"one\ntwo\nthree\n";
    let new = b"ONE\ntwo\nTHREE\n";
    assert_eq!(
        select_lines(old, new, &[1], &[1]).unwrap(),
        b"ONE\ntwo\nthree\n"
    );
    assert_eq!(select_lines(old, new, &[3], &[]).unwrap(), b"one\ntwo\n");
    assert_eq!(
        select_lines(b"a\r\nb\r\n", b"a\r\nB\r\n", &[2], &[2]).unwrap(),
        b"a\r\nB\r\n"
    );
}
#[test]
fn stage_unstage_commit_and_branch_preserve_worktree() {
    let d = fixture();
    let r = GitReader::new(d.path()).unwrap();
    let path = RepoPath::from_bytes(b"a.txt").unwrap();
    std::fs::write(d.path().join("a.txt"), "ONE\ntwo\nTHREE\n").unwrap();
    run(
        &r,
        Mutation::IndexBytes {
            path: path.clone(),
            bytes: Some(b"ONE\ntwo\nthree\n".to_vec()),
        },
    )
    .unwrap();
    assert_eq!(git(d.path(), &["show", ":a.txt"]), "ONE\ntwo\nthree");
    assert_eq!(
        std::fs::read(d.path().join("a.txt")).unwrap(),
        b"ONE\ntwo\nTHREE\n"
    );
    run(&r, Mutation::Unstage { path: path.clone() }).unwrap();
    assert_eq!(git(d.path(), &["show", ":a.txt"]), "one\ntwo\nthree");
    run(&r, Mutation::Stage { path }).unwrap();
    run(
        &r,
        Mutation::Commit {
            message: "selected change".into(),
        },
    )
    .unwrap();
    run(
        &r,
        Mutation::CreateBranch {
            name: "feature/test".into(),
        },
    )
    .unwrap();
    run(
        &r,
        Mutation::SwitchBranch {
            name: "feature/test".into(),
        },
    )
    .unwrap();
    assert_eq!(git(d.path(), &["branch", "--show-current"]), "feature/test");
}
#[test]
fn stale_generation_refuses_any_write() {
    let d = fixture();
    let r = GitReader::new(d.path()).unwrap();
    let before = git(d.path(), &["rev-parse", "HEAD"]);
    let e = execute(
        &r,
        Mutation::Commit {
            message: "bad".into(),
        },
        "stale",
        &AtomicBool::new(false),
    )
    .unwrap_err();
    assert_eq!(e.code, "STALE_STATE");
    assert_eq!(git(d.path(), &["rev-parse", "HEAD"]), before);
}
#[test]
fn init_clone_and_local_remote_roundtrip() {
    let temp = tempfile::tempdir().unwrap();
    let bare = temp.path().join("origin.git");
    assert!(
        Command::new("git")
            .args(["init", "--bare", "-q"])
            .arg(&bare)
            .status()
            .unwrap()
            .success()
    );
    let path = temp.path().join("first");
    agai_git::operations::create_repository(&path, None, &AtomicBool::new(false)).unwrap();
    git(&path, &["config", "user.name", "Test"]);
    git(&path, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(path.join("a"), "one\n").unwrap();
    git(&path, &["add", "a"]);
    git(&path, &["commit", "-qm", "initial"]);
    git(&path, &["branch", "-M", "main"]);
    git(&path, &["remote", "add", "origin", bare.to_str().unwrap()]);
    let r = GitReader::new(&path).unwrap();
    run(
        &r,
        Mutation::Push {
            remote: "origin".into(),
            branch: "main".into(),
        },
    )
    .unwrap();
    git(&bare, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    let other = temp.path().join("second");
    agai_git::operations::create_repository(
        &other,
        Some(bare.to_str().unwrap()),
        &AtomicBool::new(false),
    )
    .unwrap();
    git(&other, &["config", "user.name", "Test"]);
    git(&other, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(path.join("a"), "two\n").unwrap();
    git(&path, &["commit", "-am", "next", "-q"]);
    run(
        &r,
        Mutation::Push {
            remote: "origin".into(),
            branch: "main".into(),
        },
    )
    .unwrap();
    let r2 = GitReader::new(&other).unwrap();
    run(
        &r2,
        Mutation::Fetch {
            remote: "origin".into(),
        },
    )
    .unwrap();
    run(
        &r2,
        Mutation::Pull {
            remote: "origin".into(),
            branch: "main".into(),
        },
    )
    .unwrap();
    assert_eq!(std::fs::read(other.join("a")).unwrap(), b"two\n");
    std::fs::write(path.join("a"), "remote\n").unwrap();
    git(&path, &["commit", "-am", "remote", "-q"]);
    run(
        &r,
        Mutation::Push {
            remote: "origin".into(),
            branch: "main".into(),
        },
    )
    .unwrap();
    std::fs::write(other.join("a"), "local\n").unwrap();
    git(&other, &["commit", "-am", "local", "-q"]);
    let before = git(&other, &["rev-parse", "HEAD"]);
    assert_eq!(
        run(
            &r2,
            Mutation::Pull {
                remote: "origin".into(),
                branch: "main".into()
            }
        )
        .unwrap_err()
        .code,
        "NON_FAST_FORWARD"
    );
    assert_eq!(git(&other, &["rev-parse", "HEAD"]), before);
}
#[test]
fn hooks_execute_and_cancellation_preserves_actual_commit_state() {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;
    let d = fixture();
    std::fs::write(d.path().join("a.txt"), "modified\n").unwrap();
    git(d.path(), &["add", "a.txt"]);
    let r = GitReader::new(d.path()).unwrap();
    let before = r.head();
    let hook = d.path().join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        run(
            &r,
            Mutation::Commit {
                message: "blocked".into()
            }
        )
        .unwrap_err()
        .code,
        "GIT_COMMAND_FAILED"
    );
    assert_eq!(r.head(), before);
    std::fs::write(&hook, "#!/bin/sh\nsleep 30\n").unwrap();
    let flag = Arc::new(AtomicBool::new(false));
    let flag2 = flag.clone();
    let t = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        flag2.store(true, std::sync::atomic::Ordering::Relaxed);
    });
    let start = std::time::Instant::now();
    assert_eq!(
        execute(
            &r,
            Mutation::Commit {
                message: "cancelled".into()
            },
            &r.state().unwrap().generation,
            &flag
        )
        .unwrap_err()
        .code,
        "CANCELLED"
    );
    t.join().unwrap();
    assert!(start.elapsed().as_secs() < 5);
    assert_eq!(r.head(), before);
}
#[test]
fn missing_ssh_credentials_are_actionable_and_do_not_change_head() {
    use std::os::unix::fs::PermissionsExt;
    let d = fixture();
    let p = d.path();
    let ssh = p.join("fake-ssh");
    std::fs::write(
        &ssh,
        "#!/bin/sh\necho 'Permission denied (publickey).' >&2\nexit 255\n",
    )
    .unwrap();
    std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();
    git(p, &["config", "core.sshCommand", ssh.to_str().unwrap()]);
    git(
        p,
        &["remote", "add", "origin", "ssh://git@example.invalid/repo"],
    );
    let r = GitReader::new(p).unwrap();
    let head = r.head();
    let result = execute(
        &r,
        Mutation::Fetch {
            remote: "origin".into(),
        },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    );
    assert_eq!(result.unwrap_err().code, "AUTH_INTERACTION_REQUIRED");
    assert_eq!(r.head(), head);
}
#[test]
fn partial_deletion_new_file_and_unborn_unstage_preserve_exact_bytes() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path();
    git(p, &["init", "-q"]);
    git(p, &["config", "core.autocrlf", "false"]);
    std::fs::write(p.join("new"), b"first\r\nsecond").unwrap();
    let r = GitReader::new(p).unwrap();
    let path = RepoPath::from_bytes(b"new").unwrap();
    execute(
        &r,
        Mutation::IndexBytes {
            path: path.clone(),
            bytes: Some(b"first\r\n".to_vec()),
        },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    )
    .unwrap();
    let o = Command::new("git")
        .arg("-C")
        .arg(p)
        .args(["show", ":new"])
        .output()
        .unwrap();
    assert_eq!(o.stdout, b"first\r\n");
    assert_eq!(std::fs::read(p.join("new")).unwrap(), b"first\r\nsecond");
    execute(
        &r,
        Mutation::Unstage { path: path.clone() },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert!(
        Command::new("git")
            .arg("-C")
            .arg(p)
            .args(["ls-files"])
            .output()
            .unwrap()
            .stdout
            .is_empty()
    );
    let selected = select_lines(b"first\r\nsecond", b"", &[2], &[]).unwrap();
    assert_eq!(selected, b"first\r\n");
    execute(
        &r,
        Mutation::Stage { path: path.clone() },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    )
    .unwrap();
    execute(
        &r,
        Mutation::IndexBytes { path, bytes: None },
        &r.state().unwrap().generation,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert!(p.join("new").exists());
}
