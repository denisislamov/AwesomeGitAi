# Editorial revisions after session closure — 2026-10-31

`decision_supersede` now permits narrative improvements after the owning session is closed. It retains the same grant/repository/worktree/session checks, exact snapshot/anchor validation, expected revision and idempotency checks as an open-session revision. For closed sessions, the snapshot ID and entire anchor array must match the previous decision. Changed source bindings return `CLOSED_SESSION_SOURCE_CHANGE`.

The existing atomic transaction updates the old decision's successor link and appends the new decision with predecessor/reason. Old narrative content remains available. The closed session, final snapshot, outcome and summary are not modified. New decisions, captures, events, evidence, traces and diagrams remain blocked in a closed session. Evidence and human acceptance remain attached to their original decision IDs.

`context_get` now exposes source revision metadata so an agent can obtain the optimistic concurrency value instead of guessing. The shared explanation policy, guide workflow and MCP tool description explain the post-close path. No schema migration, ownership expansion, source changes or new UI controls are required.

Tests first reproduced SESSION_CLOSED and missing context revision. Regression covers two successive post-close revisions, preserved old text and links, unchanged closed session and source file, exact retries, stale revisions, foreign grants, forbidden source rebinding and blocked new writes. The real MCP SDK workflow performs a post-close revision over both stdio and loopback HTTP. Final validation results are recorded in the implementation progress log.
