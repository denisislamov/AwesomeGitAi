use agai_storage::Store;
use serde_json::json;
use uuid::Uuid;
#[test]
fn history_roundtrip_preserves_sources_and_excludes_credentials() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a.db")).unwrap();
    let b = Store::open(&dir.path().join("b.db")).unwrap();
    let r = Uuid::new_v4();
    let w = Uuid::new_v4();
    let data = json!({"revision":1,"id":"d","repo_id":r,"worktree_id":w,"summary":"why","rationale":"exact\ntext","alternatives":["other"]});
    a.put_doc("decision", "d", r, w, 0, &data).unwrap();
    a.put_doc("agent_grant", "secret", r, w, 0, &json!({"revision":1}))
        .unwrap();
    let image = a.history_image(r, w).unwrap();
    assert!(!serde_json::to_string(&image).unwrap().contains("secret"));
    b.restore_history(&image).unwrap();
    assert_eq!(b.history_image(r, w).unwrap(), image);
    assert_eq!(b.doc("decision", "d").unwrap(), Some(data));
    assert_eq!(b.doc("agent_grant", "secret").unwrap(), None);
    assert_eq!(b.search_decisions(r, w, "why").unwrap(), vec!["d"]);
    b.restore_history(&image).unwrap();
}
#[test]
fn restore_rejects_cross_scope_collisions_without_losing_existing_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a.db")).unwrap();
    let mut b = Store::open(&dir.path().join("b.db")).unwrap();
    let r = Uuid::new_v4();
    let w = Uuid::new_v4();
    a.put_doc("trace", "same", r, w, 0, &json!({"revision":1}))
        .unwrap();
    let other = Uuid::new_v4();
    b.put_doc(
        "trace",
        "same",
        r,
        other,
        0,
        &json!({"revision":1,"value":"keep"}),
    )
    .unwrap();
    let before = b.history_image(r, other).unwrap();
    assert!(b.restore_history(&a.history_image(r, w).unwrap()).is_err());
    assert_eq!(b.history_image(r, other).unwrap(), before);
}
#[test]
fn all_tables_roundtrip_and_other_scopes_survive() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("a");
    let a = Store::open(&path).unwrap();
    let r = Uuid::new_v4();
    let w = Uuid::new_v4();
    let conn = rusqlite::Connection::open(path).unwrap();
    let rr = r.to_string();
    let ww = w.to_string();
    conn.execute(
        "INSERT INTO documents VALUES('agent_session','session',?1,?2,1,?3)",
        rusqlite::params![
            rr,
            ww,
            json!({"revision":1,"id":"session","grant_id":"grant"}).to_string()
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO snapshots VALUES('s',?1,?2,?3)",
        rusqlite::params![
            rr,
            ww,
            "{ \"bytes\": [0,255,128], \"provenance\": \"original\" }"
        ],
    )
    .unwrap();
    conn.execute("INSERT INTO events(id,repo_id,worktree_id,request_key,fingerprint,receipt,summary,data) VALUES('e',?1,?2,'key','fingerprint','{}','summary','{}')",rusqlite::params![rr,ww]).unwrap();
    conn.execute(
        "INSERT INTO comparisons VALUES('c',?1)",
        [json!({"base_snapshot_id":"s","target_snapshot_id":"s"}).to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO operation_receipts VALUES('grant','k','f','{}')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO bundle_imports VALUES(?1,?2,'bundle','f','{}',0)",
        rusqlite::params![rr, ww],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO redaction_tombstones VALUES('t',?1,?2)",
        rusqlite::params![rr, ww],
    )
    .unwrap();
    let image = a.history_image(r, w).unwrap();
    assert!(image.tables.values().all(|rows| rows.len() == 1));
    let mut b = Store::open(&d.path().join("b")).unwrap();
    let other = Uuid::new_v4();
    b.put_doc(
        "decision",
        "other",
        r,
        other,
        0,
        &json!({"revision":1,"summary":"keep"}),
    )
    .unwrap();
    let before = b.history_image(r, other).unwrap();
    b.restore_history(&image).unwrap();
    assert_eq!(image, b.history_image(r, w).unwrap());
    assert_eq!(before, b.history_image(r, other).unwrap());
    assert_eq!(b.search(r, "summary").unwrap_err().code, "INVALID_DATA"); // raw fixture event ID intentionally not UUID
}
