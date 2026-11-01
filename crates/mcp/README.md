# MCP gateway (macOS / Unix T4)

`agai-mcp` uses the official Rust MCP SDK (`rmcp` 3.8.0). Launch a gateway with an explicit repository and private host profile. On macOS it starts the sibling `agai-host` executable automatically when needed; the desktop app may be closed:

```sh
agai-mcp --profile /absolute/private/profile --repo /absolute/repository \
  --grant-file /absolute/private/profile/mcp-grant.json
```

This is stdio mode; stdout is exclusively MCP JSON-RPC. The gateway opens the repository and requests a repository/worktree scoped agent grant through `profile/host.sock`. The grant is stored as a UID-owned mode-0600 JSON file outside the repository. Existing grants are reused only for the same scope; the host remains responsible for revocation. Delete an obsolete grant file explicitly before creating a replacement. The gateway connects to one shared host per profile, without direct database access or arbitrary desktop/Git operations. Startup is serialized using a private lock; the host retains its own exclusive profile lock. No executable is resolved from PATH. The host runs independently of the gateway and GUI, with disconnected standard streams. Closing either client leaves it running. The next connection restarts a missing host using the existing grants and history. This installs no login service and enables no network listener.

After upgrading, reconnect existing MCP clients once to load the new gateway. `HOST_START_FAILED`, `HOST_START_TIMEOUT` and `UNSAFE_PROFILE` distinguish startup failures. A failure after sending a request can still report `HOST_OFFLINE`; that request is never replayed automatically. The host stays resident until process termination, logout or reboot; a subsequent MCP/GUI connection starts it again. Existing healthy hosts are reused; replacing a running host binary requires a deliberate service restart.

## Opt-in loopback Streamable HTTP

Create a **separate** private file containing at least 32 cryptographically random bytes encoded as hexadecimal (64 hex characters). For example, in an already private profile directory:

```sh
(umask 077; openssl rand -hex 32 > /absolute/private/profile/mcp-http.token)
agai-mcp --profile /absolute/private/profile --repo /absolute/repository \
  --grant-file /absolute/private/profile/mcp-grant.json \
  --http 8765 --http-token-file /absolute/private/profile/mcp-http.token
```

Configure the client endpoint `http://127.0.0.1:8765/mcp` and `Authorization: Bearer <file contents>` using the client's secret storage. Do not put the token in URLs, logs, repository files or shared configuration. HTTP is disabled without `--http`; there is no public-listen option. Every request requires the bearer token. Host and optional Origin must exactly identify localhost/127.0.0.1 and the configured port. Missing Origin is allowed for non-browser clients; foreign origins, including `null`, are denied. HTTP tokens are scoped by their gateway's single host grant and are unrelated to future mobile pairing tokens. Restart the gateway to rotate its HTTP token.

## Discovery and contract

Eleven implemented tools: `integration_guide`, `context_get`, `session_open`, `snapshot_capture`, `decision_record`, `event_append`, `evidence_record`, `decision_supersede`, `session_close`, `trace_record`, `diagram_record`. Every tool is backed by the host. Start with `integration_guide` and `{ "schema_version": 1 }`; resources (`agai://integration-guide/v1`) and the `integration_guide` prompt duplicate the same host guide.

Tool schemas are embedded from `contracts/mcp/v1/tool-inputs.schema.json`, expanded to self-contained schemas and validated including UUID formats before contacting the host. There are 4-MiB limits for incoming transport messages, tool inputs and tool results, a 16-MiB host frame limit and a 30-second host RPC timeout. The gateway does not retry mutations; use the same idempotency key to resolve an uncertain acknowledgement. Transport cancellation is not a rollback of a host transaction.

## Verification boundary

Build the actual host before running the executable acceptance fixtures:

```sh
scripts/cargo-local.sh build -p agai-host -p agai-mcp
scripts/cargo-local.sh test -p agai-mcp
python3 crates/mcp/tests/harness/raw_client.py
```

`cargo test -p agai-mcp` exercises both executable transports with the official SDK client, once against a small test-only Unix host for focused security checks and once against the actual host/domain/database for the full context → session → edit → capture → decision → evidence → supersede → close workflow. The real-host test defaults to `target/debug/agai-host`; `AGAI_HOST_BIN` overrides this path.

The independent Python harness implements raw JSON-RPC without the Rust SDK and repeats the full workflow over **both** stdio and Streamable HTTP. It also reads both durable decision versions through `GetDecisions`, verifies evidence, and exercises the separate local-user review route. Its defaults are `target/debug/agai-host` and `target/debug/agai-mcp`; `AGAI_HOST_BIN` and `AGAI_MCP_BIN` override them. All repositories, databases and tokens are temporary; summaries never contain credentials. The local-user review in this fixture is automated route verification, not a real person's acceptance of code.

These two recorded substitute harnesses do not establish Rider/Cursor product acceptance, installed macOS integration or Windows support. The gateway currently uses Unix sockets and Unix file permissions; Windows transport/security is future work.
