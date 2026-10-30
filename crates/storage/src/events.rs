use crate::Store;
use agai_protocol::*;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use uuid::Uuid;
fn db_error(_: rusqlite::Error) -> AppError {
    AppError::new("STORAGE_ERROR")
}
fn json_error(_: serde_json::Error) -> AppError {
    AppError::new("INVALID_DATA")
}
impl Store {
    pub fn append_event(
        &mut self,
        meta: &RequestMeta,
        event: &EventInput,
        snapshots: &[Snapshot],
    ) -> Result<WriteReceipt> {
        meta.validate(true)?;
        for s in snapshots {
            if s.repo_id != event.repo_id || s.worktree_id != event.worktree_id {
                return Err(AppError::new("SCOPE_DENIED"));
            }
            for f in &s.files {
                f.path.bytes()?;
                if hash(&f.bytes) != f.sha256 {
                    return Err(AppError::new("INVALID_DATA"));
                }
            }
        }
        let fingerprint = hash(&serde_json::to_vec(&(event, snapshots)).map_err(json_error)?);
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        let key = meta.idempotency_key.unwrap().to_string();
        let repo = event.repo_id.to_string();
        let wt = event.worktree_id.to_string();
        let previous:Option<(String,String)>=tx.query_row("SELECT fingerprint,receipt FROM events WHERE repo_id=?1 AND worktree_id=?2 AND request_key=?3",params![repo,wt,key],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if let Some((old, receipt)) = previous {
            if old != fingerprint {
                return Err(AppError::new("IDEMPOTENCY_CONFLICT"));
            }
            return serde_json::from_str(&receipt).map_err(json_error);
        }
        for s in snapshots {
            let data = serde_json::to_string(s).map_err(json_error)?;
            let existing: Option<String> = tx
                .query_row(
                    "SELECT data FROM snapshots WHERE id=?1",
                    [s.id.to_string()],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db_error)?;
            if let Some(old) = existing {
                if old != data {
                    return Err(AppError::new("IMMUTABLE_CONFLICT"));
                }
            } else {
                tx.execute(
                    "INSERT INTO snapshots VALUES(?1,?2,?3,?4)",
                    params![s.id.to_string(), repo, wt, data],
                )
                .map_err(db_error)?;
            }
        }
        let receipt = WriteReceipt {
            event_id: Uuid::new_v4(),
            entity_id: event.entity_id,
            revision: 1,
        };
        let id = receipt.event_id.to_string();
        tx.execute("INSERT INTO events(id,repo_id,worktree_id,request_key,fingerprint,receipt,summary,data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,repo,wt,key,fingerprint,serde_json::to_string(&receipt).map_err(json_error)?,event.summary,serde_json::to_string(event).map_err(json_error)?]).map_err(db_error)?;
        tx.execute(
            "INSERT INTO event_search(id,repo_id,summary) VALUES(?1,?2,?3)",
            params![id, repo, event.summary],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(receipt)
    }
    pub fn snapshot(&self, id: Uuid) -> Result<Snapshot> {
        let json: String = self
            .connection
            .query_row(
                "SELECT data FROM snapshots WHERE id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        serde_json::from_str(&json).map_err(json_error)
    }
    pub fn search(&self, repo: Uuid, query: &str) -> Result<Vec<Uuid>> {
        if query.len() > 4096 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let literal = format!("\"{}\"", query.replace('"', "\"\""));
        let mut st=self.connection.prepare("SELECT id FROM event_search WHERE repo_id=?1 AND event_search MATCH ?2 ORDER BY rank LIMIT 100").map_err(db_error)?;
        let rows = st
            .query_map(params![repo.to_string(), literal], |r| {
                r.get::<_, String>(0)
            })
            .map_err(db_error)?;
        rows.map(|r| {
            Uuid::parse_str(&r.map_err(db_error)?).map_err(|_| AppError::new("INVALID_DATA"))
        })
        .collect()
    }
    pub fn rebuild_index(&self) -> Result<()> {
        self.connection.execute_batch("BEGIN IMMEDIATE; DROP TABLE IF EXISTS event_search;CREATE VIRTUAL TABLE event_search USING fts5(id UNINDEXED,repo_id UNINDEXED,summary);INSERT INTO event_search SELECT id,repo_id,summary FROM events; DELETE FROM decision_search; INSERT INTO decision_search SELECT id,repo_id,worktree_id,json_extract(data,'$.summary'),json_extract(data,'$.rationale') FROM documents WHERE kind='decision'; COMMIT;").map_err(db_error)
    }
    pub fn save_comparison(&mut self, c: &Comparison) -> Result<()> {
        let a = self.snapshot(c.base_snapshot_id)?;
        let b = self.snapshot(c.target_snapshot_id)?;
        if a.repo_id != b.repo_id || a.worktree_id != b.worktree_id {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let data = serde_json::to_string(c).map_err(json_error)?;
        self.connection
            .execute(
                "INSERT INTO comparisons(id,data) VALUES(?1,?2)",
                params![c.id.to_string(), data],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn comparison(&self, id: Uuid) -> Result<Comparison> {
        let json: String = self
            .connection
            .query_row(
                "SELECT data FROM comparisons WHERE id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        serde_json::from_str(&json).map_err(json_error)
    }
}
impl Store {
    pub fn register_repository(&self, repo: Uuid, worktree: Uuid, path: &[u8]) -> Result<()> {
        self.connection.execute_batch("CREATE TABLE IF NOT EXISTS repositories(repo_id TEXT NOT NULL,worktree_id TEXT PRIMARY KEY NOT NULL,path BLOB NOT NULL);").map_err(db_error)?;
        self.connection.execute("INSERT INTO repositories VALUES(?1,?2,?3) ON CONFLICT(worktree_id) DO UPDATE SET path=excluded.path WHERE repo_id=excluded.repo_id",params![repo.to_string(),worktree.to_string(),path]).map_err(db_error)?;
        Ok(())
    }
    pub fn repository_path(&self, repo: Uuid, worktree: Uuid) -> Result<Vec<u8>> {
        self.connection
            .query_row(
                "SELECT path FROM repositories WHERE repo_id=?1 AND worktree_id=?2",
                params![repo.to_string(), worktree.to_string()],
                |r| r.get(0),
            )
            .map_err(|_| AppError::new("SCOPE_DENIED"))
    }
}
