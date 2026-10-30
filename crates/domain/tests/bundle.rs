use agai_domain::bundle::*;
use agai_protocol::*;
use serde_json::json;
use uuid::Uuid;
fn selection() -> BundleSelection {
    BundleSelection {
        source_id: Uuid::new_v4().to_string(),
        records: vec![
            json!({"id":"one","kind":"decision","text":"<script>alert(1)</script>","password":"hidden","path":"/Users/private/repo","nested":{"access_token":"secret"}}),
        ],
        snapshots: vec![],
    }
}
#[test]
fn roundtrip_redacts_sensitive_fields_and_preserves_inert_text() {
    let s = selection();
    let p = preview(&s).unwrap();
    assert_eq!(p.record_count, 1);
    assert!(p.exclusions.len() >= 3);
    let bytes = export(&s).unwrap();
    assert_eq!(&bytes[..2], b"PK");
    let b = inspect(&bytes).unwrap();
    let text = serde_json::to_string(&b.records).unwrap();
    assert!(!text.contains("hidden"));
    assert!(!text.contains("/Users"));
    assert!(!text.contains("secret"));
    assert!(text.contains("<script>"));
}
#[test]
fn excludes_sensitive_and_oversized_snapshots() {
    let mut s = selection();
    let id = Uuid::new_v4();
    s.snapshots.push(Snapshot {
        id,
        repo_id: id,
        worktree_id: id,
        layer: Layer::Worktree,
        generation: "x".into(),
        files: vec![
            SnapshotFile::new(
                RepoPath::from_bytes(b".env").unwrap(),
                Some(b"token=x".to_vec()),
                None,
            ),
            SnapshotFile::new(
                RepoPath::from_bytes(b"key.txt").unwrap(),
                Some(b"-----BEGIN PRIVATE KEY-----".to_vec()),
                None,
            ),
            SnapshotFile::new(
                RepoPath::from_bytes(b"ok.rs").unwrap(),
                Some(b"hello".to_vec()),
                None,
            ),
        ],
        exclusions: vec![],
        captured_at: "1".into(),
    });
    let b = inspect(&export(&s).unwrap()).unwrap();
    assert_eq!(b.snapshots[0].files.len(), 1);
    assert_eq!(b.snapshots[0].files[0].bytes, b"hello");
}
#[test]
fn rejects_corruption_and_opaque_source_violations() {
    let mut s = selection();
    s.source_id = "/private/home".into();
    assert!(export(&s).is_err());
    assert!(inspect(b"not a zip").is_err());
    let mut b = export(&selection()).unwrap();
    b[45] ^= 0xff;
    assert!(inspect(&b).is_err());
}
#[test]
fn import_requires_mapping_without_verified_content() {
    let b = inspect(&export(&selection()).unwrap()).unwrap();
    let mapping = ImportMapping {
        target_repo_id: Uuid::new_v4(),
        target_worktree_id: Uuid::new_v4(),
        confirmed: false,
        git_matches: Default::default(),
    };
    assert!(!preview_import(&b, &mapping).unwrap().ready);
    let mapping = ImportMapping {
        confirmed: true,
        ..mapping
    };
    assert!(preview_import(&b, &mapping).unwrap().ready);
}
fn archive(entries: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    use std::io::{Cursor, Write};
    let mut z = zip::ZipWriter::new(Cursor::new(vec![]));
    for (p, b) in entries {
        z.start_file(p, zip::write::FileOptions::default()).unwrap();
        z.write_all(&b).unwrap();
    }
    z.finish().unwrap().into_inner()
}
#[test]
fn rejects_traversal_duplicate_unknown_version_hash_and_bomb() {
    for p in ["../escape", "/absolute", "C:/private", "a/../b", "a\\b"] {
        assert!(inspect(&archive(vec![(p, vec![])])).is_err());
    }
    assert!(
        inspect(&archive(vec![
            ("records.json", b"[]".to_vec()),
            ("records.json", b"[]".to_vec())
        ]))
        .is_err()
    );
    let b = inspect(&export(&selection()).unwrap()).unwrap();
    let mut m = b.manifest.clone();
    m.schema_major = 2;
    assert!(
        inspect(&archive(vec![
            ("manifest.json", serde_json::to_vec(&m).unwrap()),
            ("records.json", serde_json::to_vec(&b.records).unwrap())
        ]))
        .is_err()
    );
    m.schema_major = 1;
    m.entries[0].sha256 = "wrong".into();
    assert!(
        inspect(&archive(vec![
            ("manifest.json", serde_json::to_vec(&m).unwrap()),
            ("records.json", serde_json::to_vec(&b.records).unwrap())
        ]))
        .is_err()
    );
    let bomb = archive(vec![("records.json", vec![b'x'; 17 * 1024 * 1024])]);
    assert!(bomb.len() < 1024 * 1024);
    assert!(inspect(&bomb).is_err());
}
#[test]
fn preview_excludes_logs_and_large_text() {
    let mut s = selection();
    s.records
        .push(json!({"kind":"agent_transcript","text":"private"}));
    s.records
        .push(json!({"kind":"decision","raw_logs":"private"}));
    let p = preview(&s).unwrap();
    assert_eq!(p.record_count, 2);
    assert!(
        !serde_json::to_string(&p.records)
            .unwrap()
            .contains("private")
    );
}
#[test]
fn untrusted_manifest_cannot_smuggle_private_exclusion_metadata() {
    let b = inspect(&export(&selection()).unwrap()).unwrap();
    let mut m = b.manifest;
    m.exclusions.push(BundleExclusion {
        item: "/Users/secret".into(),
        reason: "private".into(),
    });
    assert!(
        inspect(&archive(vec![
            ("manifest.json", serde_json::to_vec(&m).unwrap()),
            ("records.json", serde_json::to_vec(&b.records).unwrap())
        ]))
        .is_err()
    );
}
#[test]
fn snapshot_metadata_cannot_export_private_paths_and_size_limit_is_real() {
    let mut s = selection();
    let id = Uuid::new_v4();
    let mut file = SnapshotFile::new(
        RepoPath::from_bytes(b"ok").unwrap(),
        Some(b"text".to_vec()),
        Some("/Users/private".into()),
    );
    file.encoding = "/Users/private".into();
    s.snapshots.push(Snapshot {
        id,
        repo_id: id,
        worktree_id: id,
        layer: Layer::Worktree,
        generation: "ok".into(),
        captured_at: "1".into(),
        exclusions: vec![],
        files: vec![
            file,
            SnapshotFile::new(
                RepoPath::from_bytes(b"large").unwrap(),
                Some(vec![b'x'; 2 * 1024 * 1024 + 1]),
                None,
            ),
        ],
    });
    let p = preview(&s).unwrap();
    assert_eq!(p.file_count, 1);
    assert!(
        !serde_json::to_string(&p.snapshots)
            .unwrap()
            .contains("/Users")
    );
}
#[test]
fn ordinary_code_comments_are_not_private_absolute_paths() {
    let mut s = selection();
    s.records = vec![
        json!({"kind":"decision","id":"one","data":{"example":"// Check before spending\nclass A {}","private":"/Users/name/repo"}}),
    ];
    let p = preview(&s).unwrap();
    assert_eq!(
        p.records[0]["data"]["example"],
        "// Check before spending\nclass A {}"
    );
    assert!(p.records[0]["data"]["private"].is_null());
}
#[test]
fn snapshot_display_is_derived_from_validated_bytes() {
    let mut s = selection();
    let id = Uuid::new_v4();
    let mut f = SnapshotFile::new(
        RepoPath::from_bytes(b"safe.cs").unwrap(),
        Some(b"class Safe {}".to_vec()),
        None,
    );
    f.path.display = "/Users/private/spoof.cs".into();
    s.snapshots.push(Snapshot {
        id,
        repo_id: id,
        worktree_id: id,
        layer: Layer::Worktree,
        generation: "x".into(),
        files: vec![f],
        exclusions: vec![],
        captured_at: "1".into(),
    });
    let p = preview(&s).unwrap();
    assert_eq!(p.snapshots[0].files[0].path.display, "safe.cs");
    assert!(
        !serde_json::to_string(&p)
            .unwrap()
            .contains("/Users/private")
    );
}
