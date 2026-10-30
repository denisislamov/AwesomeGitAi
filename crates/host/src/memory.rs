use crate::HostService;
use agai_domain::{bundle, memory, redaction};
use agai_protocol::*;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path,
};
use uuid::Uuid;
fn invalid() -> AppError {
    AppError::new("INVALID_REQUEST")
}
fn io(_: std::io::Error) -> AppError {
    AppError::new("BUNDLE_FILE_ERROR")
}
fn value<T: serde::Serialize>(v: T) -> Result<Value> {
    serde_json::to_value(v).map_err(|_| invalid())
}
fn read_bundle(path: &str) -> Result<Vec<u8>> {
    if !Path::new(path).is_absolute() {
        return Err(invalid());
    }
    let mut f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(io)?;
    let m = f.metadata().map_err(io)?;
    if !m.is_file() || m.len() > 32 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut b = vec![];
    (&mut f)
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut b)
        .map_err(io)?;
    if b.len() > 32 * 1024 * 1024 {
        return Err(invalid());
    }
    Ok(b)
}
impl HostService {
    fn bundle_selection(
        &self,
        scope: &RepoScope,
        record_ids: Vec<String>,
        snapshot_ids: Vec<Uuid>,
    ) -> Result<bundle::BundleSelection> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        if record_ids.len() > 1000 || snapshot_ids.len() > 256 {
            return Err(invalid());
        }
        let available = self
            .store
            .memory_records(scope.repo_id, scope.worktree_id)?;
        let mut records = vec![];
        let mut seen = std::collections::BTreeSet::new();
        for id in record_ids {
            if !seen.insert(id.clone()) {
                return Err(invalid());
            }
            let item = available
                .iter()
                .find(|i| i.id == id)
                .ok_or_else(|| AppError::new("SCOPE_DENIED"))?;
            records.push(value(item)?);
        }
        let mut snapshots = vec![];
        for id in snapshot_ids {
            let s = self.store.snapshot(id)?;
            if s.repo_id != scope.repo_id || s.worktree_id != scope.worktree_id {
                return Err(AppError::new("SCOPE_DENIED"));
            }
            snapshots.push(s);
        }
        Ok(bundle::BundleSelection {
            source_id: scope.repo_id.to_string(),
            records,
            snapshots,
        })
    }
    pub fn memory_search(
        &self,
        scope: RepoScope,
        filter: memory::MemoryFilter,
    ) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        Ok(DesktopResponse::MemoryResult {
            data: value(memory::search(
                &self.store,
                scope.repo_id,
                scope.worktree_id,
                &filter,
            )?)?,
        })
    }
    pub fn memory_catalog(&self, scope: RepoScope) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        let record_catalog =
            self.store
                .memory_catalog_records(scope.repo_id, scope.worktree_id, 1000)?;
        let snapshot_catalog =
            self.store
                .memory_snapshot_catalog(scope.repo_id, scope.worktree_id, 1000)?;
        let records=record_catalog.items.iter().map(|v|json!({"id":v["id"],"kind":v["kind"],"external":v["external"],"data":{"summary":v["summary"],"title":v["title"]}})).collect::<Vec<_>>();
        let snapshots=snapshot_catalog.items.iter().map(|v|json!({"id":v["id"],"label":format!("{} · {}",v["layer"].as_str().unwrap_or("Snapshot"),v["captured_at"].as_str().unwrap_or("")),"file_count":v["file_count"]})).collect::<Vec<_>>();
        Ok(DesktopResponse::MemoryResult {
            data: json!({"records":records,"snapshots":snapshots,"truncated":record_catalog.truncated||snapshot_catalog.truncated,"total_records":record_catalog.total,"total_snapshots":snapshot_catalog.total}),
        })
    }
    pub fn bundle_preview(
        &self,
        scope: RepoScope,
        records: Vec<String>,
        snapshots: Vec<Uuid>,
    ) -> Result<DesktopResponse> {
        let p = bundle::preview(&self.bundle_selection(&scope, records, snapshots)?)?;
        let hash = hash(&serde_json::to_vec(&p).map_err(|_| invalid())?);
        Ok(DesktopResponse::MemoryResult {
            data: json!({"preview":p,"hash":hash}),
        })
    }
    pub fn bundle_export(
        &self,
        scope: RepoScope,
        records: Vec<String>,
        snapshots: Vec<Uuid>,
        expected_hash: String,
        path: String,
    ) -> Result<DesktopResponse> {
        let selection = self.bundle_selection(&scope, records, snapshots)?;
        let p = bundle::preview(&selection)?;
        if hash(&serde_json::to_vec(&p).map_err(|_| invalid())?) != expected_hash {
            return Err(AppError::new("PREVIEW_CHANGED"));
        }
        if !Path::new(&path).is_absolute() {
            return Err(invalid());
        }
        let destination = Path::new(&path);
        let parent = destination
            .parent()
            .ok_or_else(invalid)?
            .canonicalize()
            .map_err(io)?;
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        use std::os::unix::ffi::OsStringExt;
        for arg in ["--git-dir", "--git-common-dir"] {
            let mut bytes = r.run(&["rev-parse", "--path-format=absolute", arg])?;
            if bytes.last() == Some(&b'\n') {
                bytes.pop();
            }
            let metadata = std::path::PathBuf::from(std::ffi::OsString::from_vec(bytes))
                .canonicalize()
                .map_err(io)?;
            if parent.starts_with(metadata) {
                return Err(AppError::new("GIT_METADATA_DESTINATION"));
            }
        }
        if parent.components().any(|c| c.as_os_str() == ".git") {
            return Err(AppError::new("GIT_METADATA_DESTINATION"));
        }
        let path = parent.join(destination.file_name().ok_or_else(invalid)?);
        let bytes = bundle::export(&selection)?;
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .map_err(io)?;
        f.write_all(&bytes).map_err(io)?;
        f.sync_all().map_err(io)?;
        Ok(DesktopResponse::MemoryResult {
            data: json!({"output_path":path,"hash":hash(&bytes),"bytes":bytes.len()}),
        })
    }
    fn import_mapping(
        &self,
        scope: &RepoScope,
        b: &bundle::BundleContents,
        confirmed: bool,
    ) -> Result<bundle::ImportMapping> {
        let r = self.reader(scope.repo_id, scope.worktree_id)?;
        let mut matches = BTreeMap::new();
        // Match actual immutable Git blobs only. Remote URLs and worktree bytes are not identities.
        for file in b.snapshots.iter().flat_map(|s| &s.files) {
            if let Some(oid) = &file.blob_oid {
                if [40, 64].contains(&oid.len()) && oid.bytes().all(|c| c.is_ascii_hexdigit()) {
                    if let Ok(bytes) = r.run(&["cat-file", "blob", oid]) {
                        if hash(&bytes) == file.sha256 {
                            matches.insert(file.sha256.clone(), file.sha256.clone());
                        }
                    }
                }
            }
        }
        Ok(bundle::ImportMapping {
            target_repo_id: scope.repo_id,
            target_worktree_id: scope.worktree_id,
            confirmed,
            git_matches: matches,
        })
    }
    pub fn bundle_inspect(&self, scope: RepoScope, path: String) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        let bytes = read_bundle(&path)?;
        let b = bundle::inspect(&bytes)?;
        let p = bundle::preview_import(&b, &self.import_mapping(&scope, &b, false)?)?;
        Ok(DesktopResponse::MemoryResult {
            data: json!({"hash":hash(&bytes),"preview":p,"manifest":b.manifest,"record_count":b.records.len(),"snapshot_count":b.snapshots.len(),"records":b.records,"snapshots":b.snapshots}),
        })
    }
    pub fn bundle_import(
        &mut self,
        scope: RepoScope,
        path: String,
        expected_hash: String,
        confirmed: bool,
    ) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        let bytes = read_bundle(&path)?;
        if hash(&bytes) != expected_hash {
            return Err(AppError::new("PREVIEW_CHANGED"));
        }
        let b = bundle::inspect(&bytes)?;
        let p = bundle::preview_import(&b, &self.import_mapping(&scope, &b, confirmed)?)?;
        if !p.ready {
            return Err(AppError::new("MAPPING_REQUIRED"));
        }
        let receipt = memory::import_bundle(
            &mut self.store,
            &b,
            &expected_hash,
            scope.repo_id,
            scope.worktree_id,
        )?;
        Ok(DesktopResponse::MemoryResult {
            data: value(receipt)?,
        })
    }
    pub fn memory_erase(
        &mut self,
        scope: RepoScope,
        confirmation: String,
    ) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        if confirmation != "ERASE STORED CONTEXT" {
            return Err(AppError::new("CONFIRMATION_REQUIRED"));
        }
        let receipt = redaction::redact(
            &mut self.store,
            scope.repo_id,
            scope.worktree_id,
            &redaction::RedactionSelection { confirmed: true },
        )?;
        Ok(DesktopResponse::MemoryResult {
            data: value(receipt)?,
        })
    }
    pub fn memory_rebuild(&self, scope: RepoScope) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        self.store.rebuild_index()?;
        Ok(DesktopResponse::MemoryResult {
            data: json!({"rebuilt":true}),
        })
    }
}
