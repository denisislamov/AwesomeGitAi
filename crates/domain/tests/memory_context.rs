use agai_domain::agent::agent_call;
use agai_git::GitReader;
use agai_storage::{BundleImport, ImportedDocument, Store};
use serde_json::{Value, json};
use uuid::Uuid;
fn fixture() -> (tempfile::TempDir, Store, GitReader, Uuid) {
    let dir = tempfile::tempdir().unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(dir.path())
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(dir.path().join("a.cs"), "code\n").unwrap();
    let store = Store::open(&dir.path().join("store.sqlite")).unwrap();
    let reader = GitReader::new(dir.path()).unwrap();
    (dir, store, reader, Uuid::new_v4())
}
fn args(r: &GitReader) -> Value {
    json!({"schema_version":1,"repo_id":r.repo_id,"worktree_id":r.worktree_id,"task":"movement","paths":["a.cs"],"budget_chars":20000})
}
fn put(s: &mut Store, r: &GitReader, id: &str, mut data: Value) {
    data["revision"] = json!(1);
    data["id"] = json!(id);
    s.put_doc("decision", id, r.repo_id, r.worktree_id, 0, &data)
        .unwrap();
}
#[test]
fn context_contains_full_relevant_sources_but_not_superseded_or_foreign_paths() {
    let (_dir, mut s, r, g) = fixture();
    put(
        &mut s,
        &r,
        "current",
        json!({"summary":"movement","rationale":"reason unique","alternatives":[{"name":"rejected","reason":"slow"}],"constraints":["keep determinism"],"unresolved":["pending perf"],"anchors":[{"path":"a.cs"}]}),
    );
    put(
        &mut s,
        &r,
        "old",
        json!({"summary":"old omitted","superseded_by":"current","anchors":[{"path":"a.cs"}]}),
    );
    put(
        &mut s,
        &r,
        "other",
        json!({"summary":"foreign omitted","anchors":[{"path":"other.cs"}]}),
    );
    s.import_bundle(&BundleImport{bundle_id:"bundle".into(),source_hash:"hash".into(),repo_id:r.repo_id,worktree_id:r.worktree_id,documents:vec![ImportedDocument{kind:"decision".into(),source_id:"external".into(),data:json!({"summary":"external movement","rationale":"external reason","accepted":true,"anchors":[{"path":"a.cs"}]})}],snapshots:vec![]}).unwrap();
    let result = agent_call(&mut s, &r, g, "context_get", args(&r)).unwrap();
    let content = result["content"].as_str().unwrap();
    assert!(content.contains("reason unique"));
    assert!(content.contains("\"revision\":1"));
    assert!(content.contains("pending perf"));
    assert!(content.contains("rejected"));
    assert!(content.contains("external reason"));
    assert!(content.contains("untrusted_source_material"));
    assert!(content.contains("not_local_acceptance"));
    assert!(!content.contains("old omitted"));
    assert!(!content.contains("foreign omitted"));
}
#[test]
fn context_cursor_reassembles_budget_and_rejects_changed_memory() {
    let (_dir, mut s, r, g) = fixture();
    put(
        &mut s,
        &r,
        "current",
        json!({"summary":"movement","rationale":"x".repeat(1000),"anchors":[{"path":"a.cs"}]}),
    );
    let mut request = args(&r);
    request["budget_chars"] = json!(256);
    let first = agent_call(&mut s, &r, g, "context_get", request.clone()).unwrap();
    assert!(first["cursor"].is_string());
    request["snapshot_id"] = first["snapshot_id"].clone();
    request["cursor"] = first["cursor"].clone();
    let next = agent_call(&mut s, &r, g, "context_get", request.clone()).unwrap();
    assert_eq!(next["content"].as_str().unwrap().chars().count(), 256);
    put(
        &mut s,
        &r,
        "changed",
        json!({"summary":"new movement","rationale":"changed","anchors":[{"path":"a.cs"}]}),
    );
    assert_eq!(
        agent_call(&mut s, &r, g, "context_get", request)
            .unwrap_err()
            .code,
        "INVALID_CURSOR"
    );
}
#[test]
fn context_reports_record_cap_and_keeps_session_unresolved_sources() {
    let (_dir, mut s, r, g) = fixture();
    for i in 0..101 {
        put(
            &mut s,
            &r,
            &format!("d{i}"),
            json!({"summary":"movement","rationale":"retained","anchors":[{"path":"a.cs"}]}),
        );
    }
    s.put_doc("agent_session","session",r.repo_id,r.worktree_id,0,&json!({"revision":1,"paths":["a.cs"],"task":"movement","unresolved":["session unresolved item"]})).unwrap();
    let mut request = args(&r);
    request["budget_chars"] = json!(100000);
    let result = agent_call(&mut s, &r, g, "context_get", request).unwrap();
    assert_eq!(result["memory_omitted_count"], 2);
    assert_eq!(result["memory_truncated"], true);
    let content = result["content"].as_str().unwrap();
    assert!(content.contains("session unresolved item"));
    assert!(content.contains("additional relevant records omitted"));
}
#[test]
fn multihop_import_preserves_source_identity_and_context() {
    use agai_domain::{
        bundle::{BundleSelection, export, inspect},
        memory::{MemoryFilter, import_bundle, search},
    };
    let (_dir, mut s, r, g) = fixture();
    let (r1, w1) = (Uuid::new_v4(), Uuid::new_v4());
    let records = vec![
        json!({"id":"source-session","kind":"agent_session","data":{"actor":"original actor","task":"movement","paths":["a.cs"]},"external":false}),
        json!({"id":"source-decision","kind":"decision","data":{"session_id":"source-session","summary":"movement","rationale":"multi hop rationale","accepted":true,"anchors":[{"path":"a.cs"}]},"external":false}),
        json!({"id":"source-review","kind":"human_review","data":{"state":"accepted","decision_id":"source-decision"},"external":false}),
    ];
    let archive = export(&BundleSelection {
        source_id: Uuid::new_v4().to_string(),
        records,
        snapshots: vec![],
    })
    .unwrap();
    let first = inspect(&archive).unwrap();
    import_bundle(&mut s, &first, "hash1", r1, w1).unwrap();
    let exported = s
        .memory_records(r1, w1)
        .unwrap()
        .into_iter()
        .map(|r| serde_json::to_value(r).unwrap())
        .collect();
    let archive = export(&BundleSelection {
        source_id: Uuid::new_v4().to_string(),
        records: exported,
        snapshots: vec![],
    })
    .unwrap();
    let second = inspect(&archive).unwrap();
    import_bundle(&mut s, &second, "hash2", r.repo_id, r.worktree_id).unwrap();
    let rows = s
        .docs("imported_decision", r.repo_id, r.worktree_id)
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["provenance"]["source_id"], "source-decision");
    assert_eq!(rows[0]["source"]["accepted"], true);
    assert!(
        s.docs("decision", r.repo_id, r.worktree_id)
            .unwrap()
            .is_empty()
    );
    assert!(
        s.docs("human_review", r.repo_id, r.worktree_id)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        s.docs("imported_human_review", r.repo_id, r.worktree_id)
            .unwrap()
            .len(),
        1
    );
    let filtered = search(
        &s,
        r.repo_id,
        r.worktree_id,
        &MemoryFilter {
            actor: Some("original actor".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(filtered.items.iter().any(|r| r.kind == "imported_decision"));
    let context = agent_call(&mut s, &r, g, "context_get", args(&r)).unwrap();
    assert!(
        context["content"]
            .as_str()
            .unwrap()
            .contains("multi hop rationale")
    );
    assert!(context["content"].as_str().unwrap().contains("hash1"));
}
