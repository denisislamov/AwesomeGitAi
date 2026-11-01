# Independent local host

User-approved scope: macOS MCP launches the host on demand and works with the GUI closed. One shared profile/socket, existing grants/history unchanged, no launchd/login service or network listener. Host survives client exits and restarts on the next connection after failure. Never replay a request once sent. Preserve GUI Git-operation cancellation on exit without killing the service. Old running clients need reconnection to load the new binary.

Implementation: shared private-profile launcher with serialized startup, existing host lifetime lock, sibling packaged executable, detached stdio/session; MCP connects through launcher at bootstrap and every request; GUI uses same connector and no longer owns the host process.

Verification: launcher profile/reuse/stale socket tests; real process MCP cold start, client exit survival, concurrent startup, restart with original grant; GUI shutdown regression; Rust/UI/types/contracts and rebuilt macOS acceptance with Cmd+Q. Local commit, no push. T8 unchanged.

Completed: shared launcher, MCP per-connection recovery, independent GUI lifecycle, real concurrent process recovery and no-replay tests, full Rust/UI/native/browser regressions and macOS packaged acceptance. [Results](../../architecture/independent-host-results.md). Existing client processes require one reconnect. No live explanation or credential writes.
