# T7 — memory, portable context and stored-data management

Approved MVP T7 / MEMORY01–03 / A15. macOS only, compact English UI, local commits, no push.

- [x] Scoped paginated memory across retained local and imported decisions, source/actor/task/snapshot/path filters and rebuildable search. Tests for supersession, scope and filters.
- [x] Versioned bounded ZIP with explicit record/snapshot selection, preview exclusions and content hashes. Host validates import preview, explicit repository mapping, collisions/retries and provenance. Never change Git files/refs or grant imported claims local acceptance.
- [x] Explicit whole-scope data erasure with tombstone, secure SQLite cleanup and owned-backup handling. Tests preserve unrelated scopes and remove sensitive derived data.
- [x] Compact Memory dialog reachable through native View menu, with on-demand export/import/erase forms. No permanent toolbar. Offline reads and detached-window command routing preserved.
- [x] Integrate host/protocol/UI, one fresh independent review; backend/UI/native/contracts/browser regression, actual macOS export/import/restart checks, commits.

Ownership: t7_bundle owns domain archive codec/tests; t7_memory owns memory/storage/import/redaction/tests; root owns host/protocol/UI and native acceptance. Existing branch retained to preserve completed work.

Rulings: deletion selects the current repository/worktree's complete stored context, explicitly confirmed, rather than pretending arbitrary partial redaction can leave no copies. Export uses explicit user-selected records and snapshots; no text snapshots selected by default. Imported context remains separately marked external source material, never trusted instructions or local review. T6a native acceptance includes fixing the discovered undefined dialog background token before closure.

Acceptance evidence and bounded deviations: [T7 results](../../architecture/t7-results.md). Physical network-disconnection acceptance remains unrun; native erase was checked up to confirmation, with deletion covered by automated fixtures.
