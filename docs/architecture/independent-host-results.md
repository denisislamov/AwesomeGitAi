# Independent local host — macOS, 2026-11-02

MCP and the desktop share `agai-host-launch`. Before sending any request they connect to the private profile socket; if absent, startup is serialized with an owner-only lock and the packaged sibling host is launched in a separate process session with null stdio. Host lifetime locking remains authoritative. Startup is bounded and returns sanitized errors. Unsafe profiles and symlink locks/sockets are rejected. No PATH resolution, launchd installation, database access from the gateway or new networking is introduced.

The GUI no longer owns/kills the service. Quit still sends GitShutdown to cancel outstanding desktop Git jobs, once, then closes the client. MCP tools/grants and history retain their existing scopes. If a request's response is lost after sending, it fails without automatic replay; only a later connection may restart a missing host.

## Verification

- Real executable fixture: cold MCP startup; service survives MCP exit; four clients reuse it; kill only the disposable fixture host; four simultaneous calls launch exactly one replacement; original grant bytes unchanged.
- Socket fixtures: existing service reuse without a binary; stale socket startup error; unsafe profile/symlink rejection; sent request with lost response is not replayed.
- Native regression: GUI shutdown requests Git cancellation and leaves the shared listener usable; shutdown is idempotent.
- UI133, native13, types/contracts passed. Three browser scenarios passed: session restore, Git operation/docking and real MCP explanation flow.
- Full Rust workspace regression passed. Initial runs exposed sandbox socket restrictions, then fixture directories that needed explicit mode0700; corrected the fixtures without relaxing production validation.
- Packaged macOS acceptance: old GUI/owned host exited. With no GUI process, the configured MCP executable started a host and successfully read integration_guide and the original EFT snapshot for all three stance files. Service survived probe exit. New GUI restored EFT/tabs using that same host. After Cmd+Q the GUI was absent, the same host PID remained, and guide/context reads succeeded again. No EFT explanation writes, session creation, credential replacement or Git mutations were performed.

## Operational limits

Reconnect existing MCP processes once after this upgrade; an already running executable cannot acquire the new startup behavior. The service is on-demand and resident, not a boot service or a watchdog. OS/process failure during an in-flight request can still fail that request; callers must resolve uncertain writes using the existing idempotency protocol. Automated recovery testing kills only disposable test hosts. macOS accepted; other platforms and T8 remain out of scope. No push.
