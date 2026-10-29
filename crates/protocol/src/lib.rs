use serde::{Serialize,Deserialize};
use ts_rs::TS;
use uuid::Uuid;
use base64::{Engine,engine::general_purpose::STANDARD};
use sha2::{Sha256,Digest};
use std::{path::PathBuf,ffi::OsString,os::unix::ffi::{OsStrExt,OsStringExt}};

pub type Result<T> = std::result::Result<T,AppError>;
pub fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub struct AppError {pub code:String,pub message:String,pub retryable:bool}
impl AppError {pub fn new(code:&str)->Self{Self{code:code.into(),message:code.into(),retryable:code=="STALE_STATE"}}}
impl std::fmt::Display for AppError{fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{}",self.code)}}
impl std::error::Error for AppError{}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[serde(deny_unknown_fields)]
pub struct RequestMeta{pub schema_version:u32,pub request_id:Uuid,pub idempotency_key:Option<Uuid>}
impl RequestMeta{pub fn validate(&self,write:bool)->Result<()>{if self.schema_version!=1{return Err(AppError::new("UNSUPPORTED_VERSION"))}if write&&self.idempotency_key.is_none(){return Err(AppError::new("INVALID_REQUEST"))}Ok(())}}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct RepoPath{pub display:String,pub raw_base64:String,pub encoding:String}
impl RepoPath{
 pub fn from_bytes(bytes:&[u8])->Result<Self>{let value=Self{display:String::from_utf8_lossy(bytes).into_owned(),raw_base64:STANDARD.encode(bytes),encoding:"unix_bytes".into()};value.bytes()?;Ok(value)}
 pub fn bytes(&self)->Result<Vec<u8>>{if self.encoding!="unix_bytes"{return Err(AppError::new("CAPABILITY_UNAVAILABLE"))}let b=STANDARD.decode(&self.raw_base64).map_err(|_|AppError::new("INVALID_PATH"))?;if b.is_empty()||b[0]==b'/'||b.contains(&0)||b.split(|x|*x==b'/').any(|c|c.is_empty()||c==b".."||c==b"."||c.eq_ignore_ascii_case(b".git")){return Err(AppError::new("INVALID_PATH"))}Ok(b)}
 pub fn path(&self)->Result<PathBuf>{Ok(PathBuf::from(OsString::from_vec(self.bytes()?)))}
 pub fn from_path(path:&std::path::Path)->Result<Self>{Self::from_bytes(path.as_os_str().as_bytes())}
}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub enum Layer{Head,Index,Worktree,Commit{oid:String},Imported}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub enum FileState{Present,Absent,Conflicted}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub struct ConflictStage{pub stage:u8,pub oid:String,pub bytes:Vec<u8>}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub struct SnapshotFile{pub path:RepoPath,pub state:FileState,pub sha256:String,pub blob_oid:Option<String>,pub bytes:Vec<u8>,pub encoding:String,pub newline:String,pub stages:Vec<ConflictStage>}
impl SnapshotFile{pub fn new(path:RepoPath,bytes:Option<Vec<u8>>,oid:Option<String>)->Self{let state=if bytes.is_some(){FileState::Present}else{FileState::Absent};let bytes=bytes.unwrap_or_default();let encoding=if std::str::from_utf8(&bytes).is_ok(){"utf8"}else{"binary"}.into();let newline=if bytes.windows(2).any(|w|w==b"\r\n"){"crlf"}else{"lf"}.into();Self{path,state,sha256:hash(&bytes),blob_oid:oid,bytes,encoding,newline,stages:vec![]}}}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub struct Exclusion{pub path:RepoPath,pub reason:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq,Eq)]
pub struct Snapshot{pub id:Uuid,pub repo_id:Uuid,pub worktree_id:Uuid,pub layer:Layer,pub generation:String,pub files:Vec<SnapshotFile>,pub exclusions:Vec<Exclusion>,pub captured_at:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct CapturedState{pub head_snapshot_id:Uuid,pub index_snapshot_id:Uuid,pub worktree_snapshot_id:Uuid,pub generation:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct FilePair{pub old_path:Option<RepoPath>,pub new_path:Option<RepoPath>}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct Comparison{pub id:Uuid,pub base_snapshot_id:Uuid,pub target_snapshot_id:Uuid,pub file_pairs:Vec<FilePair>,pub diff_algorithm_version:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub enum Side{Old,New}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct Anchor{pub comparison_id:Uuid,pub snapshot_id:Uuid,pub path:RepoPath,pub side:Side,pub start_line:u32,pub end_line:u32,pub content_hash:String,pub context_hash:String,pub symbol:Option<String>}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq)]
pub enum AnchorResolution{Exact,Relocated{start_line:u32,end_line:u32},Stale,Ambiguous,Missing}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct StatusEntry{pub path:RepoPath,pub original_path:Option<RepoPath>,pub status:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct RepoState{pub repo_id:Uuid,pub worktree_id:Uuid,pub generation:String,pub head_oid:Option<String>,pub branch:Option<String>,pub status_entries:Vec<StatusEntry>,pub capabilities:Vec<String>}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct Commit{pub oid:String,pub parents:Vec<String>,pub subject:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct HistoryPage{pub commits:Vec<Commit>,pub cursor:Option<String>}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct EventInput{pub repo_id:Uuid,pub worktree_id:Uuid,pub kind:String,pub entity_id:Uuid,pub summary:String}
#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq)]
pub struct WriteReceipt{pub event_id:Uuid,pub entity_id:Uuid,pub revision:u32}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
pub struct EventEnvelope{pub seq:u32,pub event_id:Uuid,pub repo_id:Uuid,pub schema_version:u32,pub kind:String,pub entity_id:Uuid,pub snapshot_id:Option<Uuid>}
#[derive(Debug,Clone)]
pub enum Principal{LocalUser,McpSession{session_id:Uuid},RemoteDevice{device_id:Uuid}}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[serde(tag="kind",deny_unknown_fields)]
pub enum ReadRequest{Hello{},ReadSnapshot{repo_id:Uuid,worktree_id:Uuid,snapshot_id:Uuid},SearchEvents{repo_id:Uuid,query:String},GetComparison{repo_id:Uuid,worktree_id:Uuid,comparison_id:Uuid}}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[serde(deny_unknown_fields)]
pub struct ReadEnvelope{pub meta:RequestMeta,pub request:ReadRequest}
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[serde(tag="kind")]
pub enum ReadResponse{Hello{schema_version:u32,capabilities:Vec<String>},Snapshot{snapshot:Snapshot},Events{ids:Vec<Uuid>},Comparison{comparison:Comparison}}
