# T7 — project memory and portable context

2026-10-30. Implemented and tested on macOS. Compact English interface via View → Project Memory; no permanent toolbar or new top-level workspace mode.

## Delivered

Search retained decisions (including superseded records), events and external context within the current repository/worktree. Filter actor, task, snapshot and path; source filtering applies to loaded results. MCP context includes relevant rationale, alternatives, constraints, anchors and unresolved questions, with bounded output and explicit external provenance.

Export explicitly selected records and optional snapshots to a versioned ZIP. No snapshots are selected by default. Preview counts, source text and exclusions before writing. Import validates hashes, paths, schema, decompression limits and mapping, displays a preview and requires explicit mapping when Git content cannot be matched. Imported records remain external source material, never local human acceptance or trusted instructions. Repeated import is idempotent; two-hop export/import preserves useful context. Git files and refs are not modified. Export rejects Git metadata destinations, including symlink aliases, and never overwrites an existing file.

Erase requires the exact typed confirmation and removes the current repository/worktree's complete stored context, grants, derived records and indices. SQLite secure deletion, checkpoint/VACUUM, owned-backup cleanup and tombstones prevent ordinary local recovery/import resurrection. Other scopes remain intact. UI caches clear even after partial failure or dialog closure. Search index rebuilding is available.

## Verification

Full regression: 130 Rust test invocations, four editor probes, 90 client tests and eight native tests passed; contracts, typecheck and macOS bundle build passed (384.94 MiB). Browser run passed 13 existing functional scenarios; the new memory scenario initially failed due to two identically named fixture records. After selecting the newest seeded record, its focused rerun passed, covering preview/export/import/reload. The 100k-history benchmark was skipped this turn; it previously passed at T3a.

One fresh independent review was completed. Important findings reproduced and corrected: snapshot display-path spoofing, export into Git metadata, erase/cache races, nested imported-record context loss, and oversized IPC responses. Additional regression caught ordinary source comments being mistaken for absolute paths. Evidence is in ignored `.superpowers/t7-*` logs.

Native packaged-app acceptance used the disposable repository `/private/tmp/agai-t7-native-k3xfy67l`, seeded through real MCP. View → Project Memory showed the local English decision. Export preview showed one record, one snapshot and two files; the source preview displayed Balance 75. Export to `/private/tmp/agai-t7-native-context.zip` succeeded. Import preview correctly reported unmatched worktree content and required mapping; import produced external context. Cmd+Q and relaunch retained both Local and External decisions. HEAD remained `9ca465a17861648abbf8f8a4018d64a43ad4b028`; the existing Code.cs working change remained unchanged. Native erase warning and disabled confirmation button were checked without deleting data through the UI; actual deletion and failure handling are covered by automated fixture tests. Local-only operation was exercised, but OS networking was not disabled; physical network-disconnection acceptance remains unrun.

## Explicit limits and follow-ups

- ZIP caps: 32 MiB compressed/decompressed aggregate, 16 MiB entry, fixed 2 MiB text file, 258 entries, 1000 records, 256 snapshots. Catalog lists at most 1000 metadata rows with totals/truncation; memory responses are bounded to 8 MiB.
- Privacy exclusions are conservative, not a guarantee of detecting every secret. Users must review previews before sharing. Imported HTML/source remains inert.
- Erase is whole-scope, not per-record redaction. It cannot erase separately exported copies, OS snapshots, SSD remnants or external process memory. Legacy unscoped T0 entries cannot safely be attributed to one scope and are outside this operation.
- Deferred review minor: duplicate `(kind, source_id)` pairs inside a single bundle are accepted and can make source-session inheritance ambiguous.
- Deferred review minor: memory search scans/deserializes the scope and resolves sessions per record. Pagination bounds output, not computation; it uses literal JSON substring matching rather than FTS. Large-history search optimization remains follow-up work.
- No Android, remote-host, physical offline-network or new detached Memory-window acceptance is claimed. Existing detached-panel behavior remains in regression coverage. T8 has not started. No push or merge.
