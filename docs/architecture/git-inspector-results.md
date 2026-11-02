# Resizable Git inspector — 2026-11-02

The right pane follows Rider's documented arrangement: changed files above commit details. Directory nodes expand/collapse; filenames are short and complete paths remain in tooltips/accessibility labels. Actual navigation retains the original RepoPath bytes and selected revision pair. The full message is readable without opening another disclosure. Both sections scroll independently, with a persisted percentage height divider.

The log has a compact sticky header and separately resizable Graph, Message, Author, Date and Hash columns. Graph lanes share a fixed cell width across rows; the message fills spare space. Wider columns use a local horizontal scrollbar, including on small windows, instead of hiding author/date/hash. Existing branch/inspector dividers remain; narrow layouts expose branch height. All controls support pointer drag and keyboard arrows/Home/End and retain generous hit areas around one-pixel lines.

Verification: new tests failed before implementation, then UI135 and typecheck/contracts passed. Initial browser run passed six of seven cases and exposed sticky-header overlap with the branch splitter hit area. The first focused rerun confirmed that fix and exposed overlap between the final Hash handle and the inspector divider. Corrected stacking and added a small trailing gutter; both affected browser scenarios then passed. Seven distinct browser scenarios passed across these runs, including contextual files, saved explanation navigation, session restoration, three viewport layouts, and persisted pointer/keyboard resizing.

The rebuilt macOS bundle launched successfully and restored the actual EFT workspace, selected commit and tabs. Native visual inspection confirmed the aligned column headers and populated Changed files tree above the independently scrolling commit message. Pointer resizing and reload persistence were verified by browser automation; native acceptance here covers launch, restoration and visual arrangement. No EFT source or Git operations were performed. Rust/backend behavior is unchanged and its full suite was not rerun for this UI-only change.

Publication: user explicitly authorized pushing the current feature branch, including previous local commits. Target is `origin/d.islamov/mvp-foundation`; no merge into `main` or force push is part of this task.

Reference: https://www.jetbrains.com/help/rider/Log_Tab.html. This adopts the pane hierarchy, not a pixel-identical Rider skin. macOS scope; T8 unchanged.
