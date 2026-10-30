//! Requires `cargo build -p agai-host -p agai-mcp` first (or AGAI_HOST_BIN).
//! This independent SDK client exercises the real host database and domain engine.
use rmcp::{
    ServiceExt,
    model::CallToolRequestParams,
    service::{RoleClient, RunningService},
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use std::path::Path;
use tokio::process::{Child, Command};
type Client = RunningService<RoleClient, ()>;
async fn tool(client: &Client, name: &str, mut args: Value, write: bool) -> Value {
    args["schema_version"] = json!(1);
    if write {
        args["request_id"] = json!(uuid::Uuid::new_v4().to_string());
        args["idempotency_key"] = json!(uuid::Uuid::new_v4().to_string());
    }
    let result = client
        .call_tool(
            CallToolRequestParams::new(name.to_string())
                .with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_ne!(result["isError"], true);
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}
async fn workflow(client: &Client, repo: &Path, bytes: &str) {
    let list = client.list_all_tools().await.unwrap();
    assert_eq!(list.len(), 9);
    let guide = tool(client, "integration_guide", json!({}), false).await;
    let context = json!({"repo_id":guide["repo_id"],"worktree_id":guide["worktree_id"],"task":"SDK exact source scenario","paths":["a.cs"],"budget_chars":2000});
    let before = tool(client, "context_get", context.clone(), false).await;
    let session=tool(client,"session_open",json!({"repo_id":guide["repo_id"],"worktree_id":guide["worktree_id"],"task":"SDK exact source scenario","actor":"rmcp SDK harness","expected_generation":before["generation"]}),true).await;
    std::fs::write(repo.join("a.cs"), bytes).unwrap();
    let current = tool(client, "context_get", context.clone(), false).await;
    let captured=tool(client,"snapshot_capture",json!({"session_id":session["session_id"],"paths":["a.cs"],"expected_generation":current["generation"]}),true).await;
    // Ask the system sha256 implementation to independently compute the anchor hash.
    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(repo.join("a.cs"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let hash = String::from_utf8(output.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
    let decision = json!({"session_id":session["session_id"],"snapshot_id":captured["snapshot_id"],"summary":"SDK anchored decision","behavior":"fixture text changed","rationale":"requested edit","constraints":[],"alternatives":[],"source":"agent_reported","anchors":[{"comparison_id":captured["comparison"]["id"],"snapshot_id":captured["snapshot_id"],"path":"a.cs","side":"new","start_line":1,"end_line":1,"content_hash":hash}]});
    let receipt = tool(
        client,
        "decision_record",
        json!({"decision":decision}),
        true,
    )
    .await;
    let evidence=tool(client,"evidence_record",json!({"session_id":session["session_id"],"snapshot_id":captured["snapshot_id"],"decision_ids":[receipt["decision_id"]],"check":"SDK check","status":"passed","environment":"macOS local fixture","summary":"agent reported; not trusted runner","source":"agent_reported"}),true).await;
    assert_eq!(evidence["source"], "agent_reported");
    let revised_bytes = format!("revised {bytes}");
    std::fs::write(repo.join("a.cs"), &revised_bytes).unwrap();
    let current = tool(client, "context_get", context, false).await;
    let captured=tool(client,"snapshot_capture",json!({"session_id":session["session_id"],"paths":["a.cs"],"expected_generation":current["generation"]}),true).await;
    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(repo.join("a.cs"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let hash = String::from_utf8(output.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
    let mut decision = decision;
    decision["snapshot_id"] = captured["snapshot_id"].clone();
    decision["anchors"][0]["snapshot_id"] = captured["snapshot_id"].clone();
    decision["anchors"][0]["comparison_id"] = captured["comparison"]["id"].clone();
    decision["anchors"][0]["content_hash"] = json!(hash);
    let newer=tool(client,"decision_supersede",json!({"old_decision_id":receipt["decision_id"],"expected_revision":1,"reason":"clarification","new_decision":decision}),true).await;
    assert_ne!(receipt["decision_id"], newer["decision_id"]);
    let closed=tool(client,"session_close",json!({"session_id":session["session_id"],"final_snapshot_id":captured["snapshot_id"],"outcome":"completed","summary":"SDK scenario complete","unresolved":[]}),true).await;
    assert_eq!(closed["outcome"], "completed");
    assert_eq!(closed["warnings"], json!([]));
    assert_eq!(
        std::fs::read_to_string(repo.join("a.cs")).unwrap(),
        revised_bytes
    );
}
fn gateway(profile: &Path, repo: &Path, grant: &str) -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_agai-mcp"));
    c.kill_on_drop(true).args([
        "--profile",
        profile.to_str().unwrap(),
        "--repo",
        repo.to_str().unwrap(),
        "--grant-file",
        profile.join(grant).to_str().unwrap(),
    ]);
    c
}
async fn wait_host(profile: &Path, host: &mut Child) {
    for _ in 0..200 {
        if profile.join("host.sock").exists() {
            return;
        }
        assert!(host.try_wait().unwrap().is_none(), "host exited");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("host startup timed out")
}
#[tokio::test]
async fn sdk_both_transports_persist_real_decision_workflows() {
    let repo = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(profile.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(repo.path())
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(repo.path().join("a.cs"), "baseline human change\n").unwrap();
    let host_bin = std::env::var_os("AGAI_HOST_BIN")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/agai-host")
        });
    assert!(
        host_bin.is_file(),
        "build agai-host first or set AGAI_HOST_BIN"
    );
    let mut command = Command::new(host_bin);
    command.arg(profile.path()).kill_on_drop(true);
    let mut host = command.spawn().unwrap();
    wait_host(profile.path(), &mut host).await;
    let client =
        ().serve(
            TokioChildProcess::new(gateway(profile.path(), repo.path(), "stdio-grant")).unwrap(),
        )
        .await
        .unwrap();
    workflow(&client, repo.path(), "stdio SDK changed\n").await;
    client.cancel().await.unwrap();
    let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = reserved.local_addr().unwrap().port();
    drop(reserved);
    let host_grant: Value =
        serde_json::from_slice(&std::fs::read(profile.path().join("stdio-grant")).unwrap())
            .unwrap();
    let reused_file = profile.path().join("reused-http-token");
    agai_mcp::write_secret(
        &reused_file,
        host_grant["token"].as_str().unwrap().as_bytes(),
    )
    .unwrap();
    let mut reused = gateway(profile.path(), repo.path(), "stdio-grant");
    reused.args([
        "--http",
        &port.to_string(),
        "--http-token-file",
        reused_file.to_str().unwrap(),
    ]);
    let rejected = tokio::time::timeout(std::time::Duration::from_secs(2), reused.output())
        .await
        .expect("reused host grant must not start HTTP")
        .unwrap();
    assert!(!rejected.status.success());
    assert_eq!(
        String::from_utf8(rejected.stderr).unwrap().trim(),
        "agai-mcp: SEPARATE_HTTP_TOKEN_REQUIRED"
    );
    let token_file = profile.path().join("http-token");
    let token = "c".repeat(64);
    agai_mcp::write_secret(&token_file, token.as_bytes()).unwrap();
    let mut command = gateway(profile.path(), repo.path(), "http-grant");
    command.args([
        "--http",
        &port.to_string(),
        "--http-token-file",
        token_file.to_str().unwrap(),
    ]);
    let mut http = command.spawn().unwrap();
    for _ in 0..200 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            break;
        }
        assert!(http.try_wait().unwrap().is_none(), "gateway exited");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let transport = StreamableHttpClientTransport::from_config(
        StreamableHttpClientTransportConfig::with_uri(format!("http://127.0.0.1:{port}/mcp"))
            .auth_header(token),
    );
    let client = ().serve(transport).await.unwrap();
    workflow(&client, repo.path(), "HTTP SDK changed\n").await;
    client.cancel().await.unwrap();
    http.kill().await.unwrap();
    host.kill().await.unwrap();
}
