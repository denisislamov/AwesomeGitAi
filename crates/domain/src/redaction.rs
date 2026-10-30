//! The host exposes erasure only to the authenticated local human surface.
use agai_protocol::{AppError, Result};
pub use agai_storage::RedactionReport;
use agai_storage::Store;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedactionSelection {
    pub confirmed: bool,
}
pub fn redact(
    store: &mut Store,
    repo: Uuid,
    wt: Uuid,
    selection: &RedactionSelection,
) -> Result<RedactionReport> {
    if !selection.confirmed {
        return Err(AppError::new("CONFIRMATION_REQUIRED"));
    }
    store.redact_memory_scope(repo, wt)
}
