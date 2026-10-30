use agai_protocol::*;
use serde_json::json;
use std::{
    path::Path,
    process::Command,
    time::{Duration, Instant},
};
fn git(p: &Path, a: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(p)
        .args(a)
        .output()
        .unwrap();
    assert!(o.status.success());
    String::from_utf8_lossy(&o.stdout).trim().into()
}
fn call(h: &mut agai_host::HostService, v: serde_json::Value) -> Result<DesktopResponse> {
    h.desktop(
        &Principal::LocalUser,
        serde_json::from_value(v).map_err(|_| AppError::new("INVALID_REQUEST"))?,
    )
}
#[test]
fn jobs_are_local_scoped_and_partial_preview_is_bound_to_generation() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("repo");
    std::fs::create_dir(&p).unwrap();
    git(&p, &["init", "-q"]);
    git(&p, &["config", "user.name", "Test"]);
    git(&p, &["config", "user.email", "t@example.invalid"]);
    std::fs::write(p.join("a"), "old\nkeep\n").unwrap();
    git(&p, &["add", "a"]);
    git(&p, &["commit", "-qm", "base"]);
    std::fs::write(p.join("a"), "new\nkeep\nextra\n").unwrap();
    let mut h =
        agai_host::HostService::new(agai_storage::Store::open(&d.path().join("db")).unwrap());
    let state = h.register_repository(&p).unwrap();
    let scope = json!({"repo_id":state.repo_id,"worktree_id":state.worktree_id});
    let path = RepoPath::from_bytes(b"a").unwrap();
    let c = call(
        &mut h,
        json!({"kind":"CompareFile","scope":scope,"path":path,"base":"Index","target":"Worktree"}),
    )
    .unwrap();
    let c = serde_json::to_value(c).unwrap();
    let req = json!({"kind":"PrepareSelection","scope":scope,"comparison_id":c["comparison"]["id"],"path":path,"expected_generation":state.generation,"old_lines":[1],"new_lines":[1],"unstage":false});
    let preview = call(&mut h, req.clone()).unwrap();
    let preview = serde_json::to_value(preview).unwrap();
    assert_eq!(preview["after"], "new\nkeep\n");
    assert_eq!(git(&p, &["show", ":a"]), "old\nkeep");
    let start = json!({"kind":"GitStart","scope":scope,"expected_generation":state.generation,"action":{"kind":"ApplyPrepared","id":preview["id"]}});
    assert_eq!(
        h.desktop(
            &Principal::RemoteDevice {
                device_id: uuid::Uuid::new_v4()
            },
            serde_json::from_value(start.clone()).unwrap()
        )
        .unwrap_err()
        .code,
        "SCOPE_DENIED"
    );
    let job = serde_json::to_value(call(&mut h, start).unwrap()).unwrap();
    let id = &job["job"]["id"];
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let r =
            serde_json::to_value(call(&mut h, json!({"kind":"GitPoll","id":id})).unwrap()).unwrap();
        if r["job"]["status"] != "Running" {
            assert_eq!(r["job"]["status"], "Succeeded", "{r}");
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(git(&p, &["show", ":a"]), "new\nkeep");
    assert_eq!(std::fs::read(p.join("a")).unwrap(), b"new\nkeep\nextra\n");
    assert_eq!(call(&mut h, req).unwrap_err().code, "STALE_STATE");
}
#[test]
fn cancelling_post_commit_reports_the_actual_ref_change() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("repo");
    std::fs::create_dir(&p).unwrap();
    git(&p, &["init", "-q"]);
    git(&p, &["config", "user.name", "Test"]);
    git(&p, &["config", "user.email", "t@example.invalid"]);
    std::fs::write(p.join("a"), "one").unwrap();
    git(&p, &["add", "a"]);
    git(&p, &["commit", "-qm", "base"]);
    let before = git(&p, &["rev-parse", "HEAD"]);
    std::fs::write(p.join("a"), "two").unwrap();
    git(&p, &["add", "a"]);
    let hook = p.join(".git/hooks/post-commit");
    std::fs::write(&hook, "#!/bin/sh\nsleep 30\n").unwrap();
    std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut h =
        agai_host::HostService::new(agai_storage::Store::open(&d.path().join("db")).unwrap());
    let state = h.register_repository(&p).unwrap();
    let job=call(&mut h,json!({"kind":"GitStart","scope":{"repo_id":state.repo_id,"worktree_id":state.worktree_id},"expected_generation":state.generation,"action":{"kind":"Commit","message":"completed before cancel"}})).unwrap();
    let job = serde_json::to_value(job).unwrap();
    let id = &job["job"]["id"];
    let deadline = Instant::now() + Duration::from_secs(5);
    while git(&p, &["rev-parse", "HEAD"]) == before {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    call(&mut h, json!({"kind":"GitCancel","id":id})).unwrap();
    loop {
        let r =
            serde_json::to_value(call(&mut h, json!({"kind":"GitPoll","id":id})).unwrap()).unwrap();
        if r["job"]["status"] != "Running" {
            assert_eq!(r["job"]["status"], "Cancelled");
            assert_eq!(r["job"]["state_changed"], true);
            assert_eq!(r["job"]["outcome_uncertain"], true);
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_ne!(git(&p, &["rev-parse", "HEAD"]), before);
}
