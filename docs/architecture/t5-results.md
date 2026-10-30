# T5 — guarded Git operations (macOS)

Implementation: `8d8f90e`. Final verification and correction commit follows.

## Delivered behavior

Local desktop users can initialize/clone a repository, create/switch branches, stage/unstage a file or selected lines/hunk, commit the Index, fetch, pull fast-forward only, and push HEAD to an explicitly selected remote branch. Git controls are collapsed by default in the movable Git panel. Partial changes show the current/proposed Index before applying; worktree bytes remain untouched. Review marks remain independent from staging.

The main window owns background jobs and routes detached-window actions against the current repository generation and comparison. Code, file, explanation and Git panels retain moving, resizing, hiding, persistence and separate macOS windows. Git jobs expose running/completed/failed/cancelled state and a cancel action. Snapshots stay immutable and visibly stale after Git changes until refreshed.

Index mutations use an isolated temporary index and a shared common-Git-dir lock across linked worktrees. Installation acquires Git's `index.lock`, checks index bytes, HEAD and current generation, syncs and atomically renames the owned lock. Foreign lock files are never removed. Original/temporary index timestamps are preserved because Git uses them to detect same-size edits with ambiguous stat timestamps. Cancellation removes owned temporary files and terminates the command process group.

Git hooks, credential helpers, SSH and signing remain Git's responsibility. Interactive terminal credential prompts are disabled; unavailable authentication is shown with a terminal/helper recovery hint. No automatic stash, reset or force push. Cancellation is not rollback: observed state changes and uncertain network outcomes are explicitly reported, including a commit already written before a cancelled post-commit hook. Native shutdown asks the owned host to cancel/join jobs before stopping it.

Git writes are local-desktop-only. MCP and remote-device principals cannot invoke mutation, preparation, cancellation or shutdown endpoints. MCP remains an explanation integration, not permission to modify Git.

## Verification

- RED→GREEN: operations/bootstrap contracts, job/preview API, frontend Git actions, normalization guard, same-size racy-index reproduction and completed-job capacity regression.
- Git operations: 7 tests; index/HEAD/worktree races and linked worktrees: 7 tests. Exact bytes include CRLF, missing final newline, partial deletion, new files and unborn unstage. Remote integration uses a disposable local bare repository, including divergence refusal.
- Host jobs: 4 tests, including forward/reverse partial staging, stale snapshots, cancellation after commit, 70 sequential jobs and MCP/remote denial.
- Final `pnpm test`: 92 Rust workspace + 34 client + 4 editor-probe tests pass. Native bridge tests: 8 pass. Rust/TypeScript contracts, typecheck, formatting/diff checks and macOS debug bundle build pass.
- Playwright: all 10 scenarios pass, including real-host hunk preview → partial staging → commit and actual title drag/drop with persisted layout. Prior snapshot/history/MCP scenarios retained. Sequential 100k graph startup samples: 2334/1838/1922/1846/1847 ms; hot history: 1441/1951/1510/1478/1442 ms. Cached 1900-line file switch: 15.7 ms.
- Native GUI before the final correction: repository/code/Git-controls load and actionable SSH failure verified; whole-file staging exposed the racy-index issue described below. Final corrected bundled host passes real IPC smoke: simulated SSH failure, exact staged/worktree bytes, pre-commit cancellation and shutdown cancellation with HEAD unchanged. The independent smoke initially omitted the RepoPath encoding field; corrected DTO passes.
- Final manual GUI cancellation/detach follow-up is pending: Mac relocked during regression; two UI-access attempts confirmed it remains locked and user unlock was requested. Earlier T4 native detach/redock acceptance and T5 browser drag/drop remain valid evidence, not a substitute for this final manual pass. Physical second monitor remains untested.

## Corrections found during acceptance

1. Native same-size edit exposed index timestamp loss when copying to a temporary index. Initial short tests did not expose it because their stat cache was already invalidated. A deterministic test first demonstrated old bytes surviving staging; preserving index timestamps makes it pass.
2. One independent final review found completed receipts incorrectly counted against the 16-active-job limit, permanently blocking the 17th operation. A 70-job test failed before the fix; active tasks are now counted separately from the bounded receipt history. No other findings or deferred minors in this T5 review. No second review.

## Explicit limits

Partial staging accepts bounded UTF-8 text (2 MiB/file, bounded diff matrix). Binary, unresolved-conflict/nonregular-mode and active filter/encoding transformations are rejected; use whole-file staging or the external IDE. A selection on only one side independently adds/removes those lines; selecting a hunk includes both sides, and the preview shows the exact result.

The common lock coordinates this application's processes/worktrees. Git's index/ref locks and revalidation detect external changes, but cannot lock arbitrary editor writes atomically. Git handles hook/signing/auth failures; raw hook output is not displayed because it may contain secrets. Remote configuration and interactive authentication setup remain in the terminal. No real GitHub push or hosted authentication/signing acceptance was performed; remote tests are local, and authentication failure is simulated.

Job receipts/previews are bounded and in memory; restarting the host loses them. A cancelled clone may leave a partial destination, which is retained for inspection. Android, iOS and Windows remain deferred. T6 traces/diagrams are not part of this change.
