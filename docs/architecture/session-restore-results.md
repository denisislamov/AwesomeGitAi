# Workspace session restoration (macOS)

Startup reopens the last repository and up to the existing 12-tab limit, preserving tab order, active version, scroll offsets, selected commit/custom comparison base, branch filter and view settings. Saved historical references stay pinned; working revisions are read again. Existing dock ratios, hidden panels and detached panel identities are retained. Detached windows open once and redock if creation fails. Main and detached geometry is stored privately, including display mode and scale, with a monitor-visibility guard.

Only navigation references/settings are saved in local WebView storage. Source bytes, credentials, pending Git commands and previews are not serialized. Missing repositories/versions produce compact recovery feedback and preserve the last complete record until deliberate navigation. Manual navigation/Stop restoring invalidate pending work. Older installs reopen the first recent repository. Detached windows consume main's state and do not independently restore/save sessions.

## Verification

- Session tests first failed without the controller; detached restoration tests failed before implementation.
- Fresh review found late file arrival after tab close and detached Git rejecting a restored comparison base outside the first log page. Both received failing regression tests, then fixes; no findings deferred.
- Final UI suite: 133 passed. Typecheck and protocol consistency passed.
- Native tests: 13 passed, including legacy bounds, Retina logical sizing and detached custom-base authorization.
- Browser: initial six-scenario run passed five; the new reload test selected a commit before its first file finished loading, correctly cancelling that file. Added an explicit code-visible wait; reload scenario then passed. Final three-scenario run (docking/Git operations, MCP explanations and reload) passed; eight distinct browser scenarios passed across these runs.
- macOS bundle built; actual Quit/relaunch restored EFT, two historical tabs with the first active, a separately selected commit, and the detached Files panel. The first native check exposed a display-scale/first-focus bounds drift; current bounds are now queried together, and logical sizes are restored using the recorded scale. A further full Quit/relaunch preserved the exact normal geometry of both windows on the external display (main 1721×1409, detached 450×350). Both tab order/active tab and independent commit selection were confirmed again. Files redocked successfully afterward; EFT stance commit left selected. Live MCP guide succeeded after the final restart.

## MCP incident

The reported HOST_OFFLINE reproduced on integration_guide. Only MCP stdio processes existed; no desktop client, host process or live socket listener. Launching the app and opening EFT restored the host. After automatic session reopening, a real integration_guide call succeeded again. Grants/config and existing explanations were not modified. The local host still belongs to the running app; this change does not introduce an always-running background service.

## Limits

macOS only. No Android/Windows/iOS acceptance, no T8 work, no push. Physical monitor disconnection and fullscreen transitions require separate hardware/runtime coverage; monitor visibility and legacy geometry are covered in native tests. EFT source and Git operations were not changed by these checks.
