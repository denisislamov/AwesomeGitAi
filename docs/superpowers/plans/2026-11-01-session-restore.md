# Workspace Session Restore Implementation Plan

**Goal:** Reopen the last project, code tabs, selected commit and macOS window arrangement at startup.

**Architecture:** Persist bounded, versioned navigation references in local WebView settings. Reuse existing repository/compare APIs to load code; reuse panel layout and native geometry storage. Main owns persistence; detached windows consume the published workspace.

**Tech Stack:** Existing React/TypeScript, Tauri/Rust, localStorage and private native app-data files. No new dependencies.

## Design and constraints

The user explicitly requested automatic continuation of the previous workspace. Extend the existing local layout/recents persistence rather than serialize live workspace objects or introduce a database schema. Store only paths, revisions, active tab, scroll positions, selected commit/base, branch filter and view settings. Historical versions stay pinned; working revisions are read afresh. Never persist source bytes, credentials, jobs, Git previews or pending commands. Retain the last saved record on failed startup, show English recovery feedback, and let manual navigation supersede an in-flight restore. Legacy installs may reopen the first recent project with no tabs.

Retain dock tree, split ratios, hidden panels and detached panel identities. Reopen detached windows once; failed window creation redocks the panel. Restore main and detached window bounds, maximizing/fullscreen where available, with existing monitor-visibility guards. No new background-service lifecycle; opening the project starts the existing host.

## Tasks and verification

- [x] Add failing session tests: round-trip bounded references, corrupted input, missing project/version, historical/live tabs, active order/scroll, selected commit with custom base, manual navigation winning and idempotent startup.
- [x] Implement session codec/controller under apps/client/src/features/session and wire main-only startup, periodic/event flush and compact recovery feedback into app.tsx. Add a navigation revision to Workspace and preserve selected commit base independently of tab context.
- [x] Add failing layout/native tests for retained detached windows, once-only startup and failed-open fallback. Extend DockLayout and native geometry persistence for main window and reliable Quit restoration.
- [x] Add browser reload acceptance for project/tabs/active commit/layout and unavailable-project feedback. Run UI suite, native tests, types/contracts and relevant browser regressions.
- [x] Build macOS, verify actual Quit/relaunch with EFT, detached panels and geometry; verify MCP host after automatic project reopening. Document results and commit locally without pushing. T8 remains deferred.

## Review focus

- StrictMode's repeated effect setup must not reopen the repository twice or overwrite saved tabs during partial restoration.
- Manual repo/commit/tab navigation must win over delayed restore responses.
- Closed/detached windows must not be interpreted as user redocking during startup or application shutdown.
- Missing snapshots and removed repositories must not prevent other tabs or the repository chooser from working.
- Disconnected monitors and older settings must leave windows reachable.

## Execution ledger

- Controller and layout tests observed RED, implemented, UI132 and types GREEN.
- Final review: two Important findings; no declined-to-judge items or deferred minors.
- Final: fixed late restored file after manual tab close — `closing a restored tab cancels a second in-flight file without reopening it` RED→GREEN, UI133/133.
- Final: fixed detached restored custom comparison authorization — `detached_git_accepts_only_published_restored_base_outside_history_page` RED→GREEN, native12/12 before scale follow-up.
- Native acceptance exposed first-focus/display-scale bounds drift. Geometry now queries current normal bounds together and stores scale for logical-size restoration. Dedicated Retina conversion test added; actual restart acceptance recorded in results.
