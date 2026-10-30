# T7a — sibling Git history repository

Approved 2026-10-30: keep history outside the code repository, migrate existing data without loss, macOS only, compact English UI, tests/regression/local commits. T8 is deferred until explicit user authorization.

## Design

Each worktree uses a sibling `<folder>.history` Git repository. Chosen implementation: a private bare repository containing a versioned `state.json` containing the original scoped table rows, with no working checkout. This keeps incidental files out of code Git and avoids executing hooks/filters or tracking SQLite binaries. `git --git-dir=<folder>.history log/show` exposes its history. A root manifest stores schema and stable repo/worktree IDs. Moving both folders together preserves identity. Alternative considered: tracked JSON checkout (easier manual editing, adds dirty-index/merge risks); SQLite-only backups (do not provide independently navigable Git history).

SQLite remains the local read index and durable pending-write journal. Migration commits all scoped documents (including superseded revisions retained by the app), events, snapshots, comparisons, bundle receipts/tombstones and relevant operation receipts. Agent credential grants are local-only and never restored from history. Legacy unscoped T0 data stays in the original database. Existing SQLite rows are never deleted by migration. Every completed desktop/MCP action checkpoints changes; unchanged reads make no commits. A failed checkpoint reports an error, retains pending data and retries on subsequent access. Base/current-DB/Git hashes detect divergence rather than overwrite either copy. An externally advanced history against a nonempty index is reported as a conflict; automatic recovery targets an empty scope. Recovery into an empty scope rebuilds the index transactionally and checks identity and row collisions.

History commits are local, independent of code branches; no remote or push is configured. This is private unredacted local storage (unlike sanitized T7 sharing bundles), directory permissions 0700. No arbitrary existing directory or repository is adopted; symlinks, unexpected format/refs, nested parent Git worktrees and unrecognized ownership are rejected. An unwritable sibling path reports an actionable error, never silently puts history inside code Git.

Whole-scope erase also replaces the history with a new root containing tombstones, drops old local history objects and verifies cleanup; it must not claim success if Git cleanup fails. Exported/copied/remote/OS copies remain outside erasure. The UI warning must explicitly explain history destruction.

## Acceptance

Round-trip all durable scope tables byte-for-byte; preserve IDs/provenance, snapshots and references; keep other scopes, code index/HEAD/working files unchanged. Test retry and crash windows, corrupted data, scope collision, moved folders, denied sibling paths and no restored grants. Verify native memory → new record → Git commit → restart, existing context migration and index recovery; run affected Rust, contracts, UI/native/browser regressions. No T8 work.
