//! Portable, inert context packages. No filesystem extraction or Git mutations.
use agai_protocol::{AppError, Result, Snapshot, hash};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read, Write},
};
use uuid::Uuid;
const MAX_ARCHIVE: usize = 32 * 1024 * 1024;
const MAX_ENTRY: usize = 16 * 1024 * 1024;
const MAX_FILE: usize = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 258;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleSelection {
    pub source_id: String,
    pub records: Vec<Value>,
    pub snapshots: Vec<Snapshot>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BundleExclusion {
    pub item: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub path: String,
    pub sha256: String,
    pub size: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleManifest {
    pub schema_major: u32,
    pub bundle_id: String,
    pub source_id: String,
    pub entries: Vec<ManifestEntry>,
    pub exclusions: Vec<BundleExclusion>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleContents {
    pub manifest: BundleManifest,
    pub records: Vec<Value>,
    pub snapshots: Vec<Snapshot>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundlePreview {
    pub record_count: usize,
    pub snapshot_count: usize,
    pub file_count: usize,
    pub exclusions: Vec<BundleExclusion>,
    pub records: Vec<Value>,
    pub snapshots: Vec<Snapshot>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportMapping {
    pub target_repo_id: Uuid,
    pub target_worktree_id: Uuid,
    pub confirmed: bool,
    /// Host-verified content hashes, never trusted directly from an RPC caller.
    pub git_matches: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub ready: bool,
    pub exact_files: usize,
    pub unmatched_files: usize,
    pub requires_mapping: bool,
    pub external_provenance: bool,
}
fn err() -> AppError {
    AppError::new("INVALID_BUNDLE")
}
fn path_ok(p: &str) -> bool {
    !p.is_empty()
        && !p.contains(['\\', ':', '\0'])
        && !(p.starts_with('/') && !matches!(p, "/" | "//" | "/*" | "/**"))
        && p.split('/').all(|x| !x.is_empty() && x != "." && x != "..")
}
fn private_text(s: &str) -> bool {
    s.contains("PRIVATE KEY-----")
        || s.split(|c: char| c.is_whitespace() || ['\"', '\'', '(', ')', '='].contains(&c))
            .any(|p| {
                (p.starts_with('/') && !matches!(p, "/" | "//" | "/*" | "/**"))
                    || p.starts_with("~/")
                    || (p.as_bytes().get(1) == Some(&b':')
                        && matches!(p.as_bytes().get(2), Some(b'/') | Some(b'\\')))
            })
}
fn sensitive_path(p: &str) -> bool {
    p.split('/').any(|s| {
        let s = s.to_ascii_lowercase();
        s == ".env"
            || s.starts_with(".env.")
            || s.ends_with(".pem")
            || s == "id_rsa"
            || s == "id_ed25519"
            || s.ends_with(".log")
            || s == "logs"
            || s.contains("transcript")
    })
}
fn blocked_key(k: &str) -> bool {
    matches!(
        k.to_ascii_lowercase().as_str(),
        "authorization"
            | "api_key"
            | "access_token"
            | "password"
            | "transcript"
            | "raw_log"
            | "raw_logs"
            | "logs"
            | "absolute_path"
            | "local_path"
    )
}
fn clean(v: &mut Value, item: &str, out: &mut Vec<BundleExclusion>) {
    match v {
        Value::Object(o) => {
            let keys: Vec<_> = o.keys().cloned().collect();
            for k in keys {
                if blocked_key(&k) {
                    o.remove(&k);
                    out.push(BundleExclusion {
                        item: format!("{item}.{k}"),
                        reason: "private_field".into(),
                    });
                } else {
                    clean(o.get_mut(&k).unwrap(), &format!("{item}.{k}"), out)
                }
            }
        }
        Value::Array(a) => {
            for (i, v) in a.iter_mut().enumerate() {
                clean(v, &format!("{item}.{i}"), out)
            }
        }
        Value::String(s) if private_text(s) => {
            *v = Value::Null;
            out.push(BundleExclusion {
                item: item.into(),
                reason: "private_content".into(),
            });
        }
        _ => {}
    }
}
pub fn preview(s: &BundleSelection) -> Result<BundlePreview> {
    Uuid::parse_str(&s.source_id).map_err(|_| err())?;
    if s.records.len() > 1000 || s.snapshots.len() > 256 {
        return Err(err());
    }
    let mut out = BundlePreview {
        record_count: 0,
        snapshot_count: 0,
        file_count: 0,
        exclusions: vec![],
        records: vec![],
        snapshots: vec![],
    };
    for (i, r) in s.records.iter().enumerate() {
        let label = format!("record:{i}");
        if !r.is_object() {
            return Err(err());
        }
        if r.get("kind").and_then(Value::as_str).is_some_and(|k| {
            k.to_ascii_lowercase().contains("log") || k.to_ascii_lowercase().contains("transcript")
        }) {
            out.exclusions.push(BundleExclusion {
                item: label,
                reason: "private_record".into(),
            });
            continue;
        }
        let mut r = r.clone();
        clean(&mut r, &label, &mut out.exclusions);
        out.records.push(r);
    }
    let mut ids = BTreeSet::new();
    for snap in &s.snapshots {
        if !ids.insert(snap.id) {
            return Err(err());
        }
        let mut snap = snap.clone();
        snap.exclusions.clear();
        let mut paths = BTreeSet::new();
        let mut files = vec![];
        for mut f in snap.files {
            let p = String::from_utf8(f.path.bytes()?).map_err(|_| err())?;
            f.path = agai_protocol::RepoPath::from_bytes(p.as_bytes())?;
            if !path_ok(&p) || !paths.insert(p.clone()) {
                return Err(err());
            }
            let reason = if sensitive_path(&p) {
                Some("sensitive_path")
            } else if f.bytes.len() > MAX_FILE {
                Some("file_too_large")
            } else if f.bytes.contains(&0) || std::str::from_utf8(&f.bytes).is_err() {
                Some("binary_file")
            } else if private_text(std::str::from_utf8(&f.bytes).unwrap()) {
                Some("private_content")
            } else {
                None
            };
            if let Some(reason) = reason {
                out.exclusions.push(BundleExclusion {
                    item: format!("snapshot:{}:{p}", snap.id),
                    reason: reason.into(),
                });
                continue;
            }
            if hash(&f.bytes) != f.sha256 {
                return Err(err());
            }
            if f.blob_oid.as_ref().is_some_and(|oid| {
                !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit())
            }) {
                f.blob_oid = None;
                out.exclusions.push(BundleExclusion {
                    item: format!("snapshot:{}:{p}:blob_oid", snap.id),
                    reason: "invalid_object_id".into(),
                });
            }
            f.encoding = "utf8".into();
            f.newline = if f.bytes.windows(2).any(|w| w == b"\r\n") {
                "crlf"
            } else {
                "lf"
            }
            .into();
            f.stages.clear();
            files.push(f);
        }
        snap.files = files;
        if private_text(&snap.generation) {
            snap.generation = "redacted".into()
        }
        if private_text(&snap.captured_at) {
            snap.captured_at = "redacted".into()
        }
        out.file_count += snap.files.len();
        out.snapshots.push(snap);
    }
    out.record_count = out.records.len();
    out.snapshot_count = out.snapshots.len();
    Ok(out)
}
pub fn export(s: &BundleSelection) -> Result<Vec<u8>> {
    let p = preview(s)?;
    let mut entries = vec![(
        "records.json".to_string(),
        serde_json::to_vec(&p.records).map_err(|_| err())?,
    )];
    for snap in p.snapshots {
        entries.push((
            format!("snapshots/{}.json", snap.id),
            serde_json::to_vec(&snap).map_err(|_| err())?,
        ));
    }
    let manifest = BundleManifest {
        schema_major: 1,
        bundle_id: Uuid::new_v4().to_string(),
        source_id: s.source_id.clone(),
        entries: entries
            .iter()
            .map(|(path, b)| ManifestEntry {
                path: path.clone(),
                sha256: hash(b),
                size: b.len(),
            })
            .collect(),
        exclusions: p.exclusions,
    };
    entries.push((
        "manifest.json".into(),
        serde_json::to_vec(&manifest).map_err(|_| err())?,
    ));
    if entries.len() > MAX_ENTRIES
        || entries.iter().any(|(_, b)| b.len() > MAX_ENTRY)
        || entries.iter().map(|(_, b)| b.len()).sum::<usize>() > MAX_ARCHIVE
    {
        return Err(err());
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(vec![]));
    for (path, b) in entries {
        zip.start_file(
            path,
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored),
        )
        .map_err(|_| err())?;
        zip.write_all(&b).map_err(|_| err())?;
    }
    let bytes = zip.finish().map_err(|_| err())?.into_inner();
    if bytes.len() > MAX_ARCHIVE {
        return Err(err());
    }
    Ok(bytes)
}
pub fn inspect(bytes: &[u8]) -> Result<BundleContents> {
    if bytes.len() > MAX_ARCHIVE {
        return Err(err());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| err())?;
    if zip.len() > MAX_ENTRIES {
        return Err(err());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0usize;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| err())?;
        let name = f.name().to_string();
        if !path_ok(&name)
            || f.is_dir()
            || f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            || f.size() > MAX_ENTRY as u64
            || entries.contains_key(&name)
        {
            return Err(err());
        }
        total = total.checked_add(f.size() as usize).ok_or_else(err)?;
        if total > MAX_ARCHIVE {
            return Err(err());
        }
        let mut b = vec![];
        (&mut f)
            .take(MAX_ENTRY as u64 + 1)
            .read_to_end(&mut b)
            .map_err(|_| err())?;
        if b.len() > MAX_ENTRY || b.len() as u64 != f.size() {
            return Err(err());
        }
        entries.insert(name, b);
    }
    let manifest: BundleManifest =
        serde_json::from_slice(&entries.remove("manifest.json").ok_or_else(err)?)
            .map_err(|_| err())?;
    if manifest.schema_major != 1
        || Uuid::parse_str(&manifest.bundle_id).is_err()
        || Uuid::parse_str(&manifest.source_id).is_err()
        || manifest.entries.len() != entries.len()
    {
        return Err(err());
    }
    if manifest
        .exclusions
        .iter()
        .any(|e| private_text(&e.item) || private_text(&e.reason))
    {
        return Err(err());
    }
    let mut seen = BTreeSet::new();
    for e in &manifest.entries {
        if !path_ok(&e.path) || !seen.insert(&e.path) {
            return Err(err());
        }
        let b = entries.get(&e.path).ok_or_else(err)?;
        if e.size != b.len() || e.sha256 != hash(b) {
            return Err(err());
        }
    }
    let records: Vec<Value> =
        serde_json::from_slice(&entries.remove("records.json").ok_or_else(err)?)
            .map_err(|_| err())?;
    let mut snapshots = vec![];
    for (path, b) in entries {
        let snap: Snapshot = serde_json::from_slice(&b).map_err(|_| err())?;
        if path != format!("snapshots/{}.json", snap.id) {
            return Err(err());
        }
        snapshots.push(snap);
    }
    // Incoming packages must satisfy the same privacy/path/content rules as outgoing packages.
    let selection = BundleSelection {
        source_id: manifest.source_id.clone(),
        records: records.clone(),
        snapshots: snapshots.clone(),
    };
    let p = preview(&selection)?;
    if !p.exclusions.is_empty() || p.records != records || p.snapshots != snapshots {
        return Err(err());
    }
    Ok(BundleContents {
        manifest,
        records,
        snapshots,
    })
}
pub fn preview_import(b: &BundleContents, m: &ImportMapping) -> Result<ImportPreview> {
    if m.target_repo_id.is_nil() || m.target_worktree_id.is_nil() {
        return Err(err());
    }
    let mut exact = 0;
    let mut unmatched = 0;
    for f in b.snapshots.iter().flat_map(|s| &s.files) {
        if m.git_matches.get(&f.sha256) == Some(&f.sha256) {
            exact += 1
        } else {
            unmatched += 1
        }
    }
    let requires_mapping = unmatched > 0 || exact == 0;
    Ok(ImportPreview {
        ready: m.confirmed || !requires_mapping,
        exact_files: exact,
        unmatched_files: unmatched,
        requires_mapping,
        external_provenance: true,
    })
}
