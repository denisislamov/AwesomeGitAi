use agai_storage::{DocumentChange, Store};
use serde_json::json;
use uuid::Uuid;
#[test]
fn atomic_cas_receipt_survives_restart_and_rejects_conflicts() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("db");
    let repo = Uuid::new_v4();
    let wt = Uuid::new_v4();
    let change = |id: &str, rev: u64| DocumentChange {
        kind: "decision".into(),
        id: id.into(),
        repo_id: repo,
        worktree_id: wt,
        expected_revision: rev,
        data: json!({"id":id,"revision":rev+1}),
    };
    let mut store = Store::open(&path).unwrap();
    store
        .commit_docs(
            "grant",
            "key",
            "hash",
            &json!({"id":"a"}),
            &[change("a", 0)],
        )
        .unwrap();
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(
        store.receipt("grant", "key", "hash").unwrap(),
        Some(json!({"id":"a"}))
    );
    assert_eq!(
        store.receipt("grant", "key", "different").unwrap_err().code,
        "IDEMPOTENCY_CONFLICT"
    );
    assert!(
        store
            .commit_docs(
                "grant",
                "new",
                "x",
                &json!({}),
                &[change("b", 0), change("a", 0)]
            )
            .is_err()
    );
    assert!(store.doc("decision", "b").unwrap().is_none());
    assert!(store.receipt("grant", "new", "x").unwrap().is_none());
    assert_eq!(store.docs("decision", repo, wt).unwrap().len(), 1);
    assert!(
        store
            .docs("decision", repo, Uuid::new_v4())
            .unwrap()
            .is_empty()
    );
}
#[test]
fn decision_search_is_scoped_and_updates_atomically() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(&t.path().join("db")).unwrap();
    let repo = Uuid::new_v4();
    let wt = Uuid::new_v4();
    s.put_doc(
        "decision",
        "d",
        repo,
        wt,
        0,
        &json!({"revision":1,"summary":"wallet balance","rationale":"initial"}),
    )
    .unwrap();
    assert_eq!(s.search_decisions(repo, wt, "wallet").unwrap(), vec!["d"]);
    assert!(
        s.search_decisions(repo, Uuid::new_v4(), "wallet")
            .unwrap()
            .is_empty()
    );
    s.put_doc(
        "decision",
        "d",
        repo,
        wt,
        1,
        &json!({"revision":2,"summary":"inventory","rationale":"replacement"}),
    )
    .unwrap();
    assert!(s.search_decisions(repo, wt, "wallet").unwrap().is_empty());
    s.rebuild_index().unwrap();
    assert_eq!(
        s.search_decisions(repo, wt, "inventory").unwrap(),
        vec!["d"]
    );
}
