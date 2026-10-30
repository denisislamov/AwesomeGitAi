use crate::*;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CodeRelationsReport {
    pub origin_snapshot_id: Uuid,
    pub snapshot_id: Uuid,
    pub status: String,
    pub adapter: String,
    pub message: String,
    pub files: Vec<RepoPath>,
    pub symbols: Vec<RelationSymbol>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RelationSymbol {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: RepoPath,
    pub line: u32,
    pub column: u32,
    pub references: Vec<RelationReference>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RelationReference {
    pub path: RepoPath,
    pub line: u32,
    pub column: u32,
    pub kind: String,
    pub snippet: String,
}
