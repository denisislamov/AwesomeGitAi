//! Semantic adapters receive only immutable source text, never a repository path.
use crate::HostService;
use agai_protocol::*;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    io::Read,
    os::unix::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTPUT: u64 = 2 * 1024 * 1024;
type CacheKey = (uuid::Uuid, uuid::Uuid, uuid::Uuid, String);
static CACHE: OnceLock<Mutex<VecDeque<(CacheKey, CodeRelationsReport)>>> = OnceLock::new();
fn language(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()? {
        "cs" => Some("csharp"),
        "ts" | "tsx" | "js" | "jsx" => Some("typescript"),
        "py" => Some("python"),
        _ => None,
    }
}
fn text_path(p: &RepoPath) -> Result<String> {
    String::from_utf8(p.bytes()?).map_err(|_| AppError::new("PATH_EXCLUDED"))
}
impl HostService {
    pub(crate) fn code_relations(
        &mut self,
        scope: RepoScope,
        id: uuid::Uuid,
        path: RepoPath,
    ) -> Result<DesktopResponse> {
        let origin = self.store.snapshot(id)?;
        if origin.repo_id != scope.repo_id || origin.worktree_id != scope.worktree_id {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let requested = text_path(&path)?;
        if !origin
            .files
            .iter()
            .any(|f| f.path.raw_base64 == path.raw_base64)
        {
            return Err(AppError::new("INCOMPLETE_COMPARISON"));
        }
        let mut report = CodeRelationsReport {
            origin_snapshot_id: id,
            snapshot_id: id,
            status: "Unsupported".into(),
            adapter: String::new(),
            message: "Semantic relations are unsupported for this language; usages are unknown."
                .into(),
            files: vec![],
            symbols: vec![],
        };
        let Some(lang) = language(&requested) else {
            return Ok(DesktopResponse::CodeRelations { report });
        };
        let key = (scope.repo_id, scope.worktree_id, id, requested.clone());
        let cache = CACHE.get_or_init(Default::default);
        if let Some((_, cached)) = cache.lock().unwrap().iter().find(|(k, _)| k == &key) {
            // A cache from another profile must not expose an unavailable navigation snapshot.
            if self.store.snapshot(cached.snapshot_id).is_ok() {
                return Ok(DesktopResponse::CodeRelations {
                    report: cached.clone(),
                });
            }
        }
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        let original_paths: Vec<_> = origin
            .files
            .iter()
            .map(|f| f.path.clone())
            .chain(origin.exclusions.iter().map(|f| f.path.clone()))
            .collect();
        let live_matches = !matches!(origin.layer, Layer::Commit { .. })
            && r.generation_for_paths(&original_paths)
                .is_ok_and(|g| g == origin.generation);
        let mut analysis = origin.clone();
        if live_matches || matches!(origin.layer, Layer::Commit { .. }) {
            let raw = match &origin.layer {
                Layer::Commit { oid } => r.run(&["ls-tree", "-r", "--name-only", "-z", oid, "--"]),
                _ => r.run(&[
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                ]),
            }?;
            let mut paths = BTreeMap::new();
            // Keep the requested file even when a large source set is truncated.
            paths.insert(requested.clone(), path.clone());
            for bytes in raw.split(|b| *b == 0) {
                if paths.len() >= 128 {
                    break;
                }
                if let Ok(s) = std::str::from_utf8(bytes) {
                    if language(s) == Some(lang) {
                        paths.insert(s.to_owned(), RepoPath::from_bytes(bytes)?);
                    }
                }
            }
            let paths: Vec<_> = paths.into_values().collect();
            // Pin capture to the exact full-state component of the origin token.
            // A second loose before/after check alone could accept a transient state.
            let proof_state = r.state()?;
            let proof_matches = agai_git::GitReader::scoped_generation(
                &proof_state.generation,
                &r.observe_paths(&original_paths)?,
            )? == origin.generation;
            let flagged_raw = r.run(&["ls-files", "-v", "-z"])?;
            let flagged: std::collections::HashSet<Vec<u8>> = flagged_raw
                .split(|b| *b == 0)
                .filter(|entry| {
                    entry.len() > 2 && (entry[0].is_ascii_lowercase() || entry[0] == b'S')
                })
                .map(|entry| entry[2..].to_vec())
                .collect();
            let dirty: std::collections::HashSet<_> = proof_state
                .status_entries
                .iter()
                .map(|e| e.path.raw_base64.clone())
                .collect();
            let expanded = match &origin.layer {
                Layer::Commit { oid } => {
                    agai_domain::capture_commit(&r, &mut self.store, &paths, oid)
                        .map(|id| (id, None))
                }
                _ if proof_matches => agai_git::GitReader::scoped_generation(
                    &proof_state.generation,
                    &r.observe_paths(&paths)?,
                )
                .and_then(|g| agai_domain::capture(&r, &mut self.store, &paths, &g))
                .map(|c| {
                    (
                        match origin.layer {
                            Layer::Head => c.head_snapshot_id,
                            Layer::Index => c.index_snapshot_id,
                            _ => c.worktree_snapshot_id,
                        },
                        Some(c.index_snapshot_id),
                    )
                }),
                _ => Err(AppError::new("STALE_STATE")),
            };
            if let Ok((expanded, index_id)) = expanded {
                if matches!(origin.layer, Layer::Commit { .. })
                    || r.generation_for_paths(&original_paths)
                        .is_ok_and(|g| g == origin.generation)
                {
                    let mut candidate = self.store.snapshot(expanded)?;
                    if matches!(origin.layer, Layer::Worktree) {
                        let index = self.store.snapshot(index_id.unwrap())?;
                        candidate.files.retain(|f| {
                            origin
                                .files
                                .iter()
                                .any(|o| o.path.raw_base64 == f.path.raw_base64)
                                || !flagged.contains(&f.path.bytes().unwrap_or_default())
                        });
                        for file in &mut candidate.files {
                            let original = origin
                                .files
                                .iter()
                                .any(|o| o.path.raw_base64 == file.path.raw_base64);
                            if !original && !dirty.contains(&file.path.raw_base64) {
                                // Raw clean worktree bytes may hide normalization/filter changes.
                                // Index blobs are pinned by the original full-state generation.
                                if let Some(baseline) = index
                                    .files
                                    .iter()
                                    .find(|f| f.path.raw_base64 == file.path.raw_base64)
                                {
                                    *file = baseline.clone();
                                }
                            }
                        }
                        // This is an analytical baseline, not a historical full-worktree observation.
                        candidate.id = uuid::Uuid::new_v4();
                        self.store.append_event(&RequestMeta { schema_version:1, request_id:uuid::Uuid::new_v4(), idempotency_key:Some(uuid::Uuid::new_v4()) }, &EventInput { repo_id:scope.repo_id, worktree_id:scope.worktree_id, kind:"snapshot_capture".into(), entity_id:candidate.id, summary:"Captured semantic baseline (pinned index for additional clean files)".into() }, &[candidate.clone()])?;
                    }
                    // Also compare the actual immutable source, not only the generation token.
                    if origin
                        .files
                        .iter()
                        .filter(|f| language(&f.path.display) == Some(lang))
                        .all(|f| {
                            candidate.files.iter().any(|c| {
                                c.path.raw_base64 == f.path.raw_base64
                                    && c.bytes == f.bytes
                                    && c.state == f.state
                            })
                        })
                    {
                        analysis = candidate;
                    }
                }
            }
        }
        let mut files = BTreeMap::new();
        let mut total = 64;
        for f in analysis
            .files
            .iter()
            .filter(|f| f.path.raw_base64 == path.raw_base64)
            .chain(
                analysis
                    .files
                    .iter()
                    .filter(|f| f.path.raw_base64 != path.raw_base64),
            )
        {
            let Ok(p) = text_path(&f.path) else {
                continue;
            };
            if language(&p) != Some(lang) || f.state != FileState::Present {
                continue;
            }
            if files.len() >= 128 {
                continue;
            }
            if let Ok(text) = std::str::from_utf8(&f.bytes) {
                let wire_bytes = serde_json::to_vec(&json!({"path":p,"text":text}))
                    .map_err(|_| AppError::new("INVALID_DATA"))?
                    .len()
                    + 1;
                if total + wire_bytes > MAX_BYTES {
                    continue;
                }
                total += wire_bytes;
                files.insert(p, text.to_owned());
            }
        }
        if analysis.files.len() != files.len() || !analysis.exclusions.is_empty() {
            analysis.id = uuid::Uuid::new_v4();
            analysis
                .files
                .retain(|f| text_path(&f.path).is_ok_and(|p| files.contains_key(&p)));
            analysis.exclusions.clear();
            self.store.append_event(
                &RequestMeta {
                    schema_version: 1,
                    request_id: uuid::Uuid::new_v4(),
                    idempotency_key: Some(uuid::Uuid::new_v4()),
                },
                &EventInput {
                    repo_id: scope.repo_id,
                    worktree_id: scope.worktree_id,
                    kind: "snapshot_capture".into(),
                    entity_id: analysis.id,
                    summary: "Bounded semantic source set".into(),
                },
                &[analysis.clone()],
            )?;
        }
        report.snapshot_id = analysis.id;
        report.files = files
            .keys()
            .map(|p| RepoPath::from_bytes(p.as_bytes()))
            .collect::<Result<_>>()?;
        report.adapter = lang.into();
        report.status = "Unavailable".into();
        report.message = "Semantic runtime unavailable; usages are unknown.".into();
        if !files.contains_key(&requested) {
            report.message = "Requested source is absent, excluded or exceeds analysis limits; usages are unknown.".into();
        } else if let Ok(output) = run_adapter(
            &adapter_path(lang),
            &json!({"files":files.iter().map(|(path,text)| json!({"path":path,"text":text})).collect::<Vec<_>>()}),
        ) {
            match validate_output(&output, &files) {
                Ok((status, adapter, message, symbols)) => {
                    report.status = status;
                    report.adapter = adapter;
                    report.message = message;
                    report.symbols = symbols;
                }
                Err(_) => {
                    report.message =
                        "Semantic adapter returned invalid data; usages are unknown.".into();
                }
            }
        }
        // No project build configuration or dependencies are evaluated, even on a complete file list.
        if report.status == "Ready" {
            report.status = "Partial".into();
        }
        if matches!(origin.layer, Layer::Worktree) && analysis.id != origin.id {
            report.message.push_str(" Additional clean files use the index baseline pinned by the original generation; this analytical source set does not represent observed historical worktree values. Assume-unchanged and skip-worktree additions are excluded.");
        }
        report.message.push_str(" Analysis uses only the captured source set, without project configuration or external dependencies.");
        if analysis.id == origin.id {
            report
                .message
                .push_str(" Original snapshot scope retained; newer files were not mixed in.");
        }
        if report.status != "Unavailable" {
            let mut c = cache.lock().unwrap();
            while c.len() >= 8 {
                c.pop_front();
            }
            c.push_back((key, report.clone()));
        }
        Ok(DesktopResponse::CodeRelations { report })
    }
}
fn adapter_path(lang: &str) -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let bundled = exe
        .parent()
        .unwrap_or(std::path::Path::new("/"))
        .join("relations")
        .join(lang);
    if bundled.exists() {
        return bundled;
    }
    #[cfg(debug_assertions)]
    {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src-tauri/binaries/relations")
            .join(lang);
    }
    #[cfg(not(debug_assertions))]
    bundled
}
fn run_adapter(path: &std::path::Path, input: &Value) -> Result<Value> {
    let fail = |_| AppError::new("RELATIONS_UNAVAILABLE");
    let dir = tempfile::tempdir().map_err(fail)?;
    let mut stdin = tempfile::tempfile().map_err(fail)?;
    serde_json::to_writer(&mut stdin, input).map_err(|_| AppError::new("INVALID_DATA"))?;
    use std::io::{Seek, SeekFrom};
    stdin.seek(SeekFrom::Start(0)).map_err(fail)?;
    let mut stdout = tempfile::tempfile().map_err(fail)?;
    let mut child = Command::new(path)
        .current_dir(dir.path())
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", dir.path())
        .env("TMPDIR", dir.path())
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1")
        .stdin(Stdio::from(stdin))
        .stdout(Stdio::from(stdout.try_clone().map_err(fail)?))
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(fail)?;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let oversized = stdout.metadata().map_err(fail)?.len() > MAX_OUTPUT;
        if oversized || Instant::now() >= deadline {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.wait();
            return Err(AppError::new("RELATIONS_UNAVAILABLE"));
        }
        if let Some(status) = child.try_wait().map_err(fail)? {
            if !status.success() {
                return Err(AppError::new("RELATIONS_UNAVAILABLE"));
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    stdout.seek(SeekFrom::Start(0)).map_err(fail)?;
    let mut bytes = vec![];
    stdout
        .take(MAX_OUTPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(fail)?;
    if bytes.len() as u64 > MAX_OUTPUT {
        return Err(AppError::new("RELATIONS_UNAVAILABLE"));
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::new("INVALID_DATA"))
}
fn bounded(v: &Value, key: &str, max: usize) -> Result<String> {
    let s = v[key]
        .as_str()
        .ok_or_else(|| AppError::new("INVALID_DATA"))?;
    if s.len() > max || s.contains('\0') {
        return Err(AppError::new("INVALID_DATA"));
    }
    Ok(s.into())
}
fn location(v: &Value, files: &BTreeMap<String, String>) -> Result<(RepoPath, u32, u32)> {
    let p = bounded(v, "path", 4096)?;
    let text = files.get(&p).ok_or_else(|| AppError::new("INVALID_DATA"))?;
    let line = v["line"]
        .as_u64()
        .filter(|x| *x > 0 && *x <= u32::MAX as u64)
        .ok_or_else(|| AppError::new("INVALID_DATA"))? as u32;
    let col = v["column"]
        .as_u64()
        .filter(|x| *x > 0 && *x <= u32::MAX as u64)
        .ok_or_else(|| AppError::new("INVALID_DATA"))? as u32;
    let source = text
        .split('\n')
        .nth(line as usize - 1)
        .ok_or_else(|| AppError::new("INVALID_DATA"))?;
    let offset = col as usize - 1;
    let mut cursor = 0;
    let mut boundary = offset == 0;
    for ch in source.chars() {
        cursor += ch.len_utf16();
        if cursor == offset {
            boundary = true;
            break;
        }
        if cursor > offset {
            break;
        }
    }
    if !boundary {
        return Err(AppError::new("INVALID_DATA"));
    }
    Ok((RepoPath::from_bytes(p.as_bytes())?, line, col))
}
fn validate_output(
    v: &Value,
    files: &BTreeMap<String, String>,
) -> Result<(String, String, String, Vec<RelationSymbol>)> {
    let status = bounded(v, "status", 32)?;
    if !["Ready", "Partial", "Unsupported", "Unavailable"].contains(&status.as_str()) {
        return Err(AppError::new("INVALID_DATA"));
    }
    let adapter = bounded(v, "adapter", 128)?;
    let message = bounded(v, "message", 2048)?;
    let values = v["symbols"]
        .as_array()
        .filter(|v| v.len() <= 10000)
        .ok_or_else(|| AppError::new("INVALID_DATA"))?;
    if ["Unavailable", "Unsupported"].contains(&status.as_str()) && !values.is_empty() {
        return Err(AppError::new("INVALID_DATA"));
    }
    let mut symbols = vec![];
    let mut ids = std::collections::HashSet::new();
    let mut count = 0;
    for s in values {
        let (path, line, column) = location(s, files)?;
        let id = bounded(s, "id", 2048)?;
        if !ids.insert(id.clone()) {
            return Err(AppError::new("INVALID_DATA"));
        }
        let mut references = vec![];
        for r in s["references"]
            .as_array()
            .ok_or_else(|| AppError::new("INVALID_DATA"))?
        {
            count += 1;
            if count > 20000 {
                return Err(AppError::new("INVALID_DATA"));
            }
            let (path, line, column) = location(r, files)?;
            let kind = bounded(r, "kind", 32)?;
            if ![
                "Read",
                "Write",
                "ReadWrite",
                "Call",
                "Override",
                "Implementation",
                "Inheritance",
                "Type",
                "Reference",
            ]
            .contains(&kind.as_str())
            {
                return Err(AppError::new("INVALID_DATA"));
            }
            let _ = bounded(r, "snippet", 4096)?;
            let source = &files[&text_path(&path)?];
            let snippet = source
                .split('\n')
                .nth(line as usize - 1)
                .unwrap_or_default()
                .chars()
                .take(512)
                .collect();
            references.push(RelationReference {
                path,
                line,
                column,
                kind,
                snippet,
            });
        }
        symbols.push(RelationSymbol {
            id,
            name: bounded(s, "name", 1024)?,
            kind: bounded(s, "kind", 64)?,
            path,
            line,
            column,
            references,
        });
    }
    Ok((status, adapter, message, symbols))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_foreign_paths_positions_and_unbounded_strings() {
        let files = BTreeMap::from([("a.ts".into(), "const a = 1;".into())]);
        let valid = json!({"adapter":"test","status":"Partial","message":"bounded","symbols":[{"id":"a","name":"a","kind":"Variable","path":"a.ts","line":1,"column":7,"references":[]}]});
        assert!(validate_output(&valid, &files).is_ok());
        for (field, value) in [
            ("path", json!("../secret")),
            ("line", json!(2)),
            ("column", json!(99)),
            ("name", json!("a".repeat(1025))),
        ] {
            let mut bad = valid.clone();
            bad["symbols"][0][field] = value;
            assert!(validate_output(&bad, &files).is_err());
        }
    }
    #[test]
    fn malformed_and_excessive_subprocess_output_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("adapter");
        for body in [
            "#!/bin/sh\nprintf 'broken-json'\n",
            "#!/bin/sh\n/usr/bin/head -c 2100000 /dev/zero\n",
        ] {
            std::fs::write(&path, body).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert!(run_adapter(&path, &json!({"files":[]})).is_err());
        }
    }
    #[test]
    fn built_adapter_outputs_pass_host_validation() {
        for (lang, path, text) in [
            (
                "typescript",
                "main.ts",
                "export const number = 1; console.log(number);",
            ),
            (
                "csharp",
                "Main.cs",
                "class Main { int number; int Read() => number; }",
            ),
            ("python", "main.py", "number = 1\nprint(number)\n"),
        ] {
            let launcher = adapter_path(lang);
            if !launcher.exists() {
                continue;
            }
            let files = BTreeMap::from([(path.to_owned(), text.to_owned())]);
            let output =
                run_adapter(&launcher, &json!({"files":[{"path":path,"text":text}]})).unwrap();
            let (status, _, _, symbols) = validate_output(&output, &files).unwrap();
            if status != "Unavailable" {
                assert!(!symbols.is_empty(), "{lang}: {output}");
            }
        }
    }
    #[test]
    fn absent_runtime_is_unavailable() {
        assert!(
            run_adapter(
                std::path::Path::new("/nonexistent-agai-adapter"),
                &json!({"files":[]})
            )
            .is_err()
        );
    }
}
