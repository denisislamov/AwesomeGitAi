//! Imported sources remain untrusted records, separate from local decisions/reviews.
use crate::Store;
use agai_protocol::{AppError, Result, Snapshot, hash};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedDocument {
    pub kind: String,
    pub source_id: String,
    pub data: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleImport {
    pub bundle_id: String,
    pub source_hash: String,
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub documents: Vec<ImportedDocument>,
    pub snapshots: Vec<Snapshot>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImportReceipt {
    pub bundle_id: String,
    pub document_ids: Vec<String>,
    pub snapshot_ids: Vec<Uuid>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub kind: String,
    pub id: String,
    pub data: Value,
    pub external: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCatalog {
    pub items: Vec<Value>,
    pub total: u64,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionReport {
    pub tombstone_id: Uuid,
    pub documents: u64,
    pub snapshots: u64,
    pub events: u64,
    pub limitations: Vec<String>,
}
fn db(_: rusqlite::Error) -> AppError {
    AppError::new("STORAGE_ERROR")
}
impl Store {
    /// Lightweight chooser rows: SQL projects metadata without decoding source blobs.
    pub fn memory_catalog_records(
        &self,
        repo: Uuid,
        wt: Uuid,
        limit: u32,
    ) -> Result<MemoryCatalog> {
        if limit == 0 || limit > 1000 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        const FILTER: &str = "repo_id=?1 AND worktree_id=?2 AND (kind IN ('decision','agent_session','agent_snapshot','agent_event','evidence','trace','diagram','human_review') OR kind GLOB 'imported_*')";
        let total:u64=self.connection.query_row(&format!("SELECT (SELECT count(*) FROM documents WHERE {FILTER})+(SELECT count(*) FROM events WHERE repo_id=?1 AND worktree_id=?2)"),params![repo.to_string(),wt.to_string()],|r|r.get(0)).map_err(db)?;
        let query = format!(
            "SELECT json_object('id',id,'kind',kind,'external',json(CASE WHEN kind GLOB 'imported_*' THEN 'true' ELSE 'false' END),'summary',substr(CASE WHEN kind GLOB 'imported_*' THEN json_extract(data,'$.source.summary') ELSE json_extract(data,'$.summary') END,1,512),'title',substr(CASE WHEN kind GLOB 'imported_*' THEN json_extract(data,'$.source.title') ELSE json_extract(data,'$.title') END,1,512)) FROM (SELECT id,kind,data,rowid AS ordinal,0 AS origin FROM documents WHERE {FILTER} UNION ALL SELECT id,'event',data,seq,1 FROM events WHERE repo_id=?1 AND worktree_id=?2) ORDER BY origin,ordinal LIMIT ?3"
        );
        self.catalog_query(&query, repo, wt, limit, total)
    }
    pub fn memory_snapshot_catalog(
        &self,
        repo: Uuid,
        wt: Uuid,
        limit: u32,
    ) -> Result<MemoryCatalog> {
        if limit == 0 || limit > 1000 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let total: u64 = self
            .connection
            .query_row(
                "SELECT count(*) FROM snapshots WHERE repo_id=?1 AND worktree_id=?2",
                params![repo.to_string(), wt.to_string()],
                |r| r.get(0),
            )
            .map_err(db)?;
        self.catalog_query("SELECT json_object('id',id,'layer',json_extract(data,'$.layer'),'captured_at',substr(json_extract(data,'$.captured_at'),1,128),'file_count',json_array_length(data,'$.files')) FROM snapshots WHERE repo_id=?1 AND worktree_id=?2 ORDER BY rowid LIMIT ?3",repo,wt,limit,total)
    }
    fn catalog_query(
        &self,
        sql: &str,
        repo: Uuid,
        wt: Uuid,
        limit: u32,
        total: u64,
    ) -> Result<MemoryCatalog> {
        let mut stmt = self.connection.prepare(sql).map_err(db)?;
        let items: Vec<Value> = stmt
            .query_map(params![repo.to_string(), wt.to_string(), limit], |r| {
                r.get::<_, String>(0)
            })
            .map_err(db)?
            .map(|r| {
                serde_json::from_str(&r.map_err(db)?).map_err(|_| AppError::new("INVALID_DATA"))
            })
            .collect::<Result<_>>()?;
        Ok(MemoryCatalog {
            truncated: total > items.len() as u64,
            total,
            items,
        })
    }
    pub fn memory_snapshots(&self, repo: Uuid, wt: Uuid) -> Result<Vec<Snapshot>> {
        let mut stmt = self
            .connection
            .prepare(
                "SELECT data FROM snapshots WHERE repo_id=?1 AND worktree_id=?2 ORDER BY rowid",
            )
            .map_err(db)?;
        stmt.query_map(params![repo.to_string(), wt.to_string()], |r| {
            r.get::<_, String>(0)
        })
        .map_err(db)?
        .map(|r| serde_json::from_str(&r.map_err(db)?).map_err(|_| AppError::new("INVALID_DATA")))
        .collect()
    }
    fn scrub_owned_backups(&mut self, repo: Uuid, wt: Uuid) -> Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(std::path::Path::new("."));
        let stem = path
            .file_stem()
            .ok_or_else(|| AppError::new("INVALID_PATH"))?
            .to_string_lossy();
        for entry in
            std::fs::read_dir(parent).map_err(|_| AppError::new("BACKUP_REDACTION_FAILED"))?
        {
            let entry = entry.map_err(|_| AppError::new("BACKUP_REDACTION_FAILED"))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !(name.ends_with(".bak")
                && (name.starts_with(&format!("{stem}.v1."))
                    || name.starts_with(&format!("{stem}.v2."))))
            {
                continue;
            }
            if !entry
                .file_type()
                .map_err(|_| AppError::new("BACKUP_REDACTION_FAILED"))?
                .is_file()
            {
                return Err(AppError::new("BACKUP_REDACTION_FAILED"));
            }
            let connection = rusqlite::Connection::open(entry.path()).map_err(db)?;
            let version: u32 = connection
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .map_err(db)?;
            if version > 4 {
                return Err(AppError::new("BACKUP_REDACTION_FAILED"));
            }
            // Upgrade owned backup in place without making another copy of the sensitive bytes.
            connection
                .execute_batch(include_str!("../migrations/002.sql"))
                .map_err(db)?;
            connection
                .execute_batch(include_str!("../migrations/003.sql"))
                .map_err(db)?;
            connection
                .execute_batch(include_str!("../migrations/004.sql"))
                .map_err(db)?;
            let mut backup = Store {
                connection,
                path: None,
            };
            backup.redact_memory_scope(repo, wt)?;
        }
        Ok(())
    }
    pub fn memory_records(&self, repo: Uuid, wt: Uuid) -> Result<Vec<MemoryRecord>> {
        let mut stmt=self.connection.prepare("SELECT kind,id,data FROM (SELECT kind,id,data,rowid AS ordinal,0 AS origin FROM documents WHERE repo_id=?1 AND worktree_id=?2 AND (kind IN ('decision','agent_session','agent_snapshot','agent_event','evidence','trace','diagram','human_review') OR kind GLOB 'imported_*') UNION ALL SELECT 'event',id,data,seq AS ordinal,1 AS origin FROM events WHERE repo_id=?1 AND worktree_id=?2) ORDER BY origin,ordinal").map_err(db)?;
        stmt.query_map(params![repo.to_string(), wt.to_string()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(db)?
        .map(|row| {
            let (kind, id, data) = row.map_err(db)?;
            Ok(MemoryRecord {
                external: kind.starts_with("imported_"),
                kind,
                id,
                data: serde_json::from_str(&data).map_err(|_| AppError::new("INVALID_DATA"))?,
            })
        })
        .collect()
    }
    pub fn import_bundle(&mut self, b: &BundleImport) -> Result<ImportReceipt> {
        self.import_bundle_with_provenance(b, &std::collections::BTreeMap::new())
    }
    pub fn import_bundle_with_provenance(
        &mut self,
        b: &BundleImport,
        history: &std::collections::BTreeMap<String, Vec<Value>>,
    ) -> Result<ImportReceipt> {
        if b.documents.len() > 10000
            || b.snapshots.len() > 1000
            || b.bundle_id.is_empty()
            || b.source_hash.is_empty()
        {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let fingerprint =
            hash(&serde_json::to_vec(&(b, history)).map_err(|_| AppError::new("INVALID_DATA"))?);
        let tx = self.connection.transaction().map_err(db)?;
        let r = b.repo_id.to_string();
        let w = b.worktree_id.to_string();
        let old:Option<(String,String,bool)>=tx.query_row("SELECT fingerprint,receipt,redacted FROM bundle_imports WHERE repo_id=?1 AND worktree_id=?2 AND bundle_id=?3",params![r,w,b.bundle_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(db)?;
        if let Some((f, receipt, redacted)) = old {
            if redacted {
                return Err(AppError::new("REDACTED"));
            }
            if f != fingerprint {
                return Err(AppError::new("IDEMPOTENCY_CONFLICT"));
            }
            return serde_json::from_str(&receipt).map_err(|_| AppError::new("INVALID_DATA"));
        }
        let mut receipt = ImportReceipt {
            bundle_id: b.bundle_id.clone(),
            document_ids: vec![],
            snapshot_ids: vec![],
        };
        for d in &b.documents {
            if d.kind.is_empty()
                || d.kind.len() > 80
                || !d
                    .kind
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_')
                || d.source_id.is_empty()
            {
                return Err(AppError::new("INVALID_DATA"));
            }
            let id = Uuid::new_v4().to_string();
            let kind = format!("imported_{}", d.kind);
            let data = json!({"id":id,"revision":1,"repo_id":b.repo_id,"worktree_id":b.worktree_id,"provenance":{"kind":"external","bundle_id":b.bundle_id,"source_id":d.source_id,"source_kind":d.kind,"source_hash":b.source_hash,"history":history.get(&format!("{}:{}",d.kind,d.source_id)).cloned().unwrap_or_default()},"source":d.data});
            tx.execute(
                "INSERT INTO documents VALUES(?1,?2,?3,?4,1,?5)",
                params![kind, id, r, w, data.to_string()],
            )
            .map_err(db)?;
            receipt.document_ids.push(id);
        }
        // Snapshot identities must already be mapped by the importer. Conflicts roll back everything.
        for s in &b.snapshots {
            if s.repo_id != b.repo_id || s.worktree_id != b.worktree_id {
                return Err(AppError::new("SCOPE_DENIED"));
            }
            for f in &s.files {
                f.path.bytes()?;
                if hash(&f.bytes) != f.sha256 {
                    return Err(AppError::new("INVALID_DATA"));
                }
            }
            tx.execute(
                "INSERT INTO snapshots VALUES(?1,?2,?3,?4)",
                params![
                    s.id.to_string(),
                    r,
                    w,
                    serde_json::to_string(s).map_err(|_| AppError::new("INVALID_DATA"))?
                ],
            )
            .map_err(|_| AppError::new("IMMUTABLE_CONFLICT"))?;
            receipt.snapshot_ids.push(s.id);
        }
        tx.execute(
            "INSERT INTO bundle_imports VALUES(?1,?2,?3,?4,?5,0)",
            params![
                r,
                w,
                b.bundle_id,
                fingerprint,
                serde_json::to_string(&receipt).unwrap()
            ],
        )
        .map_err(db)?;
        tx.commit().map_err(db)?;
        Ok(receipt)
    }
    /// Explicit whole-worktree stored-memory erasure. Never modifies repository files.
    pub fn redact_memory_scope(&mut self, repo: Uuid, wt: Uuid) -> Result<RedactionReport> {
        self.scrub_owned_backups(repo, wt)?;
        self.connection
            .execute_batch("PRAGMA secure_delete=ON;")
            .map_err(db)?;
        let tx = self.connection.transaction().map_err(db)?;
        let r = repo.to_string();
        let w = wt.to_string();
        let id = Uuid::new_v4();
        tx.execute("DELETE FROM comparisons WHERE json_extract(data,'$.base_snapshot_id') IN (SELECT id FROM snapshots WHERE repo_id=?1 AND worktree_id=?2) OR json_extract(data,'$.target_snapshot_id') IN (SELECT id FROM snapshots WHERE repo_id=?1 AND worktree_id=?2)",params![r,w]).map_err(db)?;
        tx.execute("DELETE FROM event_search WHERE id IN (SELECT id FROM events WHERE repo_id=?1 AND worktree_id=?2)",params![r,w]).map_err(db)?;
        tx.execute(
            "DELETE FROM decision_search WHERE repo_id=?1 AND worktree_id=?2",
            params![r, w],
        )
        .map_err(db)?;
        // Operation scopes include repo/worktree/grant. Clear responses referencing selected entity IDs as well.
        tx.execute("DELETE FROM operation_receipts WHERE instr(scope,?1)>0 AND instr(scope,?2)>0 OR EXISTS(SELECT 1 FROM documents d WHERE d.repo_id=?1 AND d.worktree_id=?2 AND (instr(operation_receipts.response,d.id)>0 OR operation_receipts.scope=json_extract(d.data,'$.grant_id') OR operation_receipts.scope=json_extract(d.data,'$.id')))",params![r,w]).map_err(db)?;
        let documents = tx
            .execute(
                "DELETE FROM documents WHERE repo_id=?1 AND worktree_id=?2",
                params![r, w],
            )
            .map_err(db)? as u64;
        let snapshots = tx
            .execute(
                "DELETE FROM snapshots WHERE repo_id=?1 AND worktree_id=?2",
                params![r, w],
            )
            .map_err(db)? as u64;
        let events = tx
            .execute(
                "DELETE FROM events WHERE repo_id=?1 AND worktree_id=?2",
                params![r, w],
            )
            .map_err(db)? as u64;
        tx.execute("UPDATE bundle_imports SET fingerprint='',receipt='{}',redacted=1 WHERE repo_id=?1 AND worktree_id=?2",params![r,w]).map_err(db)?;
        tx.execute(
            "INSERT INTO redaction_tombstones VALUES(?1,?2,?3)",
            params![id.to_string(), r, w],
        )
        .map_err(db)?;
        tx.commit().map_err(db)?;
        self.connection.execute_batch("INSERT INTO decision_search(decision_search) VALUES('rebuild'); INSERT INTO event_search(event_search) VALUES('rebuild'); VACUUM;").map_err(db)?;
        let busy: i64 = self
            .connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
            .map_err(db)?;
        if busy != 0 {
            return Err(AppError::new("REDACTION_CHECKPOINT_BUSY"));
        }
        Ok(RedactionReport{tombstone_id:id,documents,snapshots,events,limitations:vec!["Known app migration backups are scope-scrubbed. External exports, filesystem/OS backups and other copies are outside this erasure.".into(),"Filesystem snapshots, SSD wear leveling and other processes' memory cannot be securely erased by SQLite.".into()]})
    }
}
