use agai_protocol::*;
fn fixture() -> (TraceScenario, Snapshot) {
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../packages/fixtures/trace-v1.json")).unwrap();
    let t: TraceScenario = serde_json::from_value(v["success"].clone()).unwrap();
    let s = Snapshot {
        id: t.snapshot_id,
        repo_id: uuid::Uuid::new_v4(),
        worktree_id: uuid::Uuid::new_v4(),
        layer: Layer::Worktree,
        generation: "fixture".into(),
        files: vec![
            SnapshotFile::new(
                RepoPath::from_bytes(b"ResourceWallet.cs").unwrap(),
                Some(include_bytes!("../../../packages/fixtures/ResourceWallet.cs").to_vec()),
                None,
            ),
            SnapshotFile::new(
                RepoPath::from_bytes(b"Dash.cs").unwrap(),
                Some(include_bytes!("../../../packages/fixtures/Dash.cs").to_vec()),
                None,
            ),
        ],
        exclusions: vec![],
        captured_at: "0".into(),
    };
    (t, s)
}
#[test]
fn validates_snapshot_bound_trace_and_rejects_cycles_foreign_locations_and_bad_stack() {
    let (t, s) = fixture();
    agai_domain::trace::validate_trace(&t, &s).unwrap();
    let mut bad = t.clone();
    bad.steps[2].next = Some("0".into());
    assert!(agai_domain::trace::validate_trace(&bad, &s).is_err());
    let mut bad = t.clone();
    bad.steps[3].frames[0].id = "unrelated".into();
    assert!(agai_domain::trace::validate_trace(&bad, &s).is_err());
    let mut bad = t.clone();
    bad.steps[0].location.as_mut().unwrap().line = 999;
    assert!(agai_domain::trace::validate_trace(&bad, &s).is_err());
    let mut bad = t.clone();
    bad.snapshot_id = uuid::Uuid::new_v4();
    assert!(agai_domain::trace::validate_trace(&bad, &s).is_err());
}
#[test]
fn validates_diagram_anchors_and_rejects_dangling_edges() {
    let (t, s) = fixture();
    let mut d = Diagram {
        snapshot_id: t.snapshot_id,
        title: "Flow".into(),
        assumptions: vec!["Reported model".into()],
        nodes: vec![DiagramNode {
            id: "a".into(),
            label: "TryDash".into(),
            location: t.steps[0].location.clone(),
        }],
        edges: vec![],
    };
    agai_domain::trace::validate_diagram(&d, &s).unwrap();
    d.edges.push(DiagramEdge {
        id: "edge".into(),
        from: "a".into(),
        to: "missing".into(),
        label: "calls".into(),
        certainty: EdgeCertainty::Inferred,
    });
    assert!(agai_domain::trace::validate_diagram(&d, &s).is_err());
}
