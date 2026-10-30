//! Initial durable append primitive. Host authorization and snapshot manifests
//! are separate T1/T2 layers and are not implemented by this crate yet.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::{path::Path, time::Duration};

pub struct Store {
    connection: Connection,
    path: Option<std::path::PathBuf>,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(|e| e.to_string())?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 4 {
            return Err("UNSUPPORTED_VERSION".into());
        }
        if version == 1 || version == 2 {
            let first = path.with_extension(format!("v{version}.bak"));
            let backup = if first.exists() {
                path.with_extension(format!(
                    "v{version}.{}.{}.bak",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis(),
                    uuid::Uuid::new_v4()
                ))
            } else {
                first
            };
            connection
                .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .map_err(|e| e.to_string())?;
        }
        if version < 2 {
            connection
                .execute_batch(include_str!("../migrations/002.sql"))
                .map_err(|e| e.to_string())?;
        }
        connection
            .execute_batch(include_str!("../migrations/003.sql"))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch(include_str!("../migrations/004.sql"))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            path: Some(path.to_path_buf()),
        })
    }

    /// Returns only after the event and its bytes commit together.
    /// The caller must namespace the key by authenticated scope.
    pub fn append(
        &mut self,
        version: u32,
        key: &str,
        payload: &str,
        bytes: &[u8],
    ) -> Result<String, String> {
        if version != 1 {
            return Err("UNSUPPORTED_VERSION".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let previous: Option<(String, String, Vec<u8>)> = tx
            .query_row(
                "SELECT id,payload,bytes FROM entries WHERE request_key=?1",
                [key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((id, old_payload, old_bytes)) = previous {
            if old_payload != payload || old_bytes != bytes {
                return Err("IDEMPOTENCY_CONFLICT".into());
            }
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO entries(id,request_key,payload,bytes) VALUES(?1,?2,?3,?4)",
            params![id, key, payload, bytes],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(id)
    }
    pub fn read(&self, id: &str) -> Result<Vec<u8>, String> {
        self.connection
            .query_row("SELECT bytes FROM entries WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())
    }
}
mod events;

mod documents;
pub use documents::DocumentChange;

mod memory;
pub use memory::*;
