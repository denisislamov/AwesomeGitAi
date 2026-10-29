use agai_git::GitReader;
use agai_protocol::*;
use agai_storage::Store;
use std::{
    ffi::OsString,
    os::unix::ffi::OsStringExt,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
const LIMIT: usize = 2 * 1024 * 1024;
fn sensitive(path: &RepoPath) -> bool {
    path.bytes()
        .unwrap_or_default()
        .split(|b| *b == b'/')
        .any(|p| {
            p == b".env"
                || p.starts_with(b".env.")
                || p.ends_with(b".pem")
                || p == b"id_rsa"
                || p == b"id_ed25519"
        })
}
fn secret(bytes: &[u8]) -> bool {
    bytes.windows(17).any(|w| w == b"-----BEGIN PRIVAT")
        || String::from_utf8_lossy(bytes).contains("PRIVATE KEY-----")
}
fn snap(r: &GitReader, layer: Layer, generation: &str) -> Snapshot {
    Snapshot {
        id: Uuid::new_v4(),
        repo_id: r.repo_id,
        worktree_id: r.worktree_id,
        layer,
        generation: generation.into(),
        files: vec![],
        exclusions: vec![],
        captured_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string(),
    }
}
fn blob(r: &GitReader, oid: &str) -> Result<Vec<u8>> {
    let size = r.run(&["cat-file", "-s", oid])?;
    let size = String::from_utf8_lossy(&size)
        .trim()
        .parse::<usize>()
        .map_err(|_| AppError::new("INVALID_GIT_OUTPUT"))?;
    if size > LIMIT {
        return Err(AppError::new("FILE_TOO_LARGE"));
    }
    let bytes = r.run(&["cat-file", "blob", oid])?;
    if bytes.len() > LIMIT {
        return Err(AppError::new("FILE_TOO_LARGE"));
    }
    if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
        return Err(AppError::new("BINARY_FILE"));
    }
    if secret(&bytes) {
        return Err(AppError::new("SENSITIVE_CONTENT"));
    }
    Ok(bytes)
}
fn git_file(
    r: &GitReader,
    path: &RepoPath,
    revision: Option<&str>,
    index: bool,
) -> Result<SnapshotFile> {
    let mut args: Vec<OsString> = if index {
        vec![
            "ls-files".into(),
            "--stage".into(),
            "-z".into(),
            "--".into(),
        ]
    } else {
        let Some(rev) = revision else {
            return Ok(SnapshotFile::new(path.clone(), None, None));
        };
        vec![
            "ls-tree".into(),
            "-z".into(),
            "--full-tree".into(),
            rev.into(),
            "--".into(),
        ]
    };
    args.push(OsString::from_vec(path.bytes()?));
    let data = r.raw(&args)?;
    let mut file = SnapshotFile::new(path.clone(), None, None);
    for entry in data.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let tab = entry
            .iter()
            .position(|b| *b == b'\t')
            .ok_or_else(|| AppError::new("INVALID_GIT_OUTPUT"))?;
        if &entry[tab + 1..] != path.bytes()?.as_slice() {
            continue;
        }
        let header = String::from_utf8_lossy(&entry[..tab]);
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 3 {
            return Err(AppError::new("INVALID_GIT_OUTPUT"));
        }
        if fields[0] != "100644" && fields[0] != "100755" {
            return Err(AppError::new("PATH_EXCLUDED"));
        }
        let oid = if index { fields[1] } else { fields[2] };
        let bytes = blob(r, oid)?;
        let stage = if index {
            fields[2]
                .parse::<u8>()
                .map_err(|_| AppError::new("INVALID_GIT_OUTPUT"))?
        } else {
            0
        };
        if stage == 0 {
            file = SnapshotFile::new(path.clone(), Some(bytes), Some(oid.into()));
        } else {
            file.state = FileState::Conflicted;
            file.stages.push(ConflictStage {
                stage,
                oid: oid.into(),
                bytes,
            });
        }
    }
    Ok(file)
}
fn add(s: &mut Snapshot, path: &RepoPath, result: Result<SnapshotFile>) -> Result<()> {
    match result {
        Ok(f) => {
            let existing: usize = s
                .files
                .iter()
                .map(|f| f.bytes.len() + f.stages.iter().map(|x| x.bytes.len()).sum::<usize>())
                .sum();
            if existing + f.bytes.len() + f.stages.iter().map(|x| x.bytes.len()).sum::<usize>()
                > 32 * 1024 * 1024
            {
                return Err(AppError::new("CAPTURE_TOO_LARGE"));
            }
            s.files.push(f)
        }
        Err(e)
            if [
                "FILE_TOO_LARGE",
                "PATH_EXCLUDED",
                "SENSITIVE_CONTENT",
                "BINARY_FILE",
            ]
            .contains(&e.code.as_str()) =>
        {
            s.exclusions.push(Exclusion {
                path: path.clone(),
                reason: e.code,
            })
        }
        Err(e) => return Err(e),
    }
    Ok(())
}
fn validate(paths: &[RepoPath]) -> Result<()> {
    if paths.is_empty() || paths.len() > 1000 {
        return Err(AppError::new("INVALID_REQUEST"));
    }
    let mut seen = std::collections::HashSet::new();
    for p in paths {
        if !seen.insert(p.bytes()?) {
            return Err(AppError::new("INVALID_REQUEST"));
        }
    }
    Ok(())
}
pub fn capture(
    r: &GitReader,
    store: &mut Store,
    paths: &[RepoPath],
    expected: &str,
) -> Result<CapturedState> {
    validate(paths)?;
    let before = r.state()?;
    let observed = r.observe_paths(paths)?;
    if GitReader::scoped_generation(&before.generation, &observed)? != expected {
        return Err(AppError::new("STALE_STATE"));
    }
    let mut head = snap(r, Layer::Head, expected);
    let mut index = snap(r, Layer::Index, expected);
    let mut work = snap(r, Layer::Worktree, expected);
    for (path, outcome) in &observed {
        if sensitive(path) {
            for s in [&mut head, &mut index, &mut work] {
                s.exclusions.push(Exclusion {
                    path: path.clone(),
                    reason: "SENSITIVE_PATH".into(),
                });
            }
            continue;
        }
        add(
            &mut head,
            path,
            git_file(r, path, before.head_oid.as_deref(), false),
        )?;
        add(&mut index, path, git_file(r, path, None, true))?;
        let current = outcome.clone().and_then(|bytes| {
            if bytes
                .as_ref()
                .is_some_and(|b| b.contains(&0) || std::str::from_utf8(b).is_err())
            {
                return Err(AppError::new("BINARY_FILE"));
            }
            if bytes.as_ref().is_some_and(|b| secret(b)) {
                return Err(AppError::new("SENSITIVE_CONTENT"));
            }
            Ok(SnapshotFile::new(path.clone(), bytes, None))
        });
        add(&mut work, path, current)?;
    }
    if r.generation_for_paths(paths)? != expected {
        return Err(AppError::new("STALE_STATE"));
    }
    let result = CapturedState {
        head_snapshot_id: head.id,
        index_snapshot_id: index.id,
        worktree_snapshot_id: work.id,
        generation: expected.into(),
    };
    persist(store, r, vec![head, index, work])?;
    Ok(result)
}
fn persist(store: &mut Store, r: &GitReader, snapshots: Vec<Snapshot>) -> Result<()> {
    for snapshot in &snapshots {
        if serde_json::to_vec(snapshot)
            .map_err(|_| AppError::new("INVALID_DATA"))?
            .len()
            > 12 * 1024 * 1024
        {
            return Err(AppError::new("CAPTURE_TOO_LARGE"));
        }
    }
    let meta = RequestMeta {
        schema_version: 1,
        request_id: Uuid::new_v4(),
        idempotency_key: Some(Uuid::new_v4()),
    };
    let event = EventInput {
        repo_id: r.repo_id,
        worktree_id: r.worktree_id,
        kind: "snapshot_capture".into(),
        entity_id: snapshots[0].id,
        summary: "Captured repository state".into(),
    };
    store.append_event(&meta, &event, &snapshots)?;
    Ok(())
}
pub fn capture_commit(
    r: &GitReader,
    store: &mut Store,
    paths: &[RepoPath],
    oid: &str,
) -> Result<Uuid> {
    validate(paths)?;
    if ![40, 64].contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::new("INVALID_REVISION"));
    }
    r.run(&["cat-file", "-e", &format!("{oid}^{{commit}}")])?;
    let mut s = snap(r, Layer::Commit { oid: oid.into() }, oid);
    for p in paths {
        if sensitive(p) {
            s.exclusions.push(Exclusion {
                path: p.clone(),
                reason: "SENSITIVE_PATH".into(),
            })
        } else {
            add(&mut s, p, git_file(r, p, Some(oid), false))?;
        }
    }
    let id = s.id;
    persist(store, r, vec![s])?;
    Ok(id)
}
pub fn compare(store: &mut Store, base: Uuid, target: Uuid) -> Result<Comparison> {
    let a = store.snapshot(base)?;
    let b = store.snapshot(target)?;
    if a.repo_id != b.repo_id || a.worktree_id != b.worktree_id {
        return Err(AppError::new("SCOPE_DENIED"));
    }
    let scope_a: std::collections::BTreeSet<_> =
        a.files.iter().map(|f| f.path.raw_base64.clone()).collect();
    let scope_b: std::collections::BTreeSet<_> =
        b.files.iter().map(|f| f.path.raw_base64.clone()).collect();
    if !a.exclusions.is_empty() || !b.exclusions.is_empty() || scope_a != scope_b {
        return Err(AppError::new("INCOMPLETE_COMPARISON"));
    }
    let mut paths = std::collections::BTreeMap::new();
    for f in a.files.iter().chain(b.files.iter()) {
        paths.insert(f.path.bytes()?, f.path.clone());
    }
    let pairs = paths
        .into_values()
        .map(|p| {
            let old = a
                .files
                .iter()
                .find(|f| f.path.raw_base64 == p.raw_base64 && f.state != FileState::Absent)
                .map(|_| p.clone());
            let new = b
                .files
                .iter()
                .find(|f| f.path.raw_base64 == p.raw_base64 && f.state != FileState::Absent)
                .map(|_| p);
            FilePair {
                old_path: old,
                new_path: new,
            }
        })
        .collect();
    let c = Comparison {
        id: Uuid::new_v4(),
        base_snapshot_id: base,
        target_snapshot_id: target,
        file_pairs: pairs,
        diff_algorithm_version: "path-pairs-v1".into(),
    };
    store.save_comparison(&c)?;
    Ok(c)
}
