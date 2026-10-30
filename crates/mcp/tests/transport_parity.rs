use rmcp::{
    ServiceExt,
    model::*,
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn fake_host(dir: &std::path::Path) -> tokio::task::JoinHandle<()> {
    let listener = tokio::net::UnixListener::bind(dir.join("host.sock")).unwrap();
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let size = socket.read_u32().await.unwrap();
                let mut bytes = vec![0; size as usize];
                socket.read_exact(&mut bytes).await.unwrap();
                let req: Value = serde_json::from_slice(&bytes).unwrap();
                let scope = json!({"repo_id":"00000000-0000-4000-8000-000000000001","worktree_id":"00000000-0000-4000-8000-000000000002","generation":"g1"});
                let result = if req["desktop"]["kind"] == "OpenRepository" {
                    json!({"Ok":{"kind":"Repository","state":scope}})
                } else if req["desktop"]["kind"] == "CreateAgentGrant" {
                    json!({"Ok":{"kind":"AgentGrant","token":"private-host-grant","repo_id":scope["repo_id"],"worktree_id":scope["worktree_id"]}})
                } else {
                    assert_eq!(req["agent"]["token"], "private-host-grant");
                    json!({"Ok":{"tool":req["agent"]["tool"],"scope":scope,"guide":"Use schema_version 1; session_open then snapshot_capture."}})
                };
                let bytes = serde_json::to_vec(&result).unwrap();
                socket.write_u32(bytes.len() as u32).await.unwrap();
                socket.write_all(&bytes).await.unwrap();
            });
        }
    })
}
fn command(
    profile: &std::path::Path,
    repo: &std::path::Path,
    grant: &str,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_agai-mcp"));
    cmd.args([
        "--profile",
        profile.to_str().unwrap(),
        "--repo",
        repo.to_str().unwrap(),
        "--grant-file",
        profile.join(grant).to_str().unwrap(),
    ]);
    cmd
}
async fn exercise(client: &rmcp::service::RunningService<rmcp::RoleClient, ()>) -> Value {
    let tools = client.list_all_tools().await.unwrap();
    assert_eq!(tools.len(), 11);
    assert!(tools.iter().all(|t| {
        !serde_json::to_string(&t.input_schema)
            .unwrap()
            .contains("$ref")
    }));
    let call = |args| CallToolRequestParams::new("integration_guide").with_arguments(args);
    assert!(
        client
            .call_tool(call(
                json!({"schema_version":2}).as_object().unwrap().clone()
            ))
            .await
            .is_err()
    );
    assert!(
        client
            .call_tool(CallToolRequestParams::new("trace_record"))
            .await
            .is_err()
    );
    let result = client
        .call_tool(call(
            json!({"schema_version":1}).as_object().unwrap().clone(),
        ))
        .await
        .unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert!(!result.to_string().contains("private-host-grant"));
    assert_eq!(client.list_all_resources().await.unwrap().len(), 1);
    assert_eq!(client.list_all_prompts().await.unwrap().len(), 1);
    let resource = client
        .read_resource(ReadResourceRequestParams::new(
            "agai://integration-guide/v1",
        ))
        .await
        .unwrap();
    assert!(
        serde_json::to_string(&resource)
            .unwrap()
            .contains("Use schema_version 1")
    );
    let prompt = client
        .get_prompt(GetPromptRequestParams::new("integration_guide"))
        .await
        .unwrap();
    assert!(
        serde_json::to_string(&prompt)
            .unwrap()
            .contains("Use schema_version 1")
    );
    result
}
#[tokio::test]
async fn actual_sdk_stdio_and_http_have_same_tools_results_and_security() {
    let profile = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let host = fake_host(profile.path()).await;
    let stdio =
        ().serve(
            TokioChildProcess::new(command(profile.path(), repo.path(), "stdio-grant")).unwrap(),
        )
        .await
        .unwrap();
    let expected = exercise(&stdio).await;
    stdio.cancel().await.unwrap();
    let reserve = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = reserve.local_addr().unwrap().port();
    drop(reserve);
    let token = "b".repeat(64);
    let token_file = profile.path().join("http-token");
    agai_mcp::write_secret(&token_file, token.as_bytes()).unwrap();
    let mut cmd = command(profile.path(), repo.path(), "http-grant");
    cmd.args([
        "--http",
        &port.to_string(),
        "--http-token-file",
        token_file.to_str().unwrap(),
    ]);
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().unwrap();
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let url = format!("http://127.0.0.1:{port}/mcp");
    let http = reqwest::Client::new();
    assert_eq!(http.post(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        http.post(&url)
            .bearer_auth(&token)
            .header("Origin", "https://evil.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.post(&url)
            .bearer_auth(&token)
            .header("Host", "evil.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        http.post(&url)
            .bearer_auth(&token)
            .header("MCP-Protocol-Version", "2099-01-01")
            .header("Accept", "application/json, text/event-stream")
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let transport = StreamableHttpClientTransport::from_config(
        StreamableHttpClientTransportConfig::with_uri(url).auth_header(token),
    );
    let client = ().serve(transport).await.unwrap();
    assert_eq!(exercise(&client).await, expected);
    client.cancel().await.unwrap();
    child.kill().await.unwrap();
    host.abort();
}
