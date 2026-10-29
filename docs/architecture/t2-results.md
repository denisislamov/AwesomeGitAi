# T2: macOS repository reads and immutable snapshots

Completed 2026-10-30 for the user-authorized macOS backend scope. T1 commit: `d76a496`. T0 cross-platform acceptance remains open; production desktop UI is T3, MCP server is T4.

## Delivered

- Git status with raw paths, repository/worktree identities, paginated history with real parent edges and stale-cursor rejection. History rechecks refs after traversal.
- Separate immutable HEAD, index and worktree manifests, including conflict stages. Commit snapshots remain available after refs are rewritten and Git objects garbage-collected.
- Durable comparisons and anchors with Exact, Relocated, Stale, Ambiguous and Missing outcomes. Comparison resolution validates the anchor's original side.
- Host registry, scoped reads, capture preparation and a coalescing watcher with authoritative rescans. Repository registration/capture are internal trusted host APIs; a desktop bridge follows in T3.
- Git subprocess output/deadline/cancellation bounds, process-group cleanup and disabled lazy network fetch. Files are opened relative to directory descriptors without following symlinks.

## Contracts and deliberate implementation choices

`RepoState.generation` describes Git-visible state for watching. Before capture, call `HostService::prepare_capture(repo, worktree, paths)` and pass its selected-path generation to capture. This also fingerprints raw selected bytes when Git hides changes through ignored paths, assume-unchanged or line-ending normalization. Capture uses the observed bytes and revalidates before persistence. External editors are not locked; a completed snapshot describes the captured state, not a promise that the live worktree remains unchanged afterwards.

Partial manifests cannot imply deletion: comparison rejects exclusions or differing selected-path sets with `INCOMPLETE_COMPARISON`. Explicit absent entries represent real absence. Renames are conservatively represented as deletion/addition; inferred rename identity is not claimed. Binary (NUL or invalid UTF8), sensitive and oversized content is explicitly excluded. The 2 MiB per-file bound remains; a 12 MiB serialized snapshot limit rejects oversized captures before persistence, leaving room inside the 16 MiB IPC frame. Chunked snapshot transfer is deferred.

Watching uses a 200 ms rescan interval and a bounded notification channel. It coalesces bursts and retries notification of the latest state after a full queue. This is simpler than platform-specific event recovery, at the cost of repeated Git reads. No Git mutation API is exposed in T2.

Raw invalid-UTF8 paths are covered by protocol and porcelain-parser tests. This macOS filesystem refused creation of an invalid-UTF8 filename, so physical filesystem coverage uses Unicode, newline and leading-dash paths; there is no claim of physical invalid-UTF8 fixture coverage.

## Verification

Final Rust workspace regression: 50 tests, including subprocess helper tests. Coverage includes storage crash-before-ack recovery, concurrent writers, rollback/migration retries, private IPC and singleton, scoped capture/comparison, linked worktrees, conflict stages, CRLF, stale raw bytes, Git GC, symlink exclusion, binary/size limits, watcher coalescing, history ref races and cancellation with inherited descendant pipes.

Four editor probe tests pass. Contract generation is unchanged; TypeScript API check and probe production build pass. Rust formatting and diff whitespace checks pass. The real macOS host process smoke verifies profile 0700, socket 0600, second-instance refusal and framed hello. These backend checks do not certify the future packaged client integration.

The TypeScript CLI check uses `--ignoreConfig` when passing the API source file directly; without it the installed compiler rejects explicit source arguments alongside a discovered tsconfig. The probe build retains its large-chunk warning (approximately 802 kB uncompressed); splitting the production UI belongs to T3.

## Performance evidence

Disposable macOS fixture: 10,000 files, 100,000 commits, 1,000 dirty files and a 2 MiB file. `crates/host/examples/bench.rs` measures the host service, not rendered GUI frames.

- Host startup to first 200 commits: 355 ms.
- Five hot history reads: 371 / 381 / 351 / 350 / 358 ms.
- Watch update p95: 848 ms, 10 samples.

The backend thresholds (<5 s startup, <2 s hot, <1 s watch p95) passed. Startup was not a controlled cold OS disk-cache measurement. GUI graph rendering and hardware-comparable release benchmarks remain T3/T10 acceptance items.

## Independent review

One final independent read-only review found no critical issue and seven important issues. All seven were corrected with regression coverage: incomplete comparison scope, selected-byte generation gaps, snapshot IPC size, descendant pipe cancellation, stale migration backups on retry, history refs changing during traversal, and missing binary exclusions.

One minor performance concern is deferred: multiline anchor search concatenates candidate windows and collects candidates, creating excess allocations for long anchors. Correctness is covered; optimize this before claiming large-file anchor latency targets. No second review pass was performed.
