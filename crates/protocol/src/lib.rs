mod relations;
mod trace;
use base64::{Engine, engine::general_purpose::STANDARD};
pub use relations::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    os::unix::ffi::{OsStrExt, OsStringExt},
    path::PathBuf,
};
pub use trace::*;
use ts_rs::TS;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, AppError>;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
impl AppError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            retryable: code == "STALE_STATE",
        }
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)
    }
}
impl std::error::Error for AppError {}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RequestMeta {
    pub schema_version: u32,
    pub request_id: Uuid,
    pub idempotency_key: Option<Uuid>,
}
impl RequestMeta {
    pub fn validate(&self, write: bool) -> Result<()> {
        if self.schema_version != 1 {
            return Err(AppError::new("UNSUPPORTED_VERSION"));
        }
        if write && self.idempotency_key.is_none() {
            return Err(AppError::new("INVALID_REQUEST"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RepoPath {
    pub display: String,
    pub raw_base64: String,
    pub encoding: String,
}
impl RepoPath {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let value = Self {
            display: String::from_utf8_lossy(bytes).into_owned(),
            raw_base64: STANDARD.encode(bytes),
            encoding: "unix_bytes".into(),
        };
        value.bytes()?;
        Ok(value)
    }
    pub fn bytes(&self) -> Result<Vec<u8>> {
        if self.encoding != "unix_bytes" {
            return Err(AppError::new("CAPABILITY_UNAVAILABLE"));
        }
        let b = STANDARD
            .decode(&self.raw_base64)
            .map_err(|_| AppError::new("INVALID_PATH"))?;
        if b.is_empty()
            || b[0] == b'/'
            || b.contains(&0)
            || b.split(|x| *x == b'/')
                .any(|c| c.is_empty() || c == b".." || c == b"." || c.eq_ignore_ascii_case(b".git"))
        {
            return Err(AppError::new("INVALID_PATH"));
        }
        Ok(b)
    }
    pub fn path(&self) -> Result<PathBuf> {
        Ok(PathBuf::from(OsString::from_vec(self.bytes()?)))
    }
    pub fn from_path(path: &std::path::Path) -> Result<Self> {
        Self::from_bytes(path.as_os_str().as_bytes())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub enum Layer {
    Head,
    Index,
    Worktree,
    Commit { oid: String },
    Imported,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub enum FileState {
    Present,
    Absent,
    Conflicted,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ConflictStage {
    pub stage: u8,
    pub oid: String,
    pub bytes: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct SnapshotFile {
    pub path: RepoPath,
    pub state: FileState,
    pub sha256: String,
    pub blob_oid: Option<String>,
    pub bytes: Vec<u8>,
    pub encoding: String,
    pub newline: String,
    pub stages: Vec<ConflictStage>,
}
impl SnapshotFile {
    pub fn new(path: RepoPath, bytes: Option<Vec<u8>>, oid: Option<String>) -> Self {
        let state = if bytes.is_some() {
            FileState::Present
        } else {
            FileState::Absent
        };
        let bytes = bytes.unwrap_or_default();
        let encoding = if std::str::from_utf8(&bytes).is_ok() {
            "utf8"
        } else {
            "binary"
        }
        .into();
        let newline = if bytes.windows(2).any(|w| w == b"\r\n") {
            "crlf"
        } else {
            "lf"
        }
        .into();
        Self {
            path,
            state,
            sha256: hash(&bytes),
            blob_oid: oid,
            bytes,
            encoding,
            newline,
            stages: vec![],
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct Exclusion {
    pub path: RepoPath,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct Snapshot {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub layer: Layer,
    pub generation: String,
    pub files: Vec<SnapshotFile>,
    pub exclusions: Vec<Exclusion>,
    pub captured_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CapturedState {
    pub head_snapshot_id: Uuid,
    pub index_snapshot_id: Uuid,
    pub worktree_snapshot_id: Uuid,
    pub generation: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FilePair {
    pub old_path: Option<RepoPath>,
    pub new_path: Option<RepoPath>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Comparison {
    pub id: Uuid,
    pub base_snapshot_id: Uuid,
    pub target_snapshot_id: Uuid,
    pub file_pairs: Vec<FilePair>,
    pub diff_algorithm_version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum Side {
    Old,
    New,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Anchor {
    pub comparison_id: Uuid,
    pub snapshot_id: Uuid,
    pub path: RepoPath,
    pub side: Side,
    pub start_line: u32,
    pub end_line: u32,
    pub content_hash: String,
    pub context_hash: String,
    pub symbol: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub enum AnchorResolution {
    Exact,
    Relocated { start_line: u32, end_line: u32 },
    Stale,
    Ambiguous,
    Missing,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StatusEntry {
    pub path: RepoPath,
    pub original_path: Option<RepoPath>,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RepoState {
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub generation: String,
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    pub status_entries: Vec<StatusEntry>,
    pub capabilities: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Commit {
    pub author: String,
    pub date: String,
    pub oid: String,
    pub parents: Vec<String>,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct HistoryPage {
    pub commits: Vec<Commit>,
    pub cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EventInput {
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
    pub kind: String,
    pub entity_id: Uuid,
    pub summary: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct WriteReceipt {
    pub event_id: Uuid,
    pub entity_id: Uuid,
    pub revision: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EventEnvelope {
    pub seq: u32,
    pub event_id: Uuid,
    pub repo_id: Uuid,
    pub schema_version: u32,
    pub kind: String,
    pub entity_id: Uuid,
    pub snapshot_id: Option<Uuid>,
}
#[derive(Debug, Clone)]
pub enum Principal {
    LocalUser,
    McpSession { session_id: Uuid },
    RemoteDevice { device_id: Uuid },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum ReadRequest {
    Hello {},
    GetRepoState {
        repo_id: Uuid,
        worktree_id: Uuid,
    },
    ListHistory {
        repo_id: Uuid,
        worktree_id: Uuid,
        cursor: Option<String>,
        limit: u32,
    },
    ReadSnapshot {
        repo_id: Uuid,
        worktree_id: Uuid,
        snapshot_id: Uuid,
    },
    SearchEvents {
        repo_id: Uuid,
        query: String,
    },
    GetComparison {
        repo_id: Uuid,
        worktree_id: Uuid,
        comparison_id: Uuid,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReadEnvelope {
    pub meta: RequestMeta,
    pub request: ReadRequest,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
pub enum ReadResponse {
    RepoState {
        state: RepoState,
    },
    History {
        page: HistoryPage,
    },
    Hello {
        schema_version: u32,
        capabilities: Vec<String>,
    },
    Snapshot {
        snapshot: Snapshot,
    },
    Events {
        ids: Vec<Uuid>,
    },
    Comparison {
        comparison: Comparison,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RepoScope {
    pub repo_id: Uuid,
    pub worktree_id: Uuid,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub enum Revision {
    Empty,
    Head,
    Index,
    Worktree,
    Commit { oid: String },
    Snapshot { id: Uuid },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BranchRef {
    pub name: String,
    pub oid: String,
    pub remote: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum DesktopRequest {
    MemorySearch {
        scope: RepoScope,
        query: Option<String>,
        actor: Option<String>,
        task_id: Option<String>,
        snapshot_id: Option<String>,
        path: Option<String>,
        offset: u32,
        limit: u32,
    },
    MemoryCatalog {
        scope: RepoScope,
    },
    BundlePreview {
        scope: RepoScope,
        record_ids: Vec<String>,
        snapshot_ids: Vec<Uuid>,
    },
    BundleExport {
        scope: RepoScope,
        record_ids: Vec<String>,
        snapshot_ids: Vec<Uuid>,
        expected_hash: String,
        output_path: String,
    },
    BundleInspect {
        scope: RepoScope,
        input_path: String,
    },
    BundleImport {
        scope: RepoScope,
        input_path: String,
        expected_hash: String,
        confirm_mapping: bool,
    },
    MemoryErase {
        scope: RepoScope,
        confirmation: String,
    },
    MemoryRebuild {
        scope: RepoScope,
    },
    CodeRelations {
        scope: RepoScope,
        snapshot_id: Uuid,
        path: RepoPath,
    },
    LearningList {
        scope: RepoScope,
    },
    LearningGet {
        scope: RepoScope,
        id: Uuid,
        artifact_kind: String,
    },
    GitStart {
        scope: RepoScope,
        expected_generation: String,
        action: GitAction,
    },
    GitPoll {
        id: Uuid,
    },
    GitCancel {
        id: Uuid,
    },
    GitShutdown,
    GitRemotes {
        scope: RepoScope,
    },
    CreateRepository {
        path: String,
        source: Option<String>,
    },
    PrepareSelection {
        scope: RepoScope,
        comparison_id: Uuid,
        path: RepoPath,
        expected_generation: String,
        old_lines: Vec<u32>,
        new_lines: Vec<u32>,
        unstage: bool,
    },
    CreateAgentGrant {
        scope: RepoScope,
    },
    GetDecisions {
        scope: RepoScope,
        comparison_id: Uuid,
        path: RepoPath,
    },
    ReviewDecision {
        scope: RepoScope,
        decision_id: Uuid,
        base_snapshot_id: Uuid,
        target_snapshot_id: Uuid,
        state: ReviewState,
        note: String,
        idempotency_key: Uuid,
    },
    OpenRepository {
        path: String,
    },
    CommitDetails {
        scope: RepoScope,
        oid: String,
        base: Option<String>,
    },
    ListFiles {
        scope: RepoScope,
        revision: Option<String>,
    },
    CompareFile {
        scope: RepoScope,
        path: RepoPath,
        base: Revision,
        target: Revision,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DesktopEnvelope {
    pub meta: RequestMeta,
    pub desktop: DesktopRequest,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
pub enum DesktopResponse {
    MemoryResult {
        #[ts(type = "unknown")]
        data: serde_json::Value,
    },
    CodeRelations {
        report: CodeRelationsReport,
    },
    LearningList {
        items: Vec<LearningItem>,
    },
    LearningRecord {
        record: LearningRecord,
    },
    GitJob {
        job: GitJob,
    },
    GitStopped,
    GitRemotes {
        names: Vec<String>,
    },
    PreparedSelection {
        id: Uuid,
        before: String,
        after: String,
    },
    AgentGrant {
        token: String,
        repo_id: Uuid,
        worktree_id: Uuid,
    },
    Decisions {
        decisions: Vec<DecisionView>,
        truncated: bool,
    },
    Reviewed {
        review: HumanReview,
    },
    Repository {
        state: RepoState,
        branches: Vec<BranchRef>,
        root: String,
    },
    Files {
        paths: Vec<RepoPath>,
    },
    CommitDetails {
        oid: String,
        base_oid: Option<String>,
        author: String,
        date: String,
        message: String,
        paths: Vec<RepoPath>,
        parents: Vec<String>,
    },
    FileComparison {
        comparison: Comparison,
        base: Snapshot,
        target: Snapshot,
        observed_generation: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub enum ReviewState {
    Viewed,
    Accepted,
    Question,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct HumanReview {
    pub decision_id: Uuid,
    pub base_snapshot_id: Uuid,
    pub target_snapshot_id: Uuid,
    pub state: ReviewState,
    pub note: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DecisionAlternative {
    pub description: String,
    pub reason_not_chosen: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DecisionAnchorView {
    pub anchor: Anchor,
    pub resolution: AnchorResolution,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EvidenceView {
    pub check: String,
    pub status: String,
    pub environment: String,
    pub summary: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DecisionView {
    pub id: Uuid,
    pub revision: u32,
    pub session_id: Uuid,
    pub summary: String,
    pub behavior: String,
    pub rationale: String,
    pub constraints: Vec<String>,
    pub alternatives: Vec<DecisionAlternative>,
    pub anchors: Vec<DecisionAnchorView>,
    pub evidence: Vec<EvidenceView>,
    pub source: String,
    pub superseded_by: Option<Uuid>,
    pub supersedes: Option<Uuid>,
    pub supersede_reason: Option<String>,
    pub base_snapshot_id: Uuid,
    pub target_snapshot_id: Uuid,
    pub review: Option<HumanReview>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentEnvelope {
    pub agent: AgentCall,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentCall {
    pub token: String,
    pub tool: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum GitAction {
    Stage { path: RepoPath },
    Unstage { path: RepoPath },
    ApplyPrepared { id: Uuid },
    Commit { message: String },
    CreateBranch { name: String },
    SwitchBranch { name: String },
    Fetch { remote: String },
    Pull { remote: String, branch: String },
    Push { remote: String, branch: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitJob {
    pub id: Uuid,
    pub root: String,
    pub status: String,
    pub error: Option<String>,
    pub cancel_requested: bool,
    pub state_changed: bool,
    pub outcome_uncertain: bool,
}
