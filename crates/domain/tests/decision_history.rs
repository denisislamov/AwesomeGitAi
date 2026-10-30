use agai_domain::agent::agent_call;
use agai_git::GitReader;
use agai_protocol::*;
use agai_storage::Store;
use serde_json::{Value, json};
use uuid::Uuid;
struct Fixture {
    repo: tempfile::TempDir,
    _profile: tempfile::TempDir,
    store: Store,
    reader: GitReader,
    grant: Uuid,
}
impl Fixture {
    fn new() -> Self {
        let repo = tempfile::tempdir().unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "fixture@example.invalid"],
            vec!["config", "user.name", "Fixture"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(repo.path())
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        std::fs::write(repo.path().join("a.cs"), "human dirty baseline\n").unwrap();
        let profile = tempfile::tempdir().unwrap();
        let store = Store::open(&profile.path().join("db")).unwrap();
        let reader = GitReader::new(repo.path()).unwrap();
        Self {
            repo,
            _profile: profile,
            store,
            reader,
            grant: Uuid::new_v4(),
        }
    }
    fn call(&mut self, tool: &str, args: Value) -> Result<Value> {
        agent_call(&mut self.store, &self.reader, self.grant, tool, args)
    }
    fn context(&mut self) -> Value {
        self.call("context_get",json!({"schema_version":1,"repo_id":self.reader.repo_id,"worktree_id":self.reader.worktree_id,"task":"explain","paths":["a.cs"],"budget_chars":2000})).unwrap()
    }
    fn session(&mut self) -> Value {
        let ctx = self.context();
        self.call("session_open",write(json!({"repo_id":self.reader.repo_id,"worktree_id":self.reader.worktree_id,"task":"explain","actor":"test agent","expected_generation":ctx["generation"]}))).unwrap()
    }
    fn capture(&mut self, s: &Value) -> Value {
        std::fs::write(self.repo.path().join("a.cs"), "agent changed code\n").unwrap();
        let ctx = self.context();
        self.call("snapshot_capture",write(json!({"session_id":s["session_id"],"paths":["a.cs"],"expected_generation":ctx["generation"]}))).unwrap()
    }
    fn decision(&self, s: &Value, c: &Value) -> Value {
        json!({"session_id":s["session_id"],"snapshot_id":c["snapshot_id"],"summary":"change","behavior":"new behavior","rationale":"required","constraints":[],"alternatives":[],"source":"agent_reported","anchors":[{"comparison_id":c["comparison"]["id"],"snapshot_id":c["snapshot_id"],"path":"a.cs","side":"new","start_line":1,"end_line":1,"content_hash":hash(b"agent changed code\n")}]})
    }
}
fn write(mut v: Value) -> Value {
    v["schema_version"] = json!(1);
    v["request_id"] = json!(Uuid::new_v4());
    v["idempotency_key"] = json!(Uuid::new_v4());
    v
}
#[test]
fn real_decision_retry_supersede_history_and_dirty_baseline() {
    let mut f = Fixture::new();
    let s = f.session();
    let c = f.capture(&s);
    let base = Uuid::parse_str(c["comparison"]["base_snapshot_id"].as_str().unwrap()).unwrap();
    assert_eq!(
        f.store.snapshot(base).unwrap().files[0].bytes,
        b"human dirty baseline\n"
    );
    let decision = f.decision(&s, &c);
    let args = write(json!({"decision":decision}));
    let recorded = f.call("decision_record", args.clone()).unwrap();
    assert_eq!(f.call("decision_record", args).unwrap(), recorded);
    let supersede = write(
        json!({"old_decision_id":recorded["decision_id"],"expected_revision":1,"reason":"better explanation","new_decision":decision}),
    );
    let newer = f.call("decision_supersede", supersede.clone()).unwrap();
    assert_eq!(f.call("decision_supersede", supersede).unwrap(), newer);
    let conflict = write(
        json!({"old_decision_id":recorded["decision_id"],"expected_revision":1,"reason":"stale","new_decision":decision}),
    );
    assert_eq!(
        f.call("decision_supersede", conflict).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let old = f
        .store
        .doc("decision", recorded["decision_id"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(old["superseded_by"], newer["decision_id"]);
    assert_eq!(old["revision"], 2);
    assert_eq!(old["schema_version"], 1);
    assert!(old["idempotency_key"].is_string());
}
#[test]
fn rejects_foreign_grant_invalid_anchor_and_human_injection() {
    let mut f = Fixture::new();
    let s = f.session();
    let c = f.capture(&s);
    let decision = f.decision(&s, &c);
    let mut bad = decision.clone();
    bad["anchors"][0]["content_hash"] = json!("0".repeat(64));
    assert_eq!(
        f.call("decision_record", write(json!({"decision":bad})))
            .unwrap_err()
            .code,
        "INVALID_ANCHOR"
    );
    let mut bad = decision.clone();
    bad["acceptedByHuman"] = json!(true);
    assert_eq!(
        f.call("decision_record", write(json!({"decision":bad})))
            .unwrap_err()
            .code,
        "INVALID_REQUEST"
    );
    f.grant = Uuid::new_v4();
    assert_eq!(
        f.call("decision_record", write(json!({"decision":decision})))
            .unwrap_err()
            .code,
        "SCOPE_DENIED"
    );
}
#[test]
fn cancelled_session_can_close_at_baseline_and_reports_missing_explanation() {
    let mut f = Fixture::new();
    let s = f.session();
    let args = write(
        json!({"session_id":s["session_id"],"final_snapshot_id":s["baseline_snapshot_id"],"outcome":"cancelled","summary":"No edit performed","unresolved":["task cancelled"]}),
    );
    let result = f.call("session_close", args.clone()).unwrap();
    assert_eq!(
        result["warnings"],
        json!(["NO_DECISIONS_RECORDED", "NO_AGENT_EVIDENCE_RECORDED"])
    );
    assert_eq!(f.call("session_close", args).unwrap(), result);
}
#[test]
fn retries_ignore_request_id_but_changed_payload_conflicts() {
    let mut f = Fixture::new();
    let s = f.session();
    let c = f.capture(&s);
    let d = f.decision(&s, &c);
    let mut args = write(json!({"decision":d}));
    let first = f.call("decision_record", args.clone()).unwrap();
    args["request_id"] = json!(Uuid::new_v4());
    assert_eq!(f.call("decision_record", args.clone()).unwrap(), first);
    args["decision"]["rationale"] = json!("different rationale");
    assert_eq!(
        f.call("decision_record", args).unwrap_err().code,
        "IDEMPOTENCY_CONFLICT"
    );
}
#[test]
fn evidence_stays_agent_reported_and_session_snapshot_ownership_is_enforced() {
    let mut f = Fixture::new();
    let s = f.session();
    let c = f.capture(&s);
    let d = f.decision(&s, &c);
    let recorded = f
        .call("decision_record", write(json!({"decision":d})))
        .unwrap();
    let mut input = write(
        json!({"session_id":s["session_id"],"snapshot_id":c["snapshot_id"],"decision_ids":[recorded["decision_id"]],"check":"unit tests","status":"passed","environment":"agent laptop","summary":"agent assertion only","source":"agent_reported"}),
    );
    let receipt = f.call("evidence_record", input.clone()).unwrap();
    let doc = f
        .store
        .doc("evidence", receipt["id"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(doc["source"], "agent_reported");
    input["source"] = json!("runner_observed");
    assert_eq!(
        f.call("evidence_record", input).unwrap_err().code,
        "INVALID_REQUEST"
    );
    let other = f.session();
    let mut foreign = f.decision(&other, &c);
    foreign["session_id"] = other["session_id"].clone();
    assert_eq!(
        f.call("decision_record", write(json!({"decision":foreign})))
            .unwrap_err()
            .code,
        "SCOPE_DENIED"
    );
}
#[test]
fn context_is_bounded_and_foreign_snapshot_and_stale_baseline_are_rejected() {
    let mut f = Fixture::new();
    std::fs::write(f.repo.path().join("a.cs"), "line\n".repeat(1000)).unwrap();
    let mut args = json!({"schema_version":1,"repo_id":f.reader.repo_id,"worktree_id":f.reader.worktree_id,"task":"read","paths":["a.cs"],"budget_chars":256});
    let first = f.call("context_get", args.clone()).unwrap();
    assert!(first["content"].as_str().unwrap().chars().count() <= 256);
    assert_eq!(first["truncated"], true);
    args["snapshot_id"] = first["snapshot_id"].clone();
    args["cursor"] = first["cursor"].clone();
    let second = f.call("context_get", args.clone()).unwrap();
    assert_ne!(first["cursor"], second["cursor"]);
    std::fs::write(f.repo.path().join("a.cs"), "changed again").unwrap();
    let open = write(
        json!({"repo_id":f.reader.repo_id,"worktree_id":f.reader.worktree_id,"task":"stale","actor":"agent","expected_generation":first["generation"]}),
    );
    assert_eq!(
        f.call("session_open", open).unwrap_err().code,
        "STALE_STATE"
    );
    f.grant = Uuid::new_v4();
    assert_eq!(
        f.call("context_get", args).unwrap_err().code,
        "SCOPE_DENIED"
    );
}
#[test]
fn context_cursor_rejects_decision_drift_and_filters_other_paths() {
    let mut f = Fixture::new();
    std::fs::write(f.repo.path().join("b.cs"), "unrelated\n").unwrap();
    let s = f.session();
    let c = f.capture(&s);
    let decision = f.decision(&s, &c);
    let base = json!({"schema_version":1,"repo_id":f.reader.repo_id,"worktree_id":f.reader.worktree_id,"task":"read","paths":["a.cs"],"budget_chars":256});
    std::fs::write(f.repo.path().join("a.cs"), "long line\n".repeat(100)).unwrap();
    let first = f.call("context_get", base.clone()).unwrap();
    f.call("decision_record", write(json!({"decision":decision})))
        .unwrap();
    let mut next = base;
    next["snapshot_id"] = first["snapshot_id"].clone();
    next["cursor"] = first["cursor"].clone();
    assert_eq!(
        f.call("context_get", next).unwrap_err().code,
        "INVALID_CURSOR"
    );
    let other=f.call("context_get",json!({"schema_version":1,"repo_id":f.reader.repo_id,"worktree_id":f.reader.worktree_id,"task":"read","paths":["b.cs"],"budget_chars":2000})).unwrap();
    assert!(!other["content"].as_str().unwrap().contains("Decision"));
}
#[test]
fn closed_session_allows_exact_retry_but_rejects_new_write() {
    let mut f = Fixture::new();
    let s = f.session();
    let c = f.capture(&s);
    let d = f.decision(&s, &c);
    let args = write(json!({"decision":d}));
    let recorded = f.call("decision_record", args.clone()).unwrap();
    f.call("session_close",write(json!({"session_id":s["session_id"],"final_snapshot_id":c["snapshot_id"],"outcome":"partial","summary":"unfinished","unresolved":["tests"]}))).unwrap();
    assert_eq!(f.call("decision_record", args).unwrap(), recorded);
    assert_eq!(
        f.call("decision_record", write(json!({"decision":d})))
            .unwrap_err()
            .code,
        "SESSION_CLOSED"
    );
}
