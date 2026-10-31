# Editorial revisions after session closure — 2026-10-31

`decision_supersede` now permits narrative improvements after the owning session is closed. It retains the same grant/repository/worktree/session checks, exact snapshot/anchor validation, expected revision and idempotency checks as an open-session revision. For closed sessions, the snapshot ID and entire anchor array must match the previous decision. Changed source bindings return `CLOSED_SESSION_SOURCE_CHANGE`.

The existing atomic transaction updates the old decision's successor link and appends the new decision with predecessor/reason. Old narrative content remains available. The closed session, final snapshot, outcome and summary are not modified. New decisions, captures, events, evidence, traces and diagrams remain blocked in a closed session. Evidence and human acceptance remain attached to their original decision IDs.

`context_get` now exposes source revision metadata so an agent can obtain the optimistic concurrency value instead of guessing. The shared explanation policy, guide workflow and MCP tool description explain the post-close path. No schema migration, ownership expansion, source changes or new UI controls are required.

Tests first reproduced SESSION_CLOSED and missing context revision. Regression covers two successive post-close revisions, preserved old text and links, unchanged closed session and source file, exact retries, stale revisions, foreign grants, forbidden source rebinding and blocked new writes. The real MCP SDK workflow performs a post-close revision over both stdio and loopback HTTP. Final validation results are recorded in the implementation progress log.

## Historical context subset fix — 2026-11-01

An EFT agent reported SCOPE_DENIED while reading a saved snapshot after reconnect. Read-only inspection confirmed that the active grant owned both the session and snapshot. The actual cause was an exact-path-set check: the snapshot contained seven files, while the request selected only CharacterStanceSimulation.cs. The full seven-path request succeeded without changing credentials.

Pinned context now accepts a nonempty subset of the owned snapshot's captured paths and returns only those source files/exclusions, alongside relevant saved memory records. An uncaptured path returns SNAPSHOT_PATH_OUT_OF_SCOPE; foreign ownership still returns SCOPE_DENIED. Historical reads do not overwrite the live baseline for session_open and explicitly return session_baseline=false. Fresh unpinned context remains the way to prepare an editing session. Snapshot storage and ownership are unchanged.

A failing domain test reproduced the one-file denial, then passed with checks for source filtering, unchanged live baseline and rejected foreign/uncaptured access. The real SDK workflow now captures two files and reads only one after closing/revising the explanation over both MCP transports. After rebuilding/restarting the macOS service, the actual one-file EFT request returned snapshot 009d00c9 and decision 14cf3d04 at revision 1 with both original anchors and no truncation. No explanation, grant or credential was changed. Logs: `.superpowers/pinned-subset-{red,domain,regression,build}.log`.
