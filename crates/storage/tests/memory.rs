use agai_storage::{BundleImport, ImportedDocument, Store};
use serde_json::json;
use uuid::Uuid;
#[test]
fn import_is_atomic_idempotent_external_and_scoped() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    let mut b = BundleImport {
        bundle_id: "bundle".into(),
        source_hash: "digest".into(),
        repo_id: r,
        worktree_id: w,
        documents: vec![ImportedDocument {
            kind: "decision".into(),
            source_id: "external".into(),
            data: json!({"summary":"secret","accepted":true}),
        }],
        snapshots: vec![],
    };
    let a = s.import_bundle(&b).unwrap();
    assert_eq!(a, s.import_bundle(&b).unwrap());
    assert!(s.docs("decision", r, w).unwrap().is_empty());
    let rows = s.memory_records(r, w).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].data["source"]["accepted"], true);
    assert!(s.memory_records(r, Uuid::new_v4()).unwrap().is_empty());
    b.source_hash = "changed".into();
    assert_eq!(
        s.import_bundle(&b).unwrap_err().code,
        "IDEMPOTENCY_CONFLICT"
    );
    s.redact_memory_scope(r, w).unwrap();
    assert!(s.memory_records(r, w).unwrap().is_empty());
    assert_eq!(s.import_bundle(&b).unwrap_err().code, "REDACTED");
}
#[test]
fn redaction_erases_disk_indexes_receipts_and_retains_other_scope() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut s = Store::open(&path).unwrap();
    let (r, w, other) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let secret = "UNIQUE_SENSITIVE_CONTENT_934986123";
    let grant = Uuid::new_v4().to_string();
    s.commit_docs(
        &grant,
        "key",
        "fp",
        &json!({"secret":secret}),
        &[agai_storage::DocumentChange {
            kind: "decision".into(),
            id: "d".into(),
            repo_id: r,
            worktree_id: w,
            expected_revision: 0,
            data: json!({"revision":1,"summary":secret,"rationale":secret,"grant_id":grant}),
        }],
    )
    .unwrap();
    s.put_doc(
        "decision",
        "other",
        r,
        other,
        0,
        &json!({"revision":1,"summary":"preserved"}),
    )
    .unwrap();
    assert_eq!(s.search_decisions(r, w, secret).unwrap().len(), 1);
    s.redact_memory_scope(r, w).unwrap();
    s.rebuild_index().unwrap();
    assert!(s.search_decisions(r, w, secret).unwrap().is_empty());
    assert!(s.receipt(&grant, "key", "fp").unwrap().is_none());
    assert_eq!(s.docs("decision", r, other).unwrap().len(), 1);
    drop(s);
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()));
    }
}
#[test]
fn invalid_import_rolls_back_all_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    let b = BundleImport {
        bundle_id: "b".into(),
        source_hash: "hash".into(),
        repo_id: r,
        worktree_id: w,
        documents: vec![
            ImportedDocument {
                kind: "decision".into(),
                source_id: "a".into(),
                data: json!({}),
            },
            ImportedDocument {
                kind: "invalid/kind".into(),
                source_id: "b".into(),
                data: json!({}),
            },
        ],
        snapshots: vec![],
    };
    assert!(s.import_bundle(&b).is_err());
    assert!(s.memory_records(r, w).unwrap().is_empty());
}
#[test]
fn owned_backup_is_scope_scrubbed_and_grants_never_catalogued() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let mut s = Store::open(&path).unwrap();
    let (r, w, other) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let secret = "BACKUP_SECRET_765923517";
    s.put_doc(
        "decision",
        "d",
        r,
        w,
        0,
        &json!({"revision":1,"summary":secret}),
    )
    .unwrap();
    s.put_doc(
        "decision",
        "o",
        r,
        other,
        0,
        &json!({"revision":1,"summary":"preserved"}),
    )
    .unwrap();
    s.put_doc("agent_grant", "token_hash", r, w, 0, &json!({"revision":1}))
        .unwrap();
    assert_eq!(s.memory_records(r, w).unwrap().len(), 1);
    let backup = path.with_extension("v2.bak");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute("VACUUM INTO ?1", [backup.to_str().unwrap()])
        .unwrap();
    drop(conn);
    s.redact_memory_scope(r, w).unwrap();
    drop(s);
    let backup_store = Store::open(&backup).unwrap();
    assert!(backup_store.docs("decision", r, w).unwrap().is_empty());
    assert_eq!(backup_store.docs("decision", r, other).unwrap().len(), 1);
    drop(backup_store);
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()));
    }
}
#[test]
fn catalog_is_metadata_only_and_capped() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    for id in ["a", "b"] {
        s.put_doc(
            "trace",
            id,
            r,
            w,
            0,
            &json!({"revision":1,"title":"Example","artifact":{"secret":"RAW_CODE_MUST_NOT_LEAK"}}),
        )
        .unwrap();
    }
    let catalog = s.memory_catalog_records(r, w, 1).unwrap();
    assert_eq!(catalog.total, 2);
    assert!(catalog.truncated);
    assert_eq!(catalog.items.len(), 1);
    assert!(
        !serde_json::to_string(&catalog)
            .unwrap()
            .contains("RAW_CODE")
    );
    assert_eq!(catalog.items[0]["title"], "Example");
    assert!(s.memory_snapshot_catalog(r, w, 1).unwrap().items.is_empty());
}
#[test]
fn snapshot_catalog_projects_only_metadata_and_validates_limit() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    let snapshot = agai_protocol::Snapshot {
        id: Uuid::new_v4(),
        repo_id: r,
        worktree_id: w,
        layer: agai_protocol::Layer::Worktree,
        generation: "private-generation".into(),
        files: vec![agai_protocol::SnapshotFile::new(
            agai_protocol::RepoPath::from_bytes(b"a.cs").unwrap(),
            Some(vec![120; 100000]),
            None,
        )],
        exclusions: vec![],
        captured_at: "fixture-time".into(),
    };
    s.import_bundle(&BundleImport {
        bundle_id: "snapshot-only".into(),
        source_hash: "digest".into(),
        repo_id: r,
        worktree_id: w,
        documents: vec![],
        snapshots: vec![snapshot],
    })
    .unwrap();
    let catalog = s.memory_snapshot_catalog(r, w, 1000).unwrap();
    assert_eq!(catalog.total, 1);
    assert!(!catalog.truncated);
    assert_eq!(catalog.items[0]["file_count"], 1);
    assert_eq!(catalog.items[0]["captured_at"], "fixture-time");
    assert!(catalog.items[0].get("files").is_none());
    assert!(serde_json::to_string(&catalog).unwrap().len() < 512);
    assert_eq!(
        s.memory_snapshot_catalog(r, w, 1001).unwrap_err().code,
        "INVALID_REQUEST"
    );
}
