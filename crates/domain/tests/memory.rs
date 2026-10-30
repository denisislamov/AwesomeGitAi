use agai_domain::{
    memory::{MemoryFilter, search},
    redaction::{RedactionSelection, redact},
};
use agai_storage::Store;
use serde_json::json;
use uuid::Uuid;
#[test]
fn memory_filters_history_and_paginates_and_requires_confirmation() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    for (id, status) in [("old", "superseded"), ("new", "active")] {
        s.put_doc("decision",id,r,w,0,&json!({"id":id,"revision":1,"summary":"movement","status":status,"actor":"alice","snapshot_id":"snap","paths":["src/a.cs"]})).unwrap();
    }
    let filter = MemoryFilter {
        query: Some("movement".into()),
        actor: Some("alice".into()),
        limit: 1,
        ..Default::default()
    };
    let page = search(&s, r, w, &filter).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.next_offset, Some(1));
    assert_eq!(page.items[0].data["status"], "superseded");
    assert!(redact(&mut s, r, w, &RedactionSelection { confirmed: false }).is_err());
    assert_eq!(
        search(&s, r, w, &MemoryFilter::default())
            .unwrap()
            .items
            .len(),
        2
    );
}
#[test]
fn import_preserves_external_claims_and_retry() {
    use agai_domain::{
        bundle::{BundleContents, BundleManifest},
        memory::import_bundle,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    let contents = BundleContents {
        manifest: BundleManifest {
            schema_major: 1,
            bundle_id: Uuid::new_v4().to_string(),
            source_id: Uuid::new_v4().to_string(),
            entries: vec![],
            exclusions: vec![],
        },
        records: vec![
            json!({"kind":"decision","id":"d","data":{"summary":"imported","accepted":true},"external":false}),
        ],
        snapshots: vec![],
    };
    let a = import_bundle(&mut s, &contents, "digest", r, w).unwrap();
    assert_eq!(a, import_bundle(&mut s, &contents, "digest", r, w).unwrap());
    assert!(s.docs("decision", r, w).unwrap().is_empty());
    let rows = s.docs("imported_decision", r, w).unwrap();
    assert_eq!(rows[0]["source"]["accepted"], true);
    assert!(rows[0].get("accepted").is_none());
}
#[test]
fn filters_inherit_session_actor_task_and_paths_without_scope_leak() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("db")).unwrap();
    let (r, w) = (Uuid::new_v4(), Uuid::new_v4());
    s.put_doc(
        "agent_session",
        "session",
        r,
        w,
        0,
        &json!({"revision":1,"actor":"alice","task":"movement task","paths":["src/a.cs"]}),
    )
    .unwrap();
    s.put_doc("decision","decision",r,w,0,&json!({"revision":1,"session_id":"session","snapshot_id":"snap","summary":"movement","superseded_by":"new"})).unwrap();
    let filter = MemoryFilter {
        actor: Some("alice".into()),
        task_id: Some("movement task".into()),
        snapshot_id: Some("snap".into()),
        path: Some("src/a.cs".into()),
        ..Default::default()
    };
    let page = search(&s, r, w, &filter).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, "decision");
    assert!(
        search(&s, r, Uuid::new_v4(), &filter)
            .unwrap()
            .items
            .is_empty()
    );
    assert!(
        search(
            &s,
            r,
            w,
            &MemoryFilter {
                actor: Some("bob".into()),
                ..filter
            }
        )
        .unwrap()
        .items
        .is_empty()
    );
}
