use crate::bridge::DesktopHost;
use agai_protocol::{ReadEnvelope, ReadRequest, RequestMeta};
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::Manager;
#[tauri::command]
pub async fn integration_config(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    host: tauri::State<'_, Arc<DesktopHost>>,
    repo: String,
) -> std::result::Result<Value, String> {
    if window.label() != "main" {
        return Err("MAIN_WINDOW_REQUIRED".into());
    }
    let root = host.external_path(&repo, None).map_err(|e| e.code)?;
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|_| "PATH_ERROR")?
        .join("bin/agai-mcp");
    let binary = if packaged.exists() {
        packaged
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/agai-mcp")
    };
    if !binary.is_file() {
        return Err("MCP_BINARY_MISSING".into());
    }
    let profile = host.profile.clone();
    let grant = profile.join(format!(
        "mcp-{}.json",
        agai_protocol::hash(root.to_string_lossy().as_bytes())
    ));
    let host = host.inner().clone();
    let hello = tauri::async_runtime::spawn_blocking(move || {
        host.request(&ReadEnvelope {
            meta: RequestMeta {
                schema_version: 1,
                request_id: uuid::Uuid::new_v4(),
                idempotency_key: None,
            },
            request: ReadRequest::Hello {},
        })
    })
    .await
    .map_err(|_| "HOST_OFFLINE")?
    .map_err(|e| e.code)?;
    Ok(
        json!({"config":{"mcpServers":{"awesomegitai":{"command":binary,"args":["--profile",profile,"--repo",root,"--grant-file",grant]}}},"host":hello,"guide":"Before edits call integration_guide (schema_version:1), then context_get for selected paths and session_open using its generation. After edits call context_get, snapshot_capture, decision_record and evidence_record. Preserve exact snapshot/comparison anchors and agent_reported provenance. Close the session with unresolved items. Do not invent alternatives, test results or human acceptance.","http":"Optional loopback HTTP: use --http PORT --http-token-file PRIVATE_FILE with a separate 0600 token file containing at least 32 random bytes in hex. See crates/mcp/README.md. HTTP is off by default."}),
    )
}
