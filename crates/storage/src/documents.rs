use crate::Store;
use agai_protocol::{AppError, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use uuid::Uuid;
pub struct DocumentChange {
    pub kind: String,
    pub id: String,
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub expected_revision: u64,
    pub data: Value,
}
fn db(_: rusqlite::Error) -> AppError {
    AppError::new("STORAGE_ERROR")
}
fn decode(s: String) -> Result<Value> {
    serde_json::from_str(&s).map_err(|_| AppError::new("INVALID_DATA"))
}
fn change(tx: &Transaction<'_>, c: &DocumentChange) -> Result<()> {
    if c.data["revision"].as_u64() != c.expected_revision.checked_add(1) {
        return Err(AppError::new("INVALID_REVISION"));
    }
    let count = if c.expected_revision == 0 {
        tx.execute(
            "INSERT OR IGNORE INTO documents VALUES(?1,?2,?3,?4,1,?5)",
            params![
                c.kind,
                c.id,
                c.repo_id.to_string(),
                c.worktree_id.to_string(),
                c.data.to_string()
            ],
        )
        .map_err(db)?
    } else {
        tx.execute("UPDATE documents SET revision=revision+1,data=?1 WHERE kind=?2 AND id=?3 AND repo_id=?4 AND worktree_id=?5 AND revision=?6",params![c.data.to_string(),c.kind,c.id,c.repo_id.to_string(),c.worktree_id.to_string(),c.expected_revision]).map_err(db)?
    };
    if count != 1 {
        return Err(AppError::new("REVISION_CONFLICT"));
    }
    Ok(())
}
impl Store {
    pub fn search_decisions(&self, repo: Uuid, wt: Uuid, query: &str) -> Result<Vec<String>> {
        if query.len() > 4096 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let literal = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt=self.connection.prepare("SELECT id FROM decision_search WHERE repo_id=?1 AND worktree_id=?2 AND decision_search MATCH ?3 ORDER BY rank LIMIT 100").map_err(db)?;
        stmt.query_map(params![repo.to_string(), wt.to_string(), literal], |r| {
            r.get::<_, String>(0)
        })
        .map_err(db)?
        .map(|r| r.map_err(db))
        .collect()
    }

    pub fn doc(&self, kind: &str, id: &str) -> Result<Option<Value>> {
        self.connection
            .query_row(
                "SELECT data FROM documents WHERE kind=?1 AND id=?2",
                params![kind, id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(db)?
            .map(decode)
            .transpose()
    }
    pub fn docs(&self, kind: &str, repo: Uuid, wt: Uuid) -> Result<Vec<Value>> {
        let mut q=self.connection.prepare("SELECT data FROM documents WHERE kind=?1 AND repo_id=?2 AND worktree_id=?3 ORDER BY rowid").map_err(db)?;
        q.query_map(params![kind, repo.to_string(), wt.to_string()], |r| {
            r.get::<_, String>(0)
        })
        .map_err(db)?
        .map(|r| decode(r.map_err(db)?))
        .collect()
    }
    pub fn put_doc(
        &mut self,
        kind: &str,
        id: &str,
        repo: Uuid,
        wt: Uuid,
        expected_revision: u64,
        data: &Value,
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        change(
            &tx,
            &DocumentChange {
                kind: kind.into(),
                id: id.into(),
                repo_id: repo,
                worktree_id: wt,
                expected_revision,
                data: data.clone(),
            },
        )?;
        tx.commit().map_err(db)
    }
    pub fn receipt(&self, scope: &str, key: &str, fingerprint: &str) -> Result<Option<Value>> {
        let row: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT fingerprint,response FROM operation_receipts WHERE scope=?1 AND key=?2",
                params![scope, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db)?;
        match row {
            None => Ok(None),
            Some((old, response)) => {
                if old != fingerprint {
                    return Err(AppError::new("IDEMPOTENCY_CONFLICT"));
                }
                Ok(Some(decode(response)?))
            }
        }
    }
    pub fn commit_docs(
        &mut self,
        scope: &str,
        key: &str,
        fingerprint: &str,
        response: &Value,
        changes: &[DocumentChange],
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let old: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,response FROM operation_receipts WHERE scope=?1 AND key=?2",
                params![scope, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db)?;
        if let Some((f, r)) = old {
            if f != fingerprint || decode(r)? != *response {
                return Err(AppError::new("IDEMPOTENCY_CONFLICT"));
            }
            return Ok(());
        }
        for c in changes {
            change(&tx, c)?;
        }
        tx.execute(
            "INSERT INTO operation_receipts VALUES(?1,?2,?3,?4)",
            params![scope, key, fingerprint, response.to_string()],
        )
        .map_err(db)?;
        tx.commit().map_err(db)
    }
}
