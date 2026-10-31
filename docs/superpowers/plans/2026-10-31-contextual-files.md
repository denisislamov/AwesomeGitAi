# Contextual files and readable supporting panels

User-approved scope: Files follows opened commit/comparison/explanation, with separate Working changes; compact English macOS UI, tests/regression and local commit. T8 stays deferred.

Design: extract Files into a small component. A compact mode selector replaces ambiguous Changes. Opening immutable code selects Comparison files. Live work remains Working changes; All files is explicit. Compare actual commit endpoints via CommitDetails (including removed files), and snapshot endpoints via captured file state/hash, including recorded files for an identical/review-only pair. Never use current worktree content to fill historical lists. Async lists must be keyed to repository and revisions; stale results cannot open files with a new pair. Detached Files must retain scoped validation.

Commit details: title, expandable body and muted author/date, then separated file list. File basename primary, parent folder secondary and ellipsized, full path in tooltip/accessibility name. Context: subtly warmer surface, muted divider/accent, system-font prose, Monaco code/variables; no new toolbar.

- [x] RED: component tests cover clean historical files, deleted files, snapshot-only recorded files, Working changes, stale async results; detached validation regression.
- [x] Implement contextual navigator and safe detached historical opening; preserve user-selected comparison across file switches.
- [x] Implement commit-details hierarchy and supporting-panel styles; browser verification checks real commit/snapshot lists and readable narrow layout.
- [x] Targeted/full UI, typecheck/contracts, backend/native regression, browser and macOS build; one fresh final review; fix important findings, manual macOS acceptance, results and local commit.

Approach selected in conversation: follow open code. Alternatives (always worktree, or Git selection controlling an unrelated open tab) retain contradictory context and are excluded. Existing branch/worktree retained because this is continuing authorized work on the clean task branch. Review focus: stale cross-scope responses, historical deletions, snapshot completeness, detached validation, narrow readability.

Execution notes: 103 UI, 144 Rust, 8 native tests, types/contracts and bundle passed. Browser17 scenarios passed across full/focused runs; all review navigation findings fixed with RED→GREEN tests; scope selector race corrected. One five-second host navigation timeout required a longer test bound and two successful focused runs. Manual macOS acceptance completed after unlock: real EFT commit and recorded lists, separate Working changes, original explanation, detached Files navigation/redock, message disclosure and native visual inspection. EFT HEAD/status unchanged; no deferred code-review minors.
