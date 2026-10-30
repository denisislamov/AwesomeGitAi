# T6a — optional language construct help

Approved scope: §22 / A31; macOS only, compact English UI, local commits.

- [x] Add a versioned, source-linked local reference and syntax-aware resolver. Initial curated entries: C# sealed class / sealed override; TypeScript interface; Python yield / yield from. Unknown syntax, comments, strings and ambiguous contexts must remain unsupported. Record minimum documented language versions and explicitly disclose that project version is unknown.
- [x] Add an on-demand Code actions/context menu action and editor keyboard shortcut. Pin help to editor side, line and snapshot. Use the existing accessible dialog, expandable example/source details; never create hover popups or modify AI review state.
- [x] Test resolver discrimination and unsupported cases first (RED→GREEN), then UI open/close/keyboard and no invented intent; browser integration and regression of code/relations/explanations/trace.
- [ ] Run type/contracts, client/backend/native regression, build, one fresh final review, macOS manual help and detached-window checks. Commit after verification.

Ruling: ship a deliberately bounded curated catalog rather than heuristic explanations for every keyword. Unlisted syntax reports unsupported; future entries can be added without changing UI or MCP. No project execution, language-service request or external network request is needed for help. This does not certify the configured language version or explain author intent.

Review focus: source/side selection after focus leaves editor; contextual keyword ambiguity; string/comment false positives; detached hydration and stale snapshot state; focus restoration; no changes to recorded explanations or review marks.

Final review: two important issues reproduced: focus-only side changes and raw C# string false positives. Fixes track focus and originating dialog side; raw-string-containing C# sources explicitly unsupported because the bundled reader cannot tokenize them reliably. Cost: valid keywords elsewhere in such a file also have no help. Minor deferred: source URL is selectable text rather than an external-browser link.

Automated completion: UI78, Rust103, probe4, native8, contracts/typecheck, browser13 + focused narrow-pointer rerun pass; bundle built. Manual T6a native acceptance remains open because Mac relocked. Commit records implementation and evidence, not completed native acceptance.
