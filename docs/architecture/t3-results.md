# T3 — macOS code workspace

Implementation date: 2026-10-30. Base: `2a5dafe`. macOS only, per user instruction. T3 delivers the read-only desktop workspace; Git writes, MCP explanation ingestion, memory and simulation remain subsequent tasks.

## What is implemented

React/TypeScript desktop client in `apps/client`, packaged by Tauri with a separate Rust host executable. The native bridge communicates over private local IPC; the webview does not open SQLite or execute Git. The application starts its own host when needed and can connect to an existing host profile. No HTTP server ships in the application. The Playwright HTTP adapter exists only in the e2e Vite mode.

The screen keeps code central, files at the left, an optional explanation panel/card at the right and Git Log below. Gruvbox Dark Hard, Monaco with system monospace fallback, 15 px code/main text, 12 px minimum labels, zoom and a light theme are available. File tabs retain their captured bytes and scroll position. Search, folding, breadcrumbs and line navigation use CodeMirror 6. C#, TypeScript/JavaScript and Python have syntax parsers; other files remain readable as plain text.

All/Changed file views preserve raw path identities. Unified/split comparisons cover index/worktree, HEAD/index, commit/commit and stored snapshot IDs. Root commits use an empty baseline. Deleted files expose their old version. Conflict stages remain explicit. Binary, sensitive, oversized and escaping paths show structured failure instead of fabricated text. Hiding trailing whitespace changes only the view; snapshots and comparison identity remain unchanged.

Git Log contains Local/Remote refs, paginated history, virtualized graph rows derived from true parents, subject, author, date and hash. Branch selection filters loaded ancestry, never checks out. Commit selection shows metadata and changed files without replacing code; opening a historical file is explicit. A selected base commit enables two-commit comparison. Graph search and branch filters cover loaded history, with explicit pagination. The dock is resizable by pointer or keyboard and remembers its height.

Explanation panel and card share an exact comparison/snapshot/side/line selection. Until T4 they truthfully show missing explanation or stale snapshot; no rationale is invented. Changes from outside the application flag pinned working snapshots and offer explicit refresh. Repository files refresh after a detected change, while history refresh is explicit and keeps code tabs intact.

The native external-open boundary permits only Rider or Terminal, only an opened repository, and validated canonical paths within it. It uses fixed argv, never a shell command assembled from repository content. Missing external applications return an error.

## Verification before final review

- 53 Rust workspace tests, including subprocess helper tests; 2 native bridge tests.
- 7 client state/graph tests; 4 prior editor probe tests.
- 7 Playwright scenarios against a real disposable Git repository and the actual host process: real diff, old/deleted side, branch and commit selection, exact explanation target, stale refresh, 1280/1024/390 layouts, keyboard invocation, read-only code, cached 1900-line file switching/scroll restore, root commit and snapshot comparison.
- TypeScript build/typecheck, Rust formatting, generated contract drift check and whitespace checks.
- macOS debug `.app` built and launched. Native UI opened the actual project repository, listed files/refs/commits, displayed `CodeReader.tsx` through IPC and showed its snapshot-bound explanation card. Native UI evidence was inspected through the accessibility tree. This does not certify Windows/mobile or distribution signing.

Performance on the disposable 100,000-commit / 10,000-file / 1,000-dirty-file fixture: first rendered graph after opening repository, five observations: 2346 / 1837 / 1912 / 1860 / 2333 ms. Hot history refresh: 1507 / 1976 / 1455 / 1944 / 1471 ms. Cached 1900-line file switch: 12.2 ms. These pass the 5 s / 2 s / 200 ms budgets in this run; the hot history margin is small. OS disk caches were not forcibly cleared, and these are local samples rather than a release hardware matrix.

## Running it

From the repository root, install with `pnpm install`, then `pnpm desktop:dev`. `pnpm desktop:build` builds a macOS development bundle at `apps/client/src-tauri/target/debug/bundle/macos/AwesomeGitAi.app`. The helper uses the project-local Rust installation when present and otherwise the user's Cargo. The host is included in the bundle; Git must be installed on the Mac. The development bundle is not a notarized distribution release.

Regression: `pnpm test`, `pnpm typecheck`, `pnpm contracts:check`, `scripts/cargo-local.sh test --manifest-path apps/client/src-tauri/Cargo.toml`, and `pnpm e2e -- workspace`. Set `AGAI_UI_BENCH_REPO` to the disposable benchmark fixture to include the large-repository test; without it that test explicitly skips. Native packaging and UI acceptance are separate from browser tests.

## Scope decisions and limitations

- Reused the clean dedicated implementation branch; no extra worktree or concurrent implementer.
- Added a typed, local-only desktop IPC request family for registration and captures. These materialize snapshots but never mutate Git. Remote/MCP adapters remain separate later tasks.
- Historical data is lazy and paginated; branch filtering is explicitly limited to loaded commits. Git remains authoritative, and explicit refresh handles rewritten refs.
- The trailing-whitespace toggle preserves line counts and binding identity. It is not a general ignore-all-whitespace diff mode.
- Snapshot comparison currently accepts UUIDs shown beneath the editor; a searchable snapshot browser belongs with project memory. This is functional but less discoverable than the future memory UI.
- The client uses a small observable workspace controller and generated DTOs rather than adding Query/Zustand before caching/mutation workloads require them. A future transport can implement the same interface, but remote registration semantics remain T8 work.
- The production bundle still warns about a roughly 878 kB uncompressed JS chunk containing editor parsers. It loads locally; further splitting is a follow-up optimization.
- This is read-only T3, not the entire MVP. T4 supplies real explanations/MCP; T5 supplies Git writes; T3a supplies usages and semantic relationships; T6/T6a supply simulation/language help.

Final review status: pending. Review fixes and deferred findings will be recorded below before closing T3.
