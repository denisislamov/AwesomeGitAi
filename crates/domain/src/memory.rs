//! Scoped source material; search never promotes source claims into local acceptance.
use agai_protocol::{AppError, Result};
pub use agai_storage::MemoryRecord as MemoryItem;
use agai_storage::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MemoryFilter {
    pub query: Option<String>,
    pub actor: Option<String>,
    pub task_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub path: Option<String>,
    pub offset: u32,
    pub limit: u32,
}
impl Default for MemoryFilter {
    fn default() -> Self {
        Self {
            query: None,
            actor: None,
            task_id: None,
            snapshot_id: None,
            path: None,
            offset: 0,
            limit: 50,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryPage {
    pub items: Vec<MemoryItem>,
    pub next_offset: Option<u32>,
}
fn contains(v: &Value, key: &str, needle: &str) -> bool {
    match v {
        Value::Object(o) => o.iter().any(|(k, v)| {
            (k == key
                && (v.as_str() == Some(needle)
                    || v.as_array()
                        .is_some_and(|a| a.iter().any(|i| i.as_str() == Some(needle)))))
                || contains(v, key, needle)
        }),
        Value::Array(a) => a.iter().any(|v| contains(v, key, needle)),
        _ => false,
    }
}
pub fn search(store: &Store, repo: Uuid, wt: Uuid, filter: &MemoryFilter) -> Result<MemoryPage> {
    if filter.limit == 0
        || filter.limit > 100
        || filter.offset > 1000000
        || [
            &filter.query,
            &filter.actor,
            &filter.task_id,
            &filter.snapshot_id,
            &filter.path,
        ]
        .iter()
        .any(|s| s.as_ref().is_some_and(|s| s.len() > 4096))
    {
        return Err(AppError::new("INVALID_REQUEST"));
    }
    let records = store.memory_records(repo, wt)?;
    let matches: Vec<_> = records
        .iter()
        .filter(|row| {
            let data = if row.external {
                &row.data["source"]
            } else {
                &row.data
            };
            let session = records
                .iter()
                .find(|s| {
                    if row.external {
                        s.external
                            && s.kind == "imported_agent_session"
                            && s.data["provenance"]["bundle_id"]
                                == row.data["provenance"]["bundle_id"]
                            && data["session_id"].is_string()
                            && data["session_id"] == s.data["provenance"]["source_id"]
                    } else {
                        !s.external
                            && s.kind == "agent_session"
                            && data["session_id"].as_str() == Some(s.id.as_str())
                    }
                })
                .map(|s| {
                    if s.external {
                        &s.data["source"]
                    } else {
                        &s.data
                    }
                });
            let field = |key: &str, needle: &str| {
                contains(data, key, needle) || session.is_some_and(|s| contains(s, key, needle))
            };
            filter
                .query
                .as_ref()
                .is_none_or(|q| data.to_string().to_lowercase().contains(&q.to_lowercase()))
                && filter.actor.as_ref().is_none_or(|a| field("actor", a))
                && filter.task_id.as_ref().is_none_or(|t| {
                    field("task_id", t) || field("task", t) || field("session_id", t)
                })
                && filter.snapshot_id.as_ref().is_none_or(|s| {
                    field("snapshot_id", s)
                        || field("baseline_snapshot_id", s)
                        || field("final_snapshot_id", s)
                })
                && filter
                    .path
                    .as_ref()
                    .is_none_or(|p| field("paths", p) || field("path", p) || field("display", p))
        })
        .collect();
    let start = filter.offset as usize;
    let end = (start + filter.limit as usize).min(matches.len());
    let items = matches
        .iter()
        .skip(start)
        .take(filter.limit as usize)
        .map(|r| (*r).clone())
        .collect();
    Ok(MemoryPage {
        items,
        next_offset: if end < matches.len() {
            Some(end as u32)
        } else {
            None
        },
    })
}

/// Import already inspected bundle material after the host confirms its target mapping.
/// Original record payload and identities remain source claims. Snapshot mappings are
/// explicit provenance so an external anchor never silently becomes a local decision.
pub fn import_bundle(
    store: &mut Store,
    contents: &crate::bundle::BundleContents,
    source_hash: &str,
    repo: Uuid,
    wt: Uuid,
) -> Result<agai_storage::ImportReceipt> {
    use agai_storage::{BundleImport, ImportedDocument};
    use serde_json::json;
    let mut mappings = serde_json::Map::new();
    let snapshots = contents
        .snapshots
        .iter()
        .map(|source| {
            let mut snapshot = source.clone();
            let seed = format!("{}:{repo}:{wt}:{}", contents.manifest.bundle_id, source.id);
            snapshot.id = Uuid::new_v5(&Uuid::NAMESPACE_OID, seed.as_bytes());
            snapshot.repo_id = repo;
            snapshot.worktree_id = wt;
            mappings.insert(source.id.to_string(), json!(snapshot.id));
            snapshot
        })
        .collect();
    let mut documents = Vec::new();
    let mut history = std::collections::BTreeMap::new();
    for record in &contents.records {
        let mut kind = record["kind"]
            .as_str()
            .ok_or_else(|| AppError::new("INVALID_DATA"))?
            .to_string();
        let mut id = record["id"]
            .as_str()
            .ok_or_else(|| AppError::new("INVALID_DATA"))?
            .to_string();
        let mut data = record
            .get("data")
            .ok_or_else(|| AppError::new("INVALID_DATA"))?
            .clone();
        let mut chain = Vec::new();
        while kind.starts_with("imported_") {
            let provenance = data
                .get("provenance")
                .ok_or_else(|| AppError::new("INVALID_DATA"))?
                .clone();
            let source = data
                .get("source")
                .ok_or_else(|| AppError::new("INVALID_DATA"))?
                .clone();
            if let Some(previous) = provenance["history"].as_array() {
                chain.extend(previous.iter().cloned());
            }
            let mut hop = provenance.clone();
            if let Some(fields) = hop.as_object_mut() {
                fields.remove("history");
            }
            chain.push(hop);
            id = provenance["source_id"]
                .as_str()
                .ok_or_else(|| AppError::new("INVALID_DATA"))?
                .to_string();
            kind = provenance["source_kind"]
                .as_str()
                .unwrap_or_else(|| kind.strip_prefix("imported_").unwrap())
                .to_string();
            data = source;
        }
        history.insert(format!("{kind}:{id}"), chain);
        documents.push(ImportedDocument {
            kind,
            source_id: id,
            data,
        });
    }
    // Mapping is its own external record; the original payload stays byte-for-byte semantic JSON.
    documents.push(ImportedDocument{kind:"snapshot_mapping".into(),source_id:contents.manifest.bundle_id.clone(),data:json!({"source_id":contents.manifest.source_id,"snapshot_mapping":mappings,"authority":"external_source_only"})});
    store.import_bundle_with_provenance(
        &BundleImport {
            bundle_id: contents.manifest.bundle_id.clone(),
            source_hash: source_hash.into(),
            repo_id: repo,
            worktree_id: wt,
            documents,
            snapshots,
        },
        &history,
    )
}
