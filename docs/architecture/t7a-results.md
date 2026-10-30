# T7a — independent sibling Git history

2026-10-30. macOS implementation and native acceptance complete. T8 remains explicitly deferred.

## Delivered behavior

Opening a worktree creates a private sibling `<folder>.history` bare Git repository, outside code Git. Existing scoped data migrates on first access, without deleting the SQLite source. Git contains structured `state.json`; use `git --git-dir=/path/Project.history log` or `show HEAD:state.json` to inspect it. No remote or push is configured. Code branches/refs/index/files remain separate. The Memory dialog exposes the location in a collapsed **Local Git history** disclosure; UI remains English.

History preserves original JSON strings for documents, snapshots, events, comparisons, bundle import receipts/tombstones and relevant operation receipts. Superseded records already retained by the application remain available. Local agent credential grants never enter Git or recovery. Original local grants remain in SQLite. Legacy unscoped T0 records remain in their original database; there is no safe way to attribute them to one project.

Desktop/MCP actions checkpoint their relevant scope. SQLite is both the read index and durable pending journal: do not discard it after a failed checkpoint. Successful checkpoints are read back and compared before recording the base hash. Empty-scope recovery is transactional, preserves IDs/provenance/bytes and rebuilds derived search. Divergent nonempty SQL/Git copies fail closed rather than silently overwriting data. Moving both folders together retains IDs; a copied identity cannot rebind a different still-existing registered code folder.

Git commands use isolated configuration and fixed arguments; hooks, filters, external helpers, remotes, unexpected refs, alternate objects, symlinks and unrelated existing directories are rejected. Atomic exclusive directory publication prevents half-created visible repositories. Worktree parents that belong to another Git repository are rejected to avoid accidentally tracking the history there. A busy/unwritable sibling fails explicitly and retains SQL data.

Whole-scope erase replaces the local history with a tombstone root and prunes old objects. A durable pending marker retries interrupted cleanup, including the window after the new root commit was written. The existing typed confirmation explicitly warns that all sibling-history commits will be removed. External exports/copies, OS backups and physical storage remnants are outside the guarantee.

## Evidence

Tests observed RED→GREEN for storage round-trip, cross-scope collision rollback, sibling migration/recovery, unsafe paths, relocation, checkpoint retry, erasure, duplicate live identity, unavailable unrelated projects, atomic publication and large-history read performance. A 32 MiB unchanged image initially took 9.74 seconds for a catalog read; the regression now passes its two-second ceiling using DB revision/data-version and Git HEAD cache checks. Changed histories still require full-image processing.

Final automated regression: **144 Rust test invocations, four editor probes, 91 UI tests, eight native tests**. Contracts and TypeScript checks pass. Browser **14 functional scenarios pass**, including MCP explanations/trace, Git staging/commit, docking, usages, language help and memory export/import/reload; the 100k graph benchmark was skipped (previously passed at T3a). Hot cached editor switch measured 18.7 ms. macOS bundle built: 385.62 MiB. Initial test attempts under the sandbox could not bind local sockets; successful integration runs used approved local socket access. An earlier browser run exposed the slow-history path and was stopped; the complete final run passed after the fixes.

Native acceptance used the existing T7 disposable project `/private/tmp/agai-t7-native-k3xfy67l`. Before migration, recorded its scoped SQL rows read-only. The sibling commit preserved all nine non-credential documents, ten snapshots, three events and one bundle receipt exactly; zero tombstones existed. The original local and imported decisions remained visible. A real MCP call recorded **Sibling history survives restart**, creating subsequent history commits. After Cmd+Q/relaunch, that decision was visible in Project Memory. The disclosure path, warning and disabled erase button were visually checked; native data was not erased. A separate empty profile using the packaged macOS host recovered every row in the Git image and zero credential grants. Code HEAD stayed `9ca465a17861648abbf8f8a4018d64a43ad4b028`, with only the pre-existing Code.cs working change.

Evidence: ignored `.superpowers/t7a-*` logs, before-migration comparison, real MCP fixture and packaged recovery script. No push, merge, Android or remote acceptance. Physical power-loss and OS network-disconnection tests were not performed.

## Review and implementation decisions

One fresh independent review found four Important issues, all fixed with reproducing tests: copied live identity rebind, unrelated missing project blocking commands, full archive work on unchanged reads, and non-atomic initialization. No second review was dispatched.

Rulings: retain the existing authorized branch; use bare Git (no editable checkout); store one complete state.json initially (simpler lossless atomic recovery, but larger diffs/writes than per-record files); keep SQLite pending changes until verified Git acknowledgement; report nonempty externally advanced histories as conflicts instead of automatic merge (manual resolution required). Migration is lazy per opened/accessed project, not a background crawl of every registered path.

Deferred review minors: error surfaces still expose technical HISTORY_* codes without path-specific recovery instructions; automatic commit subjects remain generic, so identifying an individual action requires inspecting its JSON diff. Large changed images remain a scaling limit; unchanged reads have a verified fast path. Manually configuring remotes/editing the managed repository is unsupported; use T7 sharing bundles for reviewed portable exports.
