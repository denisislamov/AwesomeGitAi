use crate::HostService;
use agai_protocol::*;
use agai_storage::DocumentChange;
use serde_json::{Value, json};
use uuid::Uuid;
fn invalid() -> AppError {
    AppError::new("INVALID_DATA")
}
fn id(v: &Value, k: &str) -> Result<Uuid> {
    v[k].as_str()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())
}
fn text(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().into()
}
fn scoped(v: &Value, s: &RepoScope) -> Result<()> {
    if id(v, "repo_id")? != s.repo_id || id(v, "worktree_id")? != s.worktree_id {
        return Err(AppError::new("SCOPE_DENIED"));
    }
    Ok(())
}
impl HostService {
    pub fn create_agent_grant(&mut self, scope: RepoScope) -> Result<DesktopResponse> {
        self.reader(scope.repo_id, scope.worktree_id)?;
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let grant_id = Uuid::new_v4();
        self.store.put_doc("agent_grant",&hash(token.as_bytes()),scope.repo_id,scope.worktree_id,0,&json!({"id":grant_id,"revision":1,"repo_id":scope.repo_id,"worktree_id":scope.worktree_id}))?;
        Ok(DesktopResponse::AgentGrant {
            token,
            repo_id: scope.repo_id,
            worktree_id: scope.worktree_id,
        })
    }
    pub fn agent(&mut self, call: AgentCall) -> Result<Value> {
        if call.token.len() != 64 {
            return Err(AppError::new("SCOPE_DENIED"));
        }
        let grant = self
            .store
            .doc("agent_grant", &hash(call.token.as_bytes()))?
            .ok_or_else(|| AppError::new("SCOPE_DENIED"))?;
        let reader = self.reader(id(&grant, "repo_id")?, id(&grant, "worktree_id")?)?;
        agai_domain::agent::agent_call(
            &mut self.store,
            &reader,
            id(&grant, "id")?,
            &call.tool,
            call.arguments,
        )
    }
    pub fn decisions(
        &self,
        scope: RepoScope,
        comparison_id: Uuid,
        path: RepoPath,
    ) -> Result<DesktopResponse> {
        path.bytes()?;
        let c = self.store.comparison(comparison_id)?;
        let base = self.store.snapshot(c.base_snapshot_id)?;
        let target = self.store.snapshot(c.target_snapshot_id)?;
        for s in [&base, &target] {
            if s.repo_id != scope.repo_id || s.worktree_id != scope.worktree_id {
                return Err(AppError::new("SCOPE_DENIED"));
            }
        }
        let evidence = self
            .store
            .docs("evidence", scope.repo_id, scope.worktree_id)?;
        let mut views = vec![];
        let mut truncated = false;
        for d in self
            .store
            .docs("decision", scope.repo_id, scope.worktree_id)?
            .into_iter()
            .rev()
        {
            let mut anchors = vec![];
            for a in d["anchors"].as_array().ok_or_else(invalid)? {
                let p = RepoPath::from_bytes(text(a, "path").as_bytes())?;
                if p.raw_base64 != path.raw_base64 {
                    continue;
                }
                let original = self.store.snapshot(id(a, "snapshot_id")?)?;
                let f = original
                    .files
                    .iter()
                    .find(|f| f.path.raw_base64 == p.raw_base64)
                    .ok_or_else(invalid)?;
                let side = match a["side"].as_str() {
                    Some("old") => Side::Old,
                    Some("new") => Side::New,
                    _ => return Err(invalid()),
                };
                let a = Anchor {
                    comparison_id: id(a, "comparison_id")?,
                    snapshot_id: original.id,
                    path: p,
                    side: side.clone(),
                    start_line: a["start_line"].as_u64().ok_or_else(invalid)? as u32,
                    end_line: a["end_line"].as_u64().ok_or_else(invalid)? as u32,
                    content_hash: text(a, "content_hash"),
                    context_hash: hash(&f.bytes),
                    symbol: None,
                };
                let resolution = agai_domain::anchors::resolve_comparison(
                    &self.store,
                    &a,
                    match side {
                        Side::Old => &base,
                        Side::New => &target,
                    },
                )?;
                anchors.push(DecisionAnchorView {
                    anchor: a,
                    resolution,
                });
            }
            if anchors.is_empty() {
                continue;
            }
            if views.len() == 100 {
                truncated = true;
                break;
            }
            let original = self.store.comparison(anchors[0].anchor.comparison_id)?;
            let decision_id = id(&d, "id")?;
            let review_id = format!(
                "{}:{}:{}",
                decision_id, c.base_snapshot_id, c.target_snapshot_id
            );
            let review = self
                .store
                .doc("human_review", &review_id)?
                .map(|v| serde_json::from_value(v["review"].clone()).map_err(|_| invalid()))
                .transpose()?;
            let es = evidence
                .iter()
                .filter(|e| {
                    e["decision_ids"]
                        .as_array()
                        .is_some_and(|ids| ids.contains(&json!(decision_id)))
                })
                .map(|e| EvidenceView {
                    check: text(e, "check"),
                    status: text(e, "status"),
                    environment: text(e, "environment"),
                    summary: text(e, "summary"),
                })
                .collect();
            views.push(DecisionView {
                id: decision_id,
                revision: d["revision"].as_u64().unwrap_or(1) as u32,
                session_id: id(&d, "session_id")?,
                summary: text(&d, "summary"),
                behavior: text(&d, "behavior"),
                rationale: text(&d, "rationale"),
                constraints: serde_json::from_value(d["constraints"].clone())
                    .map_err(|_| invalid())?,
                alternatives: serde_json::from_value(d["alternatives"].clone())
                    .map_err(|_| invalid())?,
                anchors,
                evidence: es,
                source: "agent_reported".into(),
                superseded_by: d["superseded_by"].as_str().and_then(|s| s.parse().ok()),
                supersedes: d["supersedes"].as_str().and_then(|s| s.parse().ok()),
                supersede_reason: d["supersede_reason"].as_str().map(str::to_owned),
                base_snapshot_id: original.base_snapshot_id,
                target_snapshot_id: original.target_snapshot_id,
                review,
            });
        }
        Ok(DesktopResponse::Decisions {
            decisions: views,
            truncated,
        })
    }
    pub fn review_decision(
        &mut self,
        scope: RepoScope,
        decision_id: Uuid,
        base: Uuid,
        target: Uuid,
        state: ReviewState,
        note: String,
        key: Uuid,
    ) -> Result<DesktopResponse> {
        if note.len() > 8192 {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        let d = self
            .store
            .doc("decision", &decision_id.to_string())?
            .ok_or_else(invalid)?;
        scoped(&d, &scope)?;
        let review = HumanReview {
            decision_id,
            base_snapshot_id: base,
            target_snapshot_id: target,
            state,
            note,
        };
        let args = json!({"scope":scope,"review":review});
        let fp = hash(args.to_string().as_bytes());
        let receipt_scope = format!("human:{}:{}", scope.repo_id, scope.worktree_id);
        if let Some(v) = self.store.receipt(&receipt_scope, &key.to_string(), &fp)? {
            return serde_json::from_value(v).map_err(|_| invalid());
        }
        if d["superseded_by"].is_string() {
            return Err(AppError::new("DECISION_SUPERSEDED"));
        }
        for a in d["anchors"].as_array().ok_or_else(invalid)? {
            let c = self.store.comparison(id(a, "comparison_id")?)?;
            if c.base_snapshot_id != base || c.target_snapshot_id != target {
                return Err(AppError::new("REVIEW_SNAPSHOT_MISMATCH"));
            }
        }
        let review_id = format!("{decision_id}:{base}:{target}");
        let old = self.store.doc("human_review", &review_id)?;
        let revision = old
            .as_ref()
            .and_then(|v| v["revision"].as_u64())
            .unwrap_or(0);
        let result = DesktopResponse::Reviewed {
            review: review.clone(),
        };
        self.store.commit_docs(
            &receipt_scope,
            &key.to_string(),
            &fp,
            &serde_json::to_value(&result).map_err(|_| invalid())?,
            &[DocumentChange {
                kind: "human_review".into(),
                id: review_id,
                repo_id: scope.repo_id,
                worktree_id: scope.worktree_id,
                expected_revision: revision,
                data: json!({"revision":revision+1,"review":review,"source":"local_user"}),
            }],
        )?;
        Ok(result)
    }
}
