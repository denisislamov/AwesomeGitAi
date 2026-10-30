# Compact workspace implementation plan

> Execute inline with executing-plans; user approved the design in chat. Preserve current feature checkout and local commits. macOS only.

**Goal:** keep code, Git graph and explanations visible while moving commands and duplicate metadata out of the reading area.
**Design:** native macOS File/Git/Agent/View menus; compact repository switcher, browser fallback menus. Repository/init/clone, Git forms and appearance/layout settings open on demand. Code has file tabs and one context/action row. One revision summary with full IDs in details, no same-snapshot arrow or footer IDs. View options holds diff/whitespace/deleted/explanation placement. Contextual staging stays available. Learning tabs are the primary title; short simulation provenance remains visible, technical details expand. Preserve stale/error/uncertain-operation warnings and Monaco sizing. Approval: user's “Давай так да” after the concrete design proposal.

- [x] Add regression for compact defaults + discoverable repository, Git, editor/layout actions and one snapshot context. Observe RED.
- [x] Implement reusable accessible dialogs/menus and main-owned native command routing; retain native edit/quit/window commands.
- [x] Consolidate editor toolbar and metadata; remove global Git action strip/dock help strip; simplify learning titles/provenance without hiding source limits.
- [x] Update interaction regressions for menus, run client/native/host regressions, browser layouts and 100k graph. Build and inspect macOS menus, trace keyboard, detach/redock, diagram and Quit.
- [x] One final fresh review, fix important findings with focused regressions, local commit and evidence report. No push.
