# Observed versions

macOS arm64; Node 24.7.0; pnpm 9.15.4; Rust 1.99.1; Git 2.46.2; React 19.3.1; Vite 8.3.5; Tauri CLI 2.12.4; Tauri crate 2.12.5. Exact resolved dependencies: platform-probe/pnpm-lock.yaml and src-tauri/Cargo.lock.

Commands and limitations: see spikes/platform-probe/README.md and m0-results.md. No tested MCP harness compatibility yet.

## T4 observed compatibility (2026-10-30)

rmcp 3.8.0 server and official Rust SDK client, plus independently implemented raw Python JSON-RPC client: real-host workflow passes over stdio and loopback Streamable HTTP (protocol 2025-11-25 in raw harness). Tools-only discovery and resource/prompt discovery are tested. Packaged macOS MCP stdio → native explanation/review verified. Rider AI Assistant/Cursor product versions are not yet certified. See [T4 evidence](t4-results.md).
