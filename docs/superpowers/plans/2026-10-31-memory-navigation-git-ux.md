# Recorded explanations and compact Git navigation

Authorized fixes from the EFT screenshot; macOS, English compact UI, tests and local commits. T8 untouched. EFT code/index/refs must remain unchanged.

Evidence: three decisions in the real profile retain exact source anchors; the clean worktree has no Changes, and Diagram is a distinct artifact type. No automatic commit association is invented for the existing review-only snapshot. The current Git view has flat fixed-width branch/details lists.

- [x] Add a tested jump from each local recorded decision anchor in Project Memory to its original snapshot pair and code selection, switch Context to Explanation. Expose a compact Browse recorded explanations action when no code is open. Reject stale cross-project navigation; external imports do not gain local identity.
- [x] Tree branches by slash-separated prefixes, keep current branch visible independent of All branches filter, and mark active local branch. Add pointer/keyboard splitters with persisted widths between branches, commits and details; preserve narrow layout and detached behavior.
- [x] Test stale history cursor recovery without discarding code. Do not retry Git mutations or silently substitute snapshots. Immutable views should not require a live worktree generation.
- [x] Run targeted RED→GREEN, full UI/backend/native/contracts/browser regression and macOS bundle, then native existing EFT-record navigation and Git layout checks. One fresh review, important fixes, results and local commits.

Rulings: use existing stored comparison IDs/snapshots; historical review is not a reconstructed parent→commit diff. Initial group expansion follows current branch; folder collapse state and section widths saved locally. No permanent new top toolbar.
