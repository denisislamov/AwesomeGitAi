use crate::{tool_names, tool_schema, write_secret};
use rmcp::{
    ErrorData, ServerHandler,
    model::*,
    service::{RequestContext, RoleServer},
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub const LIMIT: usize = 4 * 1024 * 1024;
const HOST_LIMIT: usize = 16 * 1024 * 1024;
const GUIDE_URI: &str = "agai://integration-guide/v1";
#[derive(Clone)]
pub struct Gateway {
    socket: PathBuf,
    token: Arc<String>,
    http_token: Option<Arc<String>>,
}
fn error(code: &str) -> ErrorData {
    ErrorData::internal_error(code.to_owned(), None)
}
async fn rpc(socket: &Path, request: Value) -> Result<Value, ErrorData> {
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut stream = tokio::net::UnixStream::connect(socket)
            .await
            .map_err(|_| error("HOST_OFFLINE"))?;
        let data = serde_json::to_vec(&request).map_err(|_| error("INVALID_REQUEST"))?;
        if data.len() > HOST_LIMIT {
            return Err(error("PAYLOAD_TOO_LARGE"));
        }
        stream
            .write_u32(data.len() as u32)
            .await
            .map_err(|_| error("HOST_OFFLINE"))?;
        stream
            .write_all(&data)
            .await
            .map_err(|_| error("HOST_OFFLINE"))?;
        let size = stream.read_u32().await.map_err(|_| error("HOST_OFFLINE"))? as usize;
        if size > HOST_LIMIT {
            return Err(error("PAYLOAD_TOO_LARGE"));
        }
        let mut bytes = vec![0; size];
        stream
            .read_exact(&mut bytes)
            .await
            .map_err(|_| error("HOST_OFFLINE"))?;
        let response: Value =
            serde_json::from_slice(&bytes).map_err(|_| error("INVALID_HOST_RESPONSE"))?;
        if let Some(value) = response.get("Ok") {
            return Ok(value.clone());
        }
        // Only return a bounded machine code; host diagnostics may contain paths or credentials.
        let code = response["Err"]["code"]
            .as_str()
            .filter(|s| s.len() <= 64 && s.bytes().all(|b| b.is_ascii_uppercase() || b == b'_'))
            .unwrap_or("HOST_ERROR");
        Err(error(code))
    })
    .await
    .map_err(|_| error("HOST_TIMEOUT"))?
}
fn desktop(request: Value) -> Value {
    json!({"meta":{"schema_version":1,"request_id":uuid::Uuid::new_v4().to_string(),"idempotency_key":null},"desktop":request})
}
impl Gateway {
    /// Keep the two credential namespaces separate and guard outgoing host data.
    pub fn with_http_token(mut self, token: &str) -> Result<Self, ErrorData> {
        if token == self.token.as_str() {
            return Err(error("SEPARATE_HTTP_TOKEN_REQUIRED"));
        }
        self.http_token = Some(Arc::new(token.to_owned()));
        Ok(self)
    }

    pub async fn bootstrap(
        profile: &Path,
        repo: &Path,
        grant_file: &Path,
    ) -> Result<Self, ErrorData> {
        let repo = repo
            .canonicalize()
            .map_err(|_| error("INVALID_REPOSITORY"))?;
        let parent = grant_file.parent().unwrap_or(Path::new("."));
        if parent
            .canonicalize()
            .map_err(|_| error("INVALID_GRANT_PATH"))?
            .starts_with(&repo)
        {
            return Err(error("GRANT_INSIDE_REPOSITORY"));
        }
        let socket = profile.join("host.sock");
        let opened = rpc(
            &socket,
            desktop(json!({"kind":"OpenRepository","path":repo})),
        )
        .await?;
        let scope = json!({"repo_id":opened["state"]["repo_id"],"worktree_id":opened["state"]["worktree_id"]});
        if scope["repo_id"].as_str().is_none() || scope["worktree_id"].as_str().is_none() {
            return Err(error("INVALID_HOST_RESPONSE"));
        }
        let grant = if grant_file
            .try_exists()
            .map_err(|_| error("INVALID_GRANT_FILE"))?
        {
            use std::io::Read;
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            let file = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(grant_file)
                .map_err(|_| error("INVALID_GRANT_FILE"))?;
            let meta = file.metadata().map_err(|_| error("INVALID_GRANT_FILE"))?;
            if !meta.is_file()
                || meta.mode() & 0o777 != 0o600
                || meta.uid() != unsafe { libc::geteuid() }
                || meta.len() > 4096
            {
                return Err(error("INVALID_GRANT_FILE"));
            }
            let mut bytes = Vec::new();
            file.take(4097)
                .read_to_end(&mut bytes)
                .map_err(|_| error("INVALID_GRANT_FILE"))?;
            serde_json::from_slice::<Value>(&bytes).map_err(|_| error("INVALID_GRANT_FILE"))?
        } else {
            let grant = rpc(
                &socket,
                desktop(json!({"kind":"CreateAgentGrant","scope":scope})),
            )
            .await?;
            write_secret(
                grant_file,
                &serde_json::to_vec(&grant).map_err(|_| error("INVALID_HOST_RESPONSE"))?,
            )
            .map_err(|_| error("INVALID_GRANT_FILE"))?;
            grant
        };
        if grant["repo_id"] != scope["repo_id"] || grant["worktree_id"] != scope["worktree_id"] {
            return Err(error("GRANT_SCOPE_MISMATCH"));
        }
        let token = grant["token"]
            .as_str()
            .filter(|t| !t.is_empty())
            .ok_or_else(|| error("INVALID_GRANT_FILE"))?
            .to_string();
        Ok(Self {
            socket,
            token: Arc::new(token),
            http_token: None,
        })
    }
    async fn invoke(&self, name: &str, args: Value) -> Result<Value, ErrorData> {
        let schema =
            tool_schema(name).ok_or_else(|| ErrorData::invalid_params("UNKNOWN_TOOL", None))?;
        if args.to_string().len() > LIMIT {
            return Err(ErrorData::invalid_params("PAYLOAD_TOO_LARGE", None));
        }
        let validator = jsonschema::options()
            .should_validate_formats(true)
            .build(&schema)
            .map_err(|_| error("INVALID_EMBEDDED_SCHEMA"))?;
        if !validator.is_valid(&args) {
            return Err(ErrorData::invalid_params("INVALID_TOOL_INPUT", None));
        }
        let value = rpc(
            &self.socket,
            json!({"agent":{"token":*self.token,"tool":name,"arguments":args}}),
        )
        .await?;
        let serialized = value.to_string();
        if serialized.len() > LIMIT {
            return Err(error("PAYLOAD_TOO_LARGE"));
        }
        if serialized.contains(self.token.as_str())
            || self
                .http_token
                .as_ref()
                .is_some_and(|token| serialized.contains(token.as_str()))
        {
            return Err(error("REDACTED_HOST_RESPONSE"));
        }
        Ok(value)
    }
    async fn guide(&self) -> Result<String, ErrorData> {
        Ok(self
            .invoke("integration_guide", json!({"schema_version":1}))
            .await?
            .to_string())
    }
}
impl ServerHandler for Gateway {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::default();
        info.capabilities = ServerCapabilities::builder()
            .enable_tools()
            .enable_resources()
            .enable_prompts()
            .build();
        info.instructions=Some("AwesomeGitAi contract v1. Start with integration_guide (schema_version: 1), available to tools-only clients. Scope is granted locally; no Git mutations or human acceptance. trace_record and diagram_record are unavailable until T6.".into());
        info
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let tools = tool_names().into_iter().map(|name| {
            let mut tool = Tool::default();
            tool.name = name.into();
            tool.description=Some(match name {
                "integration_guide"=>"Read scoped v1 workflow, examples, identity and next steps before writing.",
                "context_get"=>"Read bounded context for the granted repo/worktree, optionally a pinned snapshot and cursor.",
                "session_open"=>"Open an agent explanation session against the expected repository generation; retain returned IDs and next_actions.",
                "snapshot_capture"=>"Capture exact source content for this session and expected generation; use returned snapshot and comparison anchors.",
                "decision_record"=>"Record agent-reported rationale, behavior, alternatives and exact snapshot anchors; cannot create human acceptance.",
                "event_append"=>"Append an agent-reported action, question, clarification or observation to the session.",
                "evidence_record"=>"Record agent-reported check evidence; this never becomes independent runner evidence.",
                "decision_supersede"=>"Replace a decision only at its expected revision, retaining the old decision and history.",
                _=>"Close a session with final snapshot, outcome, summary and unresolved items."
            }.into());
            tool.input_schema=Arc::new(tool_schema(name).unwrap().as_object().unwrap().clone());tool
        }).collect();
        let mut result = ListToolsResult::default();
        result.tools = tools;
        Ok(result)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let result = self
            .invoke(
                &request.name,
                Value::Object(request.arguments.unwrap_or_default()),
            )
            .await?;
        Ok(CallToolResult::success(vec![ContentBlock::text(result.to_string())]).into())
    }
    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(serde_json::from_value(json!({"resources":[{"uri":GUIDE_URI,"name":"integration_guide","mimeType":"application/json"}]})).unwrap())
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        if request.uri != GUIDE_URI {
            return Err(ErrorData::invalid_params("UNKNOWN_RESOURCE", None));
        }
        let result:ReadResourceResult=serde_json::from_value(json!({"contents":[{"uri":GUIDE_URI,"mimeType":"application/json","text":self.guide().await?}]})).unwrap();
        Ok(result.into())
    }
    async fn list_prompts(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        Ok(serde_json::from_value(json!({"prompts":[{"name":"integration_guide","description":"Scoped v1 integration workflow"}]})).unwrap())
    }
    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        if request.name != "integration_guide" {
            return Err(ErrorData::invalid_params("UNKNOWN_PROMPT", None));
        }
        let result:GetPromptResult=serde_json::from_value(json!({"messages":[{"role":"user","content":{"type":"text","text":self.guide().await?}}]})).unwrap();
        Ok(result.into())
    }
}
