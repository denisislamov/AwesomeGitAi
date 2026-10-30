use crate::RepoPath;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SourceLocation {
    pub path: RepoPath,
    pub line: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TraceValue {
    pub name: String,
    pub type_name: String,
    pub value: String,
    pub known: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TraceFrame {
    pub id: String,
    pub label: String,
    pub location: SourceLocation,
    pub locals: Vec<TraceValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub enum TracePhase {
    Before,
    After,
    Return,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TraceStep {
    pub id: String,
    pub phase: TracePhase,
    pub location: Option<SourceLocation>,
    pub frames: Vec<TraceFrame>,
    pub explanation: String,
    pub next: Option<String>,
    pub over: Option<String>,
    pub into: Option<String>,
    pub out: Option<String>,
    pub result: Option<TraceValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TraceScenario {
    pub snapshot_id: Uuid,
    pub title: String,
    pub inputs: Vec<TraceValue>,
    pub assumptions: Vec<String>,
    pub entry_step: String,
    pub steps: Vec<TraceStep>,
    #[serde(default)]
    pub final_values: Vec<TraceValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramNode {
    pub id: String,
    pub label: String,
    pub location: Option<SourceLocation>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub enum EdgeCertainty {
    Reported,
    Inferred,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub label: String,
    pub certainty: EdgeCertainty,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Diagram {
    pub snapshot_id: Uuid,
    pub title: String,
    pub assumptions: Vec<String>,
    pub nodes: Vec<DiagramNode>,
    pub edges: Vec<DiagramEdge>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LearningItem {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub snapshot_id: Uuid,
    pub source: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LearningRecord {
    pub item: LearningItem,
    pub trace: Option<TraceScenario>,
    pub diagram: Option<Diagram>,
}
