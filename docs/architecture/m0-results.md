# T0 — local checkpoint, 2026-10-30

User explicitly deferred Android and authorized continuing on macOS. Windows/iOS also deferred. This is a provisional desktop go, not completion of the original cross-platform gate.

Verified: React/CM6 C#/TypeScript/Python, readonly state, byte-based 2 MiB guard (4 tests RED→GREEN), Vite build, macOS debug .app launch and native hello returning schemaVersion 1 + Git 2.46.2. Browser smoke: split diff, explanation, Python/unified selection, large-file guard. Native artifact initially tested at 0.0.0; source moved to 0.0.1 for Android packaging.

Fixture generator independently counted 10,000 tracked files, 100,000 commits and 1,000 changed files. First 200 Git log entries: 7.44/7.21/6.87 ms. Not UI graph timings or controlled cold-cache results.

Rust Android arm64 library compiled; APK completion/install not verified. Original gate items still open: secure-store, HTTPS/SSE reconnect/lifecycle, physical Android, full accessibility, graph/RAM measurements. These remain release gates; backend work may continue provisionally per user instruction. If the mobile stack later changes, the transport-independent backend should remain reusable.
