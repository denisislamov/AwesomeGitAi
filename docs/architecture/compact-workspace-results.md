# Compact workspace — macOS acceptance, 2026-10-30

Commands moved into native File/Git/Agent/View menus, with browser fallback menus. Repository selection, init/clone, Git forms, panel layout and appearance open on demand. Code now has file tabs and one contextual row; revision identifiers expand in details instead of repeating above and below the editor. Learning tabs replace duplicate headings. Monaco sizing, Gruvbox, staging, search, history, warnings, explanation placement, resizing and native detachable windows remain available.

## Verification

- Full regression before the final diagram-only cleanup: 95 Rust test invocations (including durability child tests), 49 UI tests, 4 editor probes; 8 native tests separately. Contracts and typecheck passed.
- Full browser suite: 11 passed, including 100k commits. Five startup samples 3394/2364/2851/2418/2347 ms; hot history 1914/1488/1412/1991/1392 ms, within existing budgets. Cached 1900-line switch 32.5 ms.
- Final review found hidden controls entering the dialog focus loop and simultaneous dialogs from native menu commands. Both reproduced with failing tests and corrected. No second review cycle.
- Native inspection discovered a separate ELK cleanup exception: the bundled in-process worker does not implement terminate. A regression using the actual bundled engine failed before removing the invalid termination call. Pending results remain guarded after unmount.
- After that fix: all 50 UI tests and typecheck pass; browser regression 10 passed, benchmark deliberately skipped because it passed above and the change only affects diagram disposal. Browser learning scenario now switches away from and back to the diagram. Final macOS development bundle builds successfully (102.44 MiB).

## Manual native checks

Native Cmd+O/recent repository, Git Commit menu, View Panels menu, and replacing one open dialog with another passed. Trace keyboard navigation, nested/root Step out availability, cross-file call/return, final variable values and empty final stack were checked in the compact bundle. Panels resize and detach with shared state.

In the corrected final bundle: render the three-node diagram, detach it, switch to Steps without a blank window, return the panel to the main window, restore the diagram, and navigate to ResourceWallet.cs through its code-location link all passed. Cmd+Q exits; subsequent process inspection found no agai-client or agai-host process.

Physical second monitor, Android, Windows and iOS are not tested. This is an unsigned development build. No push or merge performed. T3a remains at the adapter-probe checkpoint; no shipped usages feature is claimed.

Local logs: `.superpowers/compact-full-regression.log`, `compact-final-native.log`, `compact-final-e2e.log`, `compact-review-red.log`, `compact-diagram-red.log`, `compact-diagram-green.log`, `compact-diagram-e2e.log`, `compact-diagram-build.log`.
