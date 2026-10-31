# Recorded explanation navigation and Git layout — 2026-10-31

## Problem and evidence

The EFT host profile contains all three recorded decisions from the review session. Read-only host lookup resolves the original code anchors as Exact. The screenshot combines a clean worktree (empty Changes list), no open code, and the Diagram tab: none of those surfaces navigates to a plain recorded decision. The saved review used a worktree snapshot; it must not be described as a parent-to-commit diff.

## Changes

- Project Memory local decision records expose Open code for each anchor. Navigation validates the saved comparison/side/snapshot, opens that snapshot pair, selects Explanation, highlights the block, and reveals its source lines. Old-side navigation opens split view. External imported records do not inherit local identity.
- An empty Context pane offers Browse recorded explanations, including when Steps or Diagram is selected. Existing files and Git history remain available.
- Git shows the current branch independently of its All branches filter, marks local HEAD, and groups slash-separated branch names into expandable folders.
- Internal branch/commit/details splitters support pointer and keyboard input and save widths locally. Folder expansion is saved. Narrow panes keep details resizing.
- An expired history page cursor refreshes the list while preserving open code. Git mutations are never retried. Immutable snapshot comparisons no longer read the live index for a generation token.

The precise originating action for the screenshot's STALE_STATE banner was not reproduced. Covered failures are stale history pagination and dependence of immutable snapshot reads on a damaged live index, each reproduced by a regression test before its fix.

## Validation

- Rust workspace: 144 passed; UI: 96 passed; platform probe: 4 passed; native shell: 8 passed. Protocol consistency, TypeScript, diff whitespace and macOS bundle passed.
- Fresh review found offscreen anchors were not revealed and narrow details columns ignored the saved width. Both were corrected; browser coverage checks line 1500 visibility and physical pane widths.
- Native rebuilt macOS app opened the actual EFT CanStart record from Project Memory, displayed CharacterStanceSimulation.cs with its original snapshots and Exact version explanations. Branch folders expand/collapse and the current branch remains visible. Native branch width changed from 235 to 362; complete pointer/keyboard geometry coverage is in browser tests.
- EFT HEAD and porcelain status were identical before/after native checks. Existing code was read only, no acceptance records or source commits were written.
- Browser coverage: all 16 functional scenarios passed across full and focused runs; optional 100k-commit benchmark skipped. Wide and narrow splitters change measured pane widths. The first run exposed an ambiguous test locator after adding the separator, corrected with exact matching. An intermediate source reload invalidated one run.
- The later full run passed 14 scenarios, with one 5-second trace file-navigation timeout and a failing deep-anchor visibility test. The latter revealed saved-scroll restoration overriding navigation in the next animation frame. Explicit reveal now runs after restoration; the isolated trace scenario and line-1500 scenario both passed (12s and 11s overall). No claim of a wholly green single full browser run is made. Typecheck and all 96 UI tests passed again after the scroll fix.

T8 remains deferred. No push.
