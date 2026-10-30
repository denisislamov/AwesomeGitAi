use agai_host::HostService;
use agai_protocol::*;
use agai_storage::Store;
use serde_json::{Value, json};
use uuid::Uuid;
fn rpc(h: &mut HostService, v: Value) -> Result<DesktopResponse> {
    h.desktop(&Principal::LocalUser, serde_json::from_value(v).unwrap())
}
fn data(r: DesktopResponse) -> Value {
    match r {
        DesktopResponse::MemoryResult { data } => data,
        _ => panic!(),
    }
}
#[test]
fn portable_context_preview_import_retry_leave_git_untouched() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(repo.join("keep.txt"), "unchanged").unwrap();
    let head_before = std::fs::read(repo.join(".git/HEAD")).unwrap();
    let mut host = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let r = host.register_repository(&repo).unwrap();
    let scope = json!({"repo_id":r.repo_id,"worktree_id":r.worktree_id});
    let id = Uuid::new_v4().to_string();
    host.store.put_doc("decision",&id,r.repo_id,r.worktree_id,0,&json!({"id":id,"revision":1,"summary":"Keep immutable context","rationale":"Explain before changing","actor":"test"})).unwrap();
    let preview = data(
        rpc(
            &mut host,
            json!({"kind":"BundlePreview","scope":scope,"record_ids":[id],"snapshot_ids":[]}),
        )
        .unwrap(),
    );
    assert_eq!(preview["preview"]["record_count"], 1);
    let path = d.path().join("context.zip");
    rpc(&mut host,json!({"kind":"BundleExport","scope":scope,"record_ids":[id],"snapshot_ids":[],"expected_hash":preview["hash"],"output_path":path})).unwrap();
    assert!(rpc(&mut host,json!({"kind":"BundleExport","scope":scope,"record_ids":[id],"snapshot_ids":[],"expected_hash":preview["hash"],"output_path":path})).is_err());
    let inspect = data(
        rpc(
            &mut host,
            json!({"kind":"BundleInspect","scope":scope,"input_path":path}),
        )
        .unwrap(),
    );
    let req = json!({"kind":"BundleImport","scope":scope,"input_path":path,"expected_hash":inspect["hash"],"confirm_mapping":true});
    let first = data(rpc(&mut host, req.clone()).unwrap());
    let second = data(rpc(&mut host, req).unwrap());
    assert_eq!(first, second);
    let rows = host.store.memory_records(r.repo_id, r.worktree_id).unwrap();
    assert!(rows.iter().any(|r| r.external));
    assert_eq!(
        std::fs::read_to_string(repo.join("keep.txt")).unwrap(),
        "unchanged"
    );

    assert_eq!(std::fs::read(repo.join(".git/HEAD")).unwrap(), head_before);
    let denied = host.desktop(
        &Principal::McpSession {
            session_id: Uuid::new_v4(),
        },
        serde_json::from_value(json!({"kind":"MemoryCatalog","scope":scope})).unwrap(),
    );
    assert!(denied.is_err());
}

#[test]
fn changed_previews_foreign_ids_symlinks_and_unconfirmed_erase_are_denied() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let r = h.register_repository(&repo).unwrap();
    let scope = json!({"repo_id":r.repo_id,"worktree_id":r.worktree_id});
    let foreign = Uuid::new_v4();
    h.store
        .put_doc(
            "decision",
            "other",
            foreign,
            Uuid::new_v4(),
            0,
            &json!({"revision":1,"summary":"private"}),
        )
        .unwrap();
    assert!(
        rpc(
            &mut h,
            json!({"kind":"BundlePreview","scope":scope,"record_ids":["other"],"snapshot_ids":[]})
        )
        .is_err()
    );
    let id = "local";
    h.store
        .put_doc(
            "decision",
            id,
            r.repo_id,
            r.worktree_id,
            0,
            &json!({"id":id,"revision":1,"summary":"before"}),
        )
        .unwrap();
    let p = data(
        rpc(
            &mut h,
            json!({"kind":"BundlePreview","scope":scope,"record_ids":[id],"snapshot_ids":[]}),
        )
        .unwrap(),
    );
    h.store
        .put_doc(
            "decision",
            id,
            r.repo_id,
            r.worktree_id,
            1,
            &json!({"id":id,"revision":2,"summary":"after"}),
        )
        .unwrap();
    assert_eq!(rpc(&mut h,json!({"kind":"BundleExport","scope":scope,"record_ids":[id],"snapshot_ids":[],"expected_hash":p["hash"],"output_path":d.path().join("out.zip")})).unwrap_err().code,"PREVIEW_CHANGED");
    let link = d.path().join("link");
    std::os::unix::fs::symlink(d.path().join("db"), &link).unwrap();
    assert!(
        rpc(
            &mut h,
            json!({"kind":"BundleInspect","scope":scope,"input_path":link})
        )
        .is_err()
    );
    assert_eq!(
        rpc(
            &mut h,
            json!({"kind":"MemoryErase","scope":scope,"confirmation":"yes"})
        )
        .unwrap_err()
        .code,
        "CONFIRMATION_REQUIRED"
    );
    rpc(
        &mut h,
        json!({"kind":"MemoryErase","scope":scope,"confirmation":"ERASE STORED CONTEXT"}),
    )
    .unwrap();
    assert!(h.store.doc("decision", id).unwrap().is_none());
    assert!(h.store.doc("decision", "other").unwrap().is_some());
}
#[test]
fn export_rejects_git_metadata_even_through_parent_symlink() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let r = h.register_repository(&repo).unwrap();
    let scope = json!({"repo_id":r.repo_id,"worktree_id":r.worktree_id});
    let p = data(
        rpc(
            &mut h,
            json!({"kind":"BundlePreview","scope":scope,"record_ids":[],"snapshot_ids":[]}),
        )
        .unwrap(),
    );
    let link = d.path().join("metadata");
    std::os::unix::fs::symlink(repo.join(".git"), &link).unwrap();
    for output in [repo.join(".git/index.lock"), link.join("new-file")] {
        assert!(rpc(&mut h,json!({"kind":"BundleExport","scope":scope,"record_ids":[],"snapshot_ids":[],"expected_hash":p["hash"],"output_path":output})).is_err());
        assert!(!output.exists());
    }
}
#[test]
fn oversized_memory_response_fails_before_ipc_serialization() {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    let mut h = HostService::new(Store::open(&d.path().join("db")).unwrap());
    let r = h.register_repository(&repo).unwrap();
    let scope = json!({"repo_id":r.repo_id,"worktree_id":r.worktree_id});
    h.store
        .put_doc(
            "decision",
            "large",
            r.repo_id,
            r.worktree_id,
            0,
            &json!({"revision":1,"summary":"x".repeat(8*1024*1024)}),
        )
        .unwrap();
    let result = rpc(
        &mut h,
        json!({"kind":"MemorySearch","scope":scope,"query":null,"actor":null,"task_id":null,"snapshot_id":null,"path":null,"offset":0,"limit":1}),
    );
    assert_eq!(result.unwrap_err().code, "MEMORY_RESPONSE_TOO_LARGE");
}
