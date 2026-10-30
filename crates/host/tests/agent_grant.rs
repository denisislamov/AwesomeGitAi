use agai_host::HostService;
use agai_protocol::*;
use agai_storage::Store;
#[test]
fn grants_require_local_user_and_reject_unknown_token() {
    let tmp = tempfile::tempdir().unwrap();
    let mut h = HostService::new(Store::open(&tmp.path().join("db")).unwrap());
    let scope = RepoScope {
        repo_id: uuid::Uuid::new_v4(),
        worktree_id: uuid::Uuid::new_v4(),
    };
    assert_eq!(
        h.desktop(
            &Principal::McpSession {
                session_id: uuid::Uuid::new_v4()
            },
            DesktopRequest::CreateAgentGrant { scope }
        )
        .unwrap_err()
        .code,
        "SCOPE_DENIED"
    );
    assert_eq!(
        h.agent(AgentCall {
            token: "invalid".into(),
            tool: "integration_guide".into(),
            arguments: serde_json::json!({"schema_version":1})
        })
        .unwrap_err()
        .code,
        "SCOPE_DENIED"
    );
}
#[test]
fn real_agent_explanation_and_human_review_are_bound_to_original_pair() {
    use serde_json::{Value, json};
    use uuid::Uuid;
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path().join("repo");
    std::fs::create_dir(&repo).unwrap();
    assert!(
        std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(&repo)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(repo.join("a.cs"), "old\n").unwrap();
    std::fs::write(repo.join("b.cs"), "other\n").unwrap();
    let mut h = HostService::new(Store::open(&tmp.path().join("db")).unwrap());
    let state = h.register_repository(&repo).unwrap();
    let scope = RepoScope {
        repo_id: state.repo_id,
        worktree_id: state.worktree_id,
    };
    let DesktopResponse::AgentGrant { token, .. } = h
        .desktop(
            &Principal::LocalUser,
            DesktopRequest::CreateAgentGrant {
                scope: scope.clone(),
            },
        )
        .unwrap()
    else {
        panic!()
    };
    let call = |h: &mut HostService, tool: &str, args: Value| {
        h.agent(AgentCall {
            token: token.clone(),
            tool: tool.into(),
            arguments: args,
        })
        .unwrap()
    };
    let write = |mut v: Value| {
        v["schema_version"] = json!(1);
        v["request_id"] = json!(Uuid::new_v4());
        v["idempotency_key"] = json!(Uuid::new_v4());
        v
    };
    let context = json!({"schema_version":1,"repo_id":state.repo_id,"worktree_id":state.worktree_id,"task":"change","paths":["a.cs","b.cs"],"budget_chars":1000});
    let ctx = call(&mut h, "context_get", context.clone());
    let session = call(
        &mut h,
        "session_open",
        write(
            json!({"repo_id":state.repo_id,"worktree_id":state.worktree_id,"task":"change","actor":"test","expected_generation":ctx["generation"]}),
        ),
    );
    std::fs::write(repo.join("a.cs"), "new\n").unwrap();
    let ctx = call(&mut h, "context_get", context);
    let capture = call(
        &mut h,
        "snapshot_capture",
        write(
            json!({"session_id":session["session_id"],"paths":["a.cs","b.cs"],"expected_generation":ctx["generation"]}),
        ),
    );
    let anchor = json!({"comparison_id":capture["comparison"]["id"],"snapshot_id":capture["snapshot_id"],"path":"a.cs","side":"new","start_line":1,"end_line":1,"content_hash":hash(b"new\n")});
    let recorded = call(
        &mut h,
        "decision_record",
        write(
            json!({"decision":{"session_id":session["session_id"],"snapshot_id":capture["snapshot_id"],"summary":"A change","behavior":"New behavior","rationale":"Required","constraints":[],"alternatives":[],"anchors":[anchor],"source":"agent_reported"}}),
        ),
    );
    let c: Comparison = serde_json::from_value(capture["comparison"].clone()).unwrap();
    let decision_id: Uuid = serde_json::from_value(recorded["decision_id"].clone()).unwrap();
    let path = RepoPath::from_bytes(b"a.cs").unwrap();
    let DesktopResponse::Decisions { decisions, .. } =
        h.decisions(scope.clone(), c.id, path.clone()).unwrap()
    else {
        panic!()
    };
    assert!(matches!(
        decisions[0].anchors[0].resolution,
        AnchorResolution::Exact
    ));
    assert!(decisions[0].review.is_none());
    let DesktopResponse::FileComparison { base, target, .. } = h
        .desktop(
            &Principal::LocalUser,
            DesktopRequest::CompareFile {
                scope: scope.clone(),
                path: path.clone(),
                base: Revision::Snapshot {
                    id: c.base_snapshot_id,
                },
                target: Revision::Snapshot {
                    id: c.target_snapshot_id,
                },
            },
        )
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(base.id, c.base_snapshot_id);
    assert_eq!(target.id, c.target_snapshot_id);
    assert_eq!(base.files.len(), 2);
    let key = Uuid::new_v4();
    h.review_decision(
        scope.clone(),
        decision_id,
        c.base_snapshot_id,
        c.target_snapshot_id,
        ReviewState::Accepted,
        "human".into(),
        key,
    )
    .unwrap();
    h.review_decision(
        scope.clone(),
        decision_id,
        c.base_snapshot_id,
        c.target_snapshot_id,
        ReviewState::Accepted,
        "human".into(),
        key,
    )
    .unwrap();
    let DesktopResponse::Decisions { decisions, .. } =
        h.decisions(scope.clone(), c.id, path.clone()).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        decisions[0].review.as_ref().unwrap().state,
        ReviewState::Accepted
    );
    let DesktopResponse::FileComparison { comparison, .. } = h
        .desktop(
            &Principal::LocalUser,
            DesktopRequest::CompareFile {
                scope: scope.clone(),
                path: path.clone(),
                base: Revision::Empty,
                target: Revision::Worktree,
            },
        )
        .unwrap()
    else {
        panic!()
    };
    let DesktopResponse::Decisions { decisions, .. } =
        h.decisions(scope.clone(), comparison.id, path).unwrap()
    else {
        panic!()
    };
    assert!(matches!(
        decisions[0].anchors[0].resolution,
        AnchorResolution::Relocated { .. }
    ));
    assert!(decisions[0].review.is_none());
    assert_eq!(
        h.review_decision(
            scope,
            decision_id,
            comparison.base_snapshot_id,
            comparison.target_snapshot_id,
            ReviewState::Accepted,
            "".into(),
            Uuid::new_v4()
        )
        .unwrap_err()
        .code,
        "REVIEW_SNAPSHOT_MISMATCH"
    );
}
