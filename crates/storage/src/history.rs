//! Lossless scoped persistence image. Original JSON strings stay byte-for-byte intact.
use crate::Store;
use agai_protocol::{AppError, Result};
use rusqlite::{OptionalExtension, params, types::Value as Sql};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HistoryImage {
    pub version: u32,
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub tables: BTreeMap<String, Vec<Vec<Value>>>,
}
const TABLES: &[(&str, &str, &str)] = &[
    (
        "documents",
        "kind,id,repo_id,worktree_id,revision,data",
        "repo_id=?1 AND worktree_id=?2 AND kind!='agent_grant'",
    ),
    (
        "snapshots",
        "id,repo_id,worktree_id,data",
        "repo_id=?1 AND worktree_id=?2",
    ),
    (
        "events",
        "id,repo_id,worktree_id,request_key,fingerprint,receipt,summary,data",
        "repo_id=?1 AND worktree_id=?2",
    ),
    (
        "comparisons",
        "id,data",
        "json_extract(data,'$.base_snapshot_id') IN (SELECT id FROM snapshots WHERE repo_id=?1 AND worktree_id=?2) AND json_extract(data,'$.target_snapshot_id') IN (SELECT id FROM snapshots WHERE repo_id=?1 AND worktree_id=?2)",
    ),
    (
        "operation_receipts",
        "scope,key,fingerprint,response",
        "(instr(scope,?1)>0 AND instr(scope,?2)>0) OR EXISTS(SELECT 1 FROM documents d WHERE d.repo_id=?1 AND d.worktree_id=?2 AND (instr(operation_receipts.response,d.id)>0 OR operation_receipts.scope=json_extract(d.data,'$.grant_id') OR operation_receipts.scope=json_extract(d.data,'$.id')))",
    ),
    (
        "bundle_imports",
        "repo_id,worktree_id,bundle_id,fingerprint,receipt,redacted",
        "repo_id=?1 AND worktree_id=?2",
    ),
    (
        "redaction_tombstones",
        "id,repo_id,worktree_id",
        "repo_id=?1 AND worktree_id=?2",
    ),
];
fn err(_: rusqlite::Error) -> AppError {
    AppError::new("HISTORY_STORAGE_ERROR")
}
impl HistoryImage {
    pub fn digest(&self) -> Result<String> {
        Ok(agai_protocol::hash(
            &serde_json::to_vec(self).map_err(|_| AppError::new("INVALID_HISTORY"))?,
        ))
    }
    pub fn is_empty(&self) -> bool {
        self.tables.values().all(Vec::is_empty)
    }
    pub fn validate(&self) -> Result<()> {
        let invalid = || AppError::new("INVALID_HISTORY");
        if self.version != 1 || self.tables.len() != TABLES.len() {
            return Err(invalid());
        }
        for (name, cols, _) in TABLES {
            let rows = self.tables.get(*name).ok_or_else(invalid)?;
            for row in rows {
                if row.len() != cols.split(',').count() {
                    return Err(invalid());
                }
                for (col, v) in cols.split(',').zip(row) {
                    if col == "revision" || col == "redacted" {
                        if v.as_i64().is_none() {
                            return Err(invalid());
                        }
                    } else if v.as_str().is_none() {
                        return Err(invalid());
                    }
                    if col == "repo_id" && v.as_str() != Some(&self.repo_id.to_string()) {
                        return Err(invalid());
                    }
                    if col == "worktree_id" && v.as_str() != Some(&self.worktree_id.to_string()) {
                        return Err(invalid());
                    }
                    if col == "data" || col == "response" || col == "receipt" {
                        let _: Value = serde_json::from_str(v.as_str().ok_or_else(invalid)?)
                            .map_err(|_| invalid())?;
                    }
                }
                if *name == "documents" && row[0] == "agent_grant" {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
}
impl Store {
    pub fn history_revision(&self) -> Result<(u64, i64)> {
        Ok((
            self.connection.total_changes(),
            self.connection
                .query_row("PRAGMA data_version", [], |r| r.get(0))
                .map_err(err)?,
        ))
    }

    pub fn history_image(&self, repo: Uuid, wt: Uuid) -> Result<HistoryImage> {
        let mut tables = BTreeMap::new();
        for (name, cols, filter) in TABLES {
            let mut q = self
                .connection
                .prepare(&format!(
                    "SELECT {cols} FROM {name} WHERE {filter} ORDER BY rowid"
                ))
                .map_err(err)?;
            let count = cols.split(',').count();
            let rows = q
                .query_map(params![repo.to_string(), wt.to_string()], |r| {
                    (0..count)
                        .map(|i| match r.get::<_, Sql>(i)? {
                            Sql::Text(v) => Ok(Value::String(v)),
                            Sql::Integer(v) => Ok(Value::from(v)),
                            _ => Err(rusqlite::Error::InvalidQuery),
                        })
                        .collect::<std::result::Result<Vec<_>, _>>()
                })
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            tables.insert(name.to_string(), rows);
        }
        Ok(HistoryImage {
            version: 1,
            repo_id: repo,
            worktree_id: wt,
            tables,
        })
    }
    /// Only an empty scope or an identical image may be restored automatically.
    pub fn restore_history(&self, image: &HistoryImage) -> Result<()> {
        image.validate()?;
        let current = self.history_image(image.repo_id, image.worktree_id)?;
        if current == *image {
            return Ok(());
        }
        if !current.is_empty() {
            return Err(AppError::new("HISTORY_DIVERGED"));
        }
        let tx = self.connection.unchecked_transaction().map_err(err)?;
        for (name, cols, _) in TABLES {
            let n = cols.split(',').count();
            let binds = (1..=n)
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(",");
            for row in &image.tables[*name] {
                let values = row
                    .iter()
                    .map(|v| {
                        if let Some(s) = v.as_str() {
                            Sql::Text(s.into())
                        } else {
                            Sql::Integer(v.as_i64().unwrap())
                        }
                    })
                    .collect::<Vec<_>>();
                tx.execute(
                    &format!("INSERT INTO {name}({cols}) VALUES({binds})"),
                    rusqlite::params_from_iter(values),
                )
                .map_err(err)?;
            }
        }
        tx.execute("INSERT INTO event_search SELECT id,repo_id,summary FROM events WHERE repo_id=?1 AND worktree_id=?2",params![image.repo_id.to_string(),image.worktree_id.to_string()]).map_err(err)?;
        if self.history_image(image.repo_id, image.worktree_id)? != *image {
            return Err(AppError::new("HISTORY_RESTORE_MISMATCH"));
        }
        tx.commit().map_err(err)?;
        Ok(())
    }
    fn history_metadata(&self) -> Result<()> {
        self.connection.execute_batch("CREATE TABLE IF NOT EXISTS history_checkpoints(repo_id TEXT NOT NULL,worktree_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(repo_id,worktree_id));").map_err(err)
    }
    pub fn history_base(&self, repo: Uuid, wt: Uuid) -> Result<Option<String>> {
        self.history_metadata()?;
        self.connection
            .query_row(
                "SELECT digest FROM history_checkpoints WHERE repo_id=?1 AND worktree_id=?2",
                params![repo.to_string(), wt.to_string()],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)
    }
    pub fn set_history_base(&self, repo: Uuid, wt: Uuid, digest: &str) -> Result<()> {
        self.history_metadata()?;
        self.connection.execute("INSERT INTO history_checkpoints VALUES(?1,?2,?3) ON CONFLICT(repo_id,worktree_id) DO UPDATE SET digest=excluded.digest",params![repo.to_string(),wt.to_string(),digest]).map_err(err)?;
        Ok(())
    }
}
