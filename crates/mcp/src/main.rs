use agai_mcp::{
    gateway::{Gateway, LIMIT},
    read_http_token,
};
use axum::{
    Router,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
};
use rmcp::{
    ServiceExt,
    transport::{
        StreamableHttpService,
        async_rw::AsyncRwTransport,
        streamable_http_server::{StreamableHttpServerConfig, session::local::LocalSessionManager},
    },
};
use std::{path::PathBuf, sync::Arc};
async fn auth(
    State(token): State<Arc<String>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let provided = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");
    let mismatch = provided
        .as_bytes()
        .iter()
        .zip(token.as_bytes())
        .fold(0u8, |a, (x, y)| a | (x ^ y));
    if provided.len() != token.len() || mismatch != 0 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(request).await)
}
async fn run() -> Result<(), String> {
    let mut profile = None;
    let mut repo = None;
    let mut grant = None;
    let mut http = None;
    let mut http_token = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().ok_or("INVALID_ARGUMENTS")?;
        match arg.as_str() {
            "--profile" => profile = Some(PathBuf::from(value)),
            "--repo" => repo = Some(PathBuf::from(value)),
            "--grant-file" => grant = Some(PathBuf::from(value)),
            "--http" => http = Some(value.parse::<u16>().map_err(|_| "INVALID_PORT")?),
            "--http-token-file" => http_token = Some(PathBuf::from(value)),
            _ => return Err("INVALID_ARGUMENTS".into()),
        }
    }
    let profile = profile.ok_or("PROFILE_REQUIRED")?;
    let repo = repo.ok_or("REPOSITORY_REQUIRED")?;
    let grant = grant.unwrap_or_else(|| profile.join("mcp-grant.json"));
    let gateway = Gateway::bootstrap(&profile, &repo, &grant)
        .await
        .map_err(|e| e.message.to_string())?;
    if let Some(port) = http {
        if port == 0 {
            return Err("INVALID_PORT".into());
        }
        let token_file = http_token.ok_or("HTTP_TOKEN_FILE_REQUIRED")?;
        if token_file
            .canonicalize()
            .map_err(|_| "INVALID_SECRET_FILE")?
            .starts_with(repo.canonicalize().map_err(|_| "INVALID_REPOSITORY")?)
        {
            return Err("TOKEN_INSIDE_REPOSITORY".into());
        }
        let token = read_http_token(&token_file).map_err(|_| "INVALID_SECRET_FILE")?;
        let gateway = gateway
            .with_http_token(&token)
            .map_err(|e| e.message.to_string())?;
        let mut config = StreamableHttpServerConfig::default()
            .enforce_origin_validation()
            .with_max_request_body_bytes(LIMIT);
        config.allowed_hosts = vec![format!("127.0.0.1:{port}"), format!("localhost:{port}")];
        config.allowed_origins = vec![
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
        ];
        let service = StreamableHttpService::new(
            move || Ok(gateway.clone()),
            Arc::new(LocalSessionManager::default()),
            config,
        );
        let app = Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn_with_state(Arc::new(token), auth));
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|_| "HTTP_BIND_FAILED")?;
        axum::serve(listener, app)
            .await
            .map_err(|_| "HTTP_SERVER_FAILED")?;
    } else {
        if http_token.is_some() {
            return Err("HTTP_DISABLED".into());
        }
        gateway
            .serve(
                AsyncRwTransport::new_server(tokio::io::stdin(), tokio::io::stdout())
                    .with_max_line_length(LIMIT),
            )
            .await
            .map_err(|_| "MCP_INITIALIZATION_FAILED")?
            .waiting()
            .await
            .map_err(|_| "MCP_TRANSPORT_FAILED")?;
    }
    Ok(())
}
#[tokio::main]
async fn main() {
    if let Err(code) = run().await {
        eprintln!("agai-mcp: {code}");
        std::process::exit(1);
    }
}
