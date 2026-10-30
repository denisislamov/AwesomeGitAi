# T3a relations and code teaching overlays implementation plan

> Execute with scoped parallel workers for independent analyzer/host/UI domains, integrate sequentially and run one fresh final review. User explicitly authorized T3a, tests, regression and local commits; existing approved spec remains authority.

**Goal:** Ship compact semantic usages/class relations plus clearer explanation ranges and recorded inline variable values on macOS.
**Spec:** ../specs/2026-10-29-awesomegitai-design.md §22, A30; latest user request for stronger block highlights and debugger-like values.
**Architecture:** Bounded immutable source-set analysis, never execute user projects/config/plugins. Roslyn, TypeScript service and Jedi adapters return structured definitions/references, host validates and ties results to captured revision. UI lenses open grouped results on demand with return navigation. CodeMirror decorations show pinned explanation ranges and active recorded trace frame values.
**Constraints:** English UI; Monaco/Gruvbox unchanged; no permanent new toolbar/panel; no push; macOS only. Partial/unsupported/error never implies zero usages. No live-debugger claim for recorded values. No mismatched revision decorations.

## Wire contract
Desktop request `CodeRelations { scope, snapshot_id, path }`; response `CodeRelations { report }`.
Report: `origin_snapshot_id`, `snapshot_id` (analysis/navigation snapshot), `status` string Ready/Partial/Unsupported/Unavailable, `adapter` string, `message` string, `files` RepoPath[], `symbols` RelationSymbol[].
RelationSymbol: `id`, `name`, `kind`, `path` RepoPath, `line` u32, `column` u32 (1-based UTF-16), `references` RelationReference[].
RelationReference: `path`, `line`, `column`, `kind` string (Read/Write/ReadWrite/Call/Override/Implementation/Inheritance/Type/Reference), `snippet` string. Report is analysis-only; related changes are determined by comparison in UI, not inferred semantic effects.
Adapter stdin JSON `{files:[{path:string,text:string}]}`; stdout JSON `{adapter:string,status:string,message:string,symbols:[{id,name,kind,path,line,column,references:[{path,line,column,kind,snippet}]}]}`. Paths exact captured relative UTF-8 strings. No disk source resolution. Maximum 128 files/4MiB input, bounded timeout/output. Always disclose incomplete project analysis (no build configuration).

## Conservative working-tree expansion provenance

Working-tree analysis preserves the original captured files. Additional dirty/untracked files are eligible only when their raw contents are covered by the same original repository generation. Additional clean files use immutable index blobs pinned by that generation, never newly observed raw worktree bytes; filters and line-ending normalization can hide raw changes from Git status. Assume-unchanged and skip-worktree additions are excluded. The report explicitly identifies this partial analytical baseline and the navigation snapshot contains those exact baseline bytes; it does not claim to reconstruct the full historical working tree. Commit expansion remains tied to its immutable commit OID.

## Tasks
- [x] Adapters: production in-memory C#/TS/Python analyzers, cross-file/overload/interface/override/read/write tests; package macOS runtimes or report unavailable explicitly. Own `packages/relations`, adapter build script.
- [x] Host: typed DTO/export, scoped revision-safe capture/validation, bounded subprocess with sanitized environment/temp cwd, cached bounded immutable results, missing runtime and unsupported language tests. Own Rust + generated API. Never extend old snapshot with newer working files; if current source generation cannot be established, analyze original captured scope only.
- [x] UI: on-demand Relations via Code actions + compact declaration lenses (max three); status text distinguishes Partial/Unknown from zero, grouped snippets, accessible navigation/back preserving original revision/selection. Detached commands use existing main-owned forwarding. Tests cover late result/repo switch/revision mismatch.
- [x] Teaching overlays: explanation block fill/border on matching side; recorded step arrow and frame-local inline values on relevant source lines only, unknown explicit, changed values distinct, mode/file/snapshot changes clear overlays. Unit + rendered editor tests.
- [ ] Integrate and verify contracts, client/host/native suites, browser end-to-end real analyzer A30 and trace overlays, macOS build/manual usages/detach/back. Final fresh review and local commits.

## Review focus
- Wrong snapshot or repository result must not appear as current (host + workspace race tests).
- Shadowed names/overloads and compound assignment must not merge symbols (adapter tests).
- Invalid UTF-8/symlink/out-of-scope source and analyzer limits must fail closed/partial (host tests).
- Inline values must not attach to comments/strings, wrong frame, old-side editor or another snapshot (overlay tests).
- Back navigation and detached panels must preserve selection and pinned revision (workspace/browser/native tests).
