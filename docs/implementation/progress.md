# Исполнение MVP

План: docs/superpowers/plans/2026-10-29-awesomegitai-mvp.md

## 2026-10-30 — старт T0

Последние UX-уточнения закреплены в §22 ТЗ; декомпозиция расширена до 13 задач. Все продуктовые задачи пока незавершены.

Выполнена проверка среды: Node v24.7.0; pnpm 9.15.4; Xcode выбран из /Applications/Xcode.app/Contents/Developer; iphoneos SDK 26.5; adb доступен. cargo/rustc отсутствуют в PATH и стандартном ~/.cargo/bin; tailscale отсутствует в PATH. Наличие adb/SDK не доказывает наличие подключённых устройств или signing. Windows, Android/iOS installation, secure-store и remote не проверены.

T0: in progress, только preflight. Сборки и тесты приложения ещё не запускались: исходников приложения нет. Следующий шаг — установить локальный toolchain, создать изолированный platform probe и выполнить сценарии T0. Gate T0 не пройден; T1 не начинать.

Рабочая ветка при старте: d.islamov/awesomegitai-design, чистый checkout. Текущий коммит фиксирует только требования/декомпозицию/preflight, не завершение T0.

## T0 local checkpoint

See docs/architecture/m0-results.md. User deferred Android and requested continued macOS/backend work. Provisional desktop go; original full T0 acceptance remains open. Four editor tests pass, Vite and macOS debug build verified, packaged Git hello works. T1 starts next on this explicitly limited basis.

## T1 — первый проверенный шаг

Добавлен agai-storage: SQLite WAL/FULL, атомарная запись payload+bytes, идемпотентность, конфликт повторного ключа, отказ неизвестной версии. Первые пять тестов наблюдались RED→GREEN; дополнительно проверены одновременные подключения и сохранение исходной записи после конфликта. Всего 7 storage-тестов; регрессия probe 4 теста.

Это частичная реализация T1, не завершение задачи. Ещё нужны protocol/генерация TS, HostService/IPC/ACL/singleton, структурированные snapshots/events/projections/FTS и crash recovery/migration checks. Ключ низкоуровневого Store должен быть scoped вызывающим host; этот примитив не является публичным API. T2 не начата.

## T1 completed for current macOS scope

Added Rust protocol + generated TS checks, raw-path roundtrip, snapshot/event atomic transactions, scoped idempotency, migration backup/rollback, rebuildable FTS, private Unix IPC and profile singleton. Tests include concurrent writers, abort before acknowledgement, insertion failure rollback, schema migration failure and real socket framing/version checks. Future feature DTOs/capabilities are introduced with T3–T9 instead of publishing unimplemented operations. Windows/mobile excluded per user. See architecture/storage-and-ipc.md for limits.

## T2 completed for current macOS backend scope

Implemented Git reads/history, scoped raw-byte snapshot capture, immutable comparisons/anchors, repository registry and coalescing rescan watcher. T1 committed as `d76a496`; T2 includes seven important final-review fixes. Final regression: 50 Rust tests, 4 editor tests, contract/type/build checks and real macOS host IPC smoke. Backend benchmark: startup/first history 355 ms; watch p95 848 ms. Full evidence, scope decisions and the deferred minor anchor-allocation optimization: [T2 results](../architecture/t2-results.md).

T1/T2 backend deliverables are complete. GUI graph/cold-cache acceptance moves to T3/T10; it is not certified by backend timings. Android, Windows and iOS remain deferred. T3 has not started; no MCP server or Git mutation capability is claimed.

## T3 — desktop implementation and final review

Implementation commit `6997fbd`: React/Tauri read-only workspace with real local host, code/diff, file tabs, Git Log and snapshot-bound explanation placeholders. macOS native app built/launched and repository→file→context checked. Final review found three important issues; corrected repository transition isolation, arbitrary-base file lists and explicit owned-host exit. 54 Rust workspace, 4 native, 8 UI and 4 editor tests pass; final browser regression recorded in [T3 report](../architecture/t3-results.md). Two minor findings are documented there.

The corrected bundle builds. Final manual Cmd+Q recheck is pending Mac unlock; automated shutdown tests pass. T3 implementation is delivered, native acceptance retains that explicit open item. Android/Windows/iOS remain deferred. No T4 implementation has started.

2026-10-30 follow-up: final native Cmd+Q acceptance passed after unlock (repository loaded in final bundle, owned host socket refused connections after Quit). T3 closed. T4 and user-requested movable/resizable panels with separate macOS windows now in progress.

## T4 + IDE docking — implementation and regression

T4 is implemented for the current macOS scope, including stdio/loopback MCP, durable explanation history, immutable anchors and human review. Two independent substitute harnesses pass both transports; actual Rider/Cursor products remain untested. Added movable/resizable dock panels and native detached windows sharing authoritative state. User's later density request normalized Monaco typography, spacing and line height.

Final independent review's two important issues were fixed with RED→GREEN regressions (multi-file original snapshots; detached editor polling identity). Packaged native MCP→explanation→detached human review→redock and Cmd+Q with secondary window were checked. Details/counts/benchmark outlier/physical second-monitor limitation are recorded in [T4 report](../architecture/t4-results.md). No push or merge; T5 not started.

Backend commit: `1d5d113 feat: record agent decisions through MCP`. Final compact bundle is built; Documents access after unsigned rebuild awaits a new macOS permission (TCC confirmed), and a subsequent Mac lock blocked the final visual pass. Temporary-repository bundled MCP succeeds. Earlier native window and Quit acceptance remains recorded; no second-monitor or IDE-product certification is implied.

Desktop/UI commit: `070d65b feat: add snapshot explanations and compact detachable IDE panels`. Final `pnpm test` builds fresh host/gateway before testing: workspace 73 + client32 + probe4 pass; native8 separately pass. Full browser9 pass; final MCP-fixture rerun passes. Working scope remains macOS development build; OS permission follow-up above is explicit.

T4 native follow-up: user approved Documents and unlocked Mac. Final compact bundle repository/code/explanation/detach/redock/original Accepted mark verified. Previous TCC/lock item closed. T5 starts next, macOS only; tests/regression/local commits authorized. Docking/detaching remains a primary workflow.


## T5 — Git operations implemented; final manual GUI follow-up pending

Implementation `8d8f90e`: init/clone, branch create/switch, stage/unstage file/selection/hunk with Index preview, commit, fetch/ff-only pull/push, background cancellation and main-owned actions from detached panels. Local-user-only writes; common-Git-dir serialization, external index/ref checks and immutable snapshots preserved.

Native acceptance exposed loss of Git index timestamps; independent review found completed jobs exhausting the active-job limit. Both reproduced RED→GREEN and corrected in the final fix commit. Final regression: Rust92 + UI34 + probe4 + native8; Playwright10, contracts/typecheck/macOS bundle pass. Packaged host IPC auth/stage/cancel/shutdown smoke passes. Final manual GUI cancellation/detach recheck awaits Mac unlock after it relocked during regression; do not treat that item as passed. No push/merge, T6 not started. Detailed behavior and limits: [T5 results](../architecture/t5-results.md).

T5 final native acceptance closed after unlock: Cancel button stopped a running pre-commit hook, HEAD unchanged, no index.lock; Git panel detach/shared status/redock passed. T6 + English UI, then the next task in the addendum (T3a) authorized for macOS; local commits only.


## T6 — implemented; final native manual check pending

English UI, recorded step explanations, typed variables/deltas, stack/frame navigation, watches and linked diagrams implemented through real MCP. Final review corrections and regression: Rust95 invocations + UI45 + probe4 + native8, all11 browser scenarios including100k graph. macOS bundle, typecheck/contracts pass. See [T6 results](../architecture/t6-results.md). The Mac relocked; final GUI keyboard/trace/detached-panel check remains pending, not marked passed. T5 manual cancellation was completed before the lock. Local commits only.

T3a has started with isolated language-adapter probes; usage hints are not yet connected to the product. Correct task order from the plan addendum: T6 → T3a → T6a → T7.

T6 implementation commit `12e4241`; bundled macOS host/MCP learning smoke also passes. T3a initial adapter verification: Roslyn5.6/.NET10.0.302 distinguishes overload/override/interface/direct field access; TypeScript6.0.3 verifies field references; Jedi0.20.1 verifies shadowed file-local references. All three probes RED→GREEN. [Probe scope and remaining implementation gates](../../spikes/code-relations/README.md). This is a T3a starting checkpoint, not A30 acceptance or a shipped usages feature.


## Compact workspace + T6 native follow-up

Approved UI simplification delivered: native command menus, on-demand forms/settings, one editor context row, expandable revision IDs and simplified learning headings. Final native trace, keyboard, diagram, detached/redocked panel and Quit checks passed. Fixed a real bundled ELK cleanup crash discovered during native acceptance, with RED→GREEN regression. Final UI50, browser10 functional rerun, earlier full11 including100k, Rust95/probe4/native8, contracts/typecheck/macOS bundle pass. [Evidence and limits](../architecture/compact-workspace-results.md). T6 pending native acceptance is closed; T3a remains at its existing adapter-probe checkpoint. Local commit only.


## T3a — implementation complete, native manual acceptance pending

Semantic C#/TypeScript/Python adapters, snapshot-bound references, compact declaration lenses, grouped relations and comparison-derived changed locations, pinned navigation/Back and native command forwarding are implemented. Stronger explained-block highlighting and recorded frame-local inline values are included. Review findings and hidden-worktree snapshot provenance regression corrected. Automated regression and packaged all-language host smoke pass; exact native UI acceptance awaits Mac unlock. [T3a results, counts and explicit runtime/scope limits](../architecture/t3a-results.md). Local commits only; T6a not started.

T3a native follow-up: main/detached usage navigation, Back, redock, explanation highlight, recorded inline values and Quit passed after unlock. Fixed repeated native lens replacement with widget identity equality; client72 and typecheck pass, corrected macOS bundle verified. T3a closed for macOS; T6a starts next.

## T6a — implementation complete; native manual acceptance pending

Added optional language reference in Code actions/context menu and Cmd+Shift+K. Bounded versioned catalog: C# sealed class/override, TS interface, Python synchronous yield/yield from. Meaning/example/source/context remain separate from unknown author intent and AI review. Fresh review found focus-only diff-side and C# raw-string false positives; both reproduced and corrected. UI78, Rust103, probe4, native8, contract/typecheck, browser13 and narrow-pointer rerun pass; macOS bundle built. Mac relocked before final T6a native help/detached check, so that item remains open. [Results and limits](../architecture/t6a-results.md). Local commits only.

T6a native follow-up passed after unlock: keyboard help, examples/source, Escape focus, detached Code action and Quit. Corrected transparent dialog background with observed RED→GREEN style regression and rebuilt native visual verification. T6a closed; T7 in progress.

## T7 — implemented and macOS export/import/restart verified

Project Memory adds scoped search, explicit export/import previews, external provenance, context retrieval and whole-scope data erasure. Important fresh-review findings corrected with regression tests. Rust130/probe4/UI90/native8, contracts/typecheck/macOS build pass; browser13 existing + focused new Memory scenario pass. Native export/import and persistence after Quit/relaunch verified on a disposable repository without Git changes. Physical network-disconnection acceptance remains unrun; native erase stopped at confirmation, automated fixture erasure passed. See [T7 results and remaining bounded limitations](../architecture/t7-results.md). Local commits only; T8 not started.

## T8 — deferred by user

2026-10-30: user explicitly deferred T8 until further authorization. Requirements remain in the specification and plan; do not start implementation or automatically advance from T7. Current platform scope remains macOS.
