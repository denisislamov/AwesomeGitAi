use crate::HostService;
use agai_protocol::*;
use serde_json::Value;
fn item(kind: &str, v: &Value) -> Result<LearningItem> {
    Ok(LearningItem {
        id: serde_json::from_value(v["id"].clone()).map_err(|_| AppError::new("INVALID_DATA"))?,
        kind: kind.into(),
        title: v["title"].as_str().unwrap_or_default().into(),
        snapshot_id: serde_json::from_value(v["snapshot_id"].clone())
            .map_err(|_| AppError::new("INVALID_DATA"))?,
        source: v["source"].as_str().unwrap_or("unknown").into(),
    })
}
impl HostService {
    pub fn learning_list(&self, scope: RepoScope) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        let mut items = vec![];
        for kind in ["trace", "diagram"] {
            for v in self
                .store
                .docs(kind, scope.repo_id, scope.worktree_id)?
                .iter()
                .rev()
                .take(100)
            {
                items.push(item(kind, v)?);
            }
        }
        Ok(DesktopResponse::LearningList { items })
    }
    pub fn learning_get(
        &self,
        scope: RepoScope,
        id: uuid::Uuid,
        kind: String,
    ) -> Result<DesktopResponse> {
        if !["trace", "diagram"].contains(&kind.as_str()) {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let v = self
            .store
            .doc(&kind, &id.to_string())?
            .ok_or_else(|| AppError::new("NOT_FOUND"))?;
        if v["repo_id"] != serde_json::json!(scope.repo_id)
            || v["worktree_id"] != serde_json::json!(scope.worktree_id)
        {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let item = item(&kind, &v)?;
        let snapshot = self.store.snapshot(item.snapshot_id)?;
        if snapshot.repo_id != scope.repo_id || snapshot.worktree_id != scope.worktree_id {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let (trace, diagram) = if kind == "trace" {
            let t: TraceScenario = serde_json::from_value(v["artifact"].clone())
                .map_err(|_| AppError::new("INVALID_DATA"))?;
            agai_domain::trace::validate_trace(&t, &snapshot)?;
            (Some(t), None)
        } else {
            let d: Diagram = serde_json::from_value(v["artifact"].clone())
                .map_err(|_| AppError::new("INVALID_DATA"))?;
            agai_domain::trace::validate_diagram(&d, &snapshot)?;
            (None, Some(d))
        };
        Ok(DesktopResponse::LearningRecord {
            record: LearningRecord {
                item,
                trace,
                diagram,
            },
        })
    }
}
