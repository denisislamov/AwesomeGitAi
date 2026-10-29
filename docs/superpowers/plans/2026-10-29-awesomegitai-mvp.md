# AwesomeGitAi MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Метод исполнения выбирается отдельно; этот документ не запускает реализацию.

**Goal:** Выпустить устанавливаемый Git-клиент с привязанными к коду объяснениями и MCP, затем Android/iOS companion с приватным доступом к тому же host.

**Architecture:** React/Tauri UI обращается к отдельному Rust host; host владеет Git, SQLite, снимками и авторизацией. MCP и remote используют то же domain-ядро через разные ограниченные интерфейсы. Мобильный UI читает данные host, не исполняет Git локально.

**Tech Stack:** React, TypeScript, Vite, Tauri 2, CodeMirror 6, TanStack Query, Zustand, Rust/Tokio/Axum, rusqlite/SQLite/FTS5, Git CLI, rmcp; HTTPS + SSE и Tailscale Serve для remote.

**Spec:** [ТЗ 0.4](../specs/2026-10-29-awesomegitai-design.md) + [ADR-0001: desktop/mobile/remote](../../architecture/0001-desktop-mobile-and-remote.md). Платформы и remote в ADR — предлагаемые расширения прежнего ТЗ. При конфликте этих новых предложений с прежними авторскими границами использовать ADR; пользовательские требования к поведению не сокращать.

Статус: план для рассмотрения, 29 октября 2026. Выполнен UX-макет; все задачи ниже ещё не выполнены. Нет установленного framework/backend; прототип не переносится целиком в production.

## Global Constraints

- «В центре код», два режима «Код» и «Память», Git Log открыт по умолчанию; выбор коммита не делает checkout.
- Тема по умолчанию Gruvbox Dark Hard; палитра из ТЗ; контраст основного текста ≥ 4.5:1, статусы не только цветом.
- «Учебная симуляция · код не выполняется»; значения до инструкции, стек и объяснение синхронны.
- Git — источник состояния кода; события — источник истории объяснений. Скрытые рассуждения модели не запрашиваются.
- Каждая запись имеет schema version, idempotency key и durable ID; замена решения проверяет expected revision.
- Default text snapshot limit: 2 MiB на файл; `.env`/`.env.*`, PEM-ключи и sensitive поля из ТЗ исключаются; исключения видны.
- MCP обязателен: stdio и loopback Streamable HTTP, общий tool contract, встроенный integration_guide + inputSchema, минимум два независимых harness в приёмке. [Материалы](../../integrations/mcp-contract.md) и схемы уже подготовлены как проект контракта.
- Monaco по всему UI: основной текст 15 px, код 14 px, подписи ≥12 px, масштаб и fallback.
- MCP не исполняет Git-мутации или arbitrary shell; агент не создаёт человеческое принятие решения.
- Desktop MVP macOS ARM64 + Windows x64; Linux x64 headless и Android/iOS входят в Connected MVP. Linux desktop позже.
- Удалённые клиенты MVP: чтение + «просмотрено»; не stage/commit/push и не управление агентом.
- Нет обязательного аккаунта AwesomeGitAi/облачной БД; remote beta требует отдельно настроенный Tailscale.
- Все изменения чужих worktree и untracked сохраняются; проверки используют временные репозитории, сетевые Git-тесты — локальные bare remotes.
- Зависимости/toolchains фиксируются M0 в lockfiles. Не подставлять непроверенные номера версий из этого документа.

## Review Focus

1. CRLF, Unicode, пробелы, ведущий `-` и non-UTF8 пути: diff/staging не затрагивает другой файл; неподдерживаемое кодирование явно отображается. Проверки T1/T2/T5.
2. IDE меняет файл между чтением и stage; другой worktree пишет общие refs: отказ от устаревшего действия и сохранение внешних правок. T2/T5.
3. Windows/macOS GUI не наследует PATH/SSH agent терминала: диагностика Git/credentials, отмена без зависшего UI. T0/T5/T10.
4. Мобильный клиент ушёл в фон, пропустил события или отозван: resync/denied без ложной актуальности и без скрытого повтора мутаций. T8/T9.
5. Объяснение относится к похожему коду другой ветки; импорт содержит враждебный путь/HTML: явно чужая область, никакого исполнения/выхода из scope. T2/T4/T7/T8.

## Этапы и проверяемые результаты

| Этап | Задачи | Результат, который можно использовать | Зависимость |
| --- | --- | --- | --- |
| M0 · Проверка стека | T0 | Собираемые оболочки, измеренный code viewer, доказанный маршрут телефона к host | — |
| M1 · Основа клиента | T1–T3 | Реальный репозиторий, код/diff, граф и устойчивые снимки | M0 |
| M2 · Главное отличие | T4 | Агент через MCP записывает объяснение; оно появляется у точного блока | M1 |
| M3 · Desktop MVP | T5–T7 + desktop часть T10 | Git-операции, память/переносимость, учебный разбор; критерии A01–A29 | M2 |
| M4 · Remote | T8 | Второй desktop подключается к Linux/macOS/Windows host, читает код и ставит отметки | M2; для полной приёмки нужен M3 |
| M5 · Mobile / Connected MVP | T9 + оставшаяся T10 | Установленные Android/iOS клиенты с remote и адаптированным UX | M3 + M4 |

M3 можно отдать в пользование до M5. Мобильная версия считается выполненной только на M5. После M1 UI и MCP имеют отдельные задачи, однако план не требует параллельных исполнителей.

Оценка порядка величины, не срок обещания: M0 4–7 инженерных дней; M1 10–15; M2 7–12; M3 18–30; M4 8–14; M5 12–20. Всего 59–98 инженерных дней при опытном full-time разработчике, включая проверки и упаковку; добавить 20–30% резерва на обнаруженные риски. Ожидание магазинов, сертификатов и доступов сюда не входит. AI может сократить написание кода, но не заменяет проверку на ОС/устройствах. После M0 и M2 оценку пересчитать по фактическому темпу.

## Структура будущего проекта

Это планируемые пути, файлов пока нет. Не создавать пустую структуру заранее без задачи, которая её использует.

```text
apps/client/src/                  React: shell, code, git-log, memory, trace, connection
apps/client/src-tauri/            native bridge; desktop/mobile capabilities; secure-store
crates/protocol/src/              DTO, schemas, error codes; TS generation
crates/domain/src/                decisions, anchors, scopes, trace validation, review policy
crates/storage/src/               SQLite migrations, event transaction, snapshots, FTS
crates/git/src/                   Git process runner, readers, index transaction, operations
crates/host/src/                  single owner lifecycle, local IPC, event broker, remote API
crates/mcp/src/                   stdio/HTTP gateways + tool mapping; no database writer
crates/admin/src/                 локальная CLI: repo register, remote, pairing, revoke
packages/api/src/                generated types + client interface
packages/ui/src/                 themes + shared accessible primitives
packages/fixtures/               demo code/trace/diagram and expected state manifests
scripts/                         reproducible repo generation, packaging and smoke commands
```

DTO живут только в `crates/protocol`; TS генерируется, ручной дубликат запрещён. Domain не импортирует Tauri/Axum; transport не имеет прямого SQL/Git. Общая БД на профиль host находится в каталоге приложения вне worktree; mobile её не синхронизирует.

## Контракт v1 для задач

Типы, которые T1 определяет в `crates/protocol/src/lib.rs` и экспортирует в `packages/api/src/generated.ts`:

- `RepoId`, `WorktreeId`, `SnapshotId`, `ComparisonId`, `EventId`, `DecisionId`, `DeviceId`: непрозрачные UUID-строки; `Generation`: непрозрачный fingerprint HEAD/index/наблюдаемой области worktree; `Cursor`: непрозрачная строка.
- `RepoPath`: относительный путь; wire хранит display-строку и base64 raw bytes/UTF16 representation с encoding tag. UI не превращает display обратно в путь для команды.
- `RequestMeta { schema_version: u32, request_id: UUID, idempotency_key: Option<UUID> }`; все write требуют key, повтор с другим payload → `IDEMPOTENCY_CONFLICT`.
- `Principal = LocalUser | McpSession{session_id} | RemoteDevice{device_id}`; формируется только host transport. Все request payload без роли пользователя.
- `AppError { code, message, retryable }`: `STALE_STATE`, `REVISION_CONFLICT`, `SCOPE_DENIED`, `UNSUPPORTED_VERSION`, `RESYNC_REQUIRED`, `HOST_OFFLINE`, `CAPABILITY_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`.
- `RepoState { repo_id, worktree_id, generation, head_oid, branch, status_entries, capabilities }`.
- `Snapshot { id, repo_id, worktree_id, layer: Head|Index|Worktree|Commit{oid}|Imported, generation, files: Vec<SnapshotFile>, exclusions, captured_at }`; SnapshotFile содержит raw path, state Present|Absent|Conflicted, sha256, optional blob OID, bytes, encoding, newline mode; для conflicted index сохраняются stages 1/2/3. `CapturedState { head_snapshot_id, index_snapshot_id, worktree_snapshot_id, generation }` фиксирует согласованные слои выбранной области; сохранение только worktree-текста недостаточно.
- `Comparison { id, base_snapshot_id, target_snapshot_id, file_pairs: Vec<{old_path,new_path}>, diff_algorithm_version }` — неизменяемые две стороны diff; deleted/renamed файлы явно представлены отсутствующим или другим путём. `DiffHunk {comparison_id,hunk_id,old_range,new_range,lines}` и line IDs детерминированы exact bytes + версией алгоритма. Whitespace display не меняет эти IDs/patch. Захваченные bytes обеих сторон хранятся вне Git GC.
- `Anchor { comparison_id, snapshot_id, path, side: Old|New, start_line, end_line, content_hash, context_hash, symbol: Option<String> }`; `Old` всегда означает base endpoint указанного Comparison, `New` — target endpoint; snapshot_id обязан совпасть с этой стороной. Исходный immutable anchor не переписывать при отображении relocated-кандидата.
- `DecisionInput { session_id, snapshot_id, rationale, alternatives, anchors, source }`; `WriteReceipt { event_id, entity_id, revision }`.
- `DecisionView { id, revision, lifecycle, applicability: Exact|Relocated|Stale|Ambiguous|Missing, anchors, rationale, alternatives, evidence_refs, source }`.
- `EventEnvelope { seq: u64, event_id, repo_id, schema_version, kind, entity_id, snapshot_id }`; payload события не содержит весь код/секреты; каждый client запрашивает детали с проверкой scope.
- `ReadRequest = GetRepoState | ListHistory{cursor,limit} | ReadSnapshotFile | GetDecisions | GetContext | GetTrace | GetDiagram | ListWorktrees`; каждое значение содержит repo/worktree scope и snapshot/ref там, где важно. `GetComparison{comparison_id}` возвращает обе immutable стороны; `CreateComparison{base_snapshot_id,target_snapshot_id}` материализует comparison без изменения Git.
- `GitCommand = Init | Clone | CreateBranch | SwitchBranch | StageFile | UnstageFile | StageSelection | UnstageSelection | Commit | Fetch | PullFastForward | Push` с типизированными параметрами; raw argv API отсутствует.
- `GitOperation { id, state: Pending|Running|Succeeded|Failed|Cancelled, progress, before_generation, after_generation, error }`.
- `ReviewMark { base_snapshot_id, snapshot_id, anchor, reviewer_id, reviewed: bool }`; reviewer ID задаёт host из Principal; это не принятие решения. `HumanDecisionReview { decision_id, decision_revision, base_snapshot_id, snapshot_id, anchor, state: Unreviewed|Reviewed|Accepted|Question, note }` создаётся отдельной локальной UI-командой; Accepted/Question недоступны MCP/remote MVP.

Wire API и schema fixtures уточняются в T1, не меняя перечисленную семантику. Unsupported major version отклоняется до чтения данных; capabilities отвечают за необязательные возможности.

## T0 · Доказать пригодность стека до основной разработки

**Files:** create `spikes/platform-probe/`, `docs/architecture/compatibility.md`, `docs/architecture/m0-results.md`, `scripts/bench-fixtures.ts`; сохранить отдельный throwaway status spike.
**Interfaces:** consumes демонстрационный C# из макета; produces зафиксированные toolchain/OS/Git versions, CM6 spike, protocol hello `{schemaVersion:1}` и решение go/no-go.

- [ ] Создать React/Tauri probe: read-only CM6 с C#/TS/Python, Gruvbox, annotations, unified/split diff; поставить минимальный Rust echo-host рядом с ним. Не переносить макет как production-монолит.
- [ ] Собрать macOS/Windows и Android/iOS shell; установить на физические устройства; проверить selection/copy, tap explanation, масштаб текста, экранную клавиатуру там, где есть ввод, screen reader, lifecycle, secure-store roundtrip и HTTPS/SSE к host. Таблица фактических версий обязательна.
- [ ] Сгенерировать fixtures 10k files/100k commits/1000 changed files и файл >2 MiB. Измерить CM6/граф и кандидатов нормального/облегчённого просмотра; записать холодные/тёплые результаты, модель устройства и размер приложения/RAM без выдуманных целей footprint.
- [ ] Проверить Git из packaged GUI, установленный Rider AI Assistant и наличие stdio MCP; проверить доступность signing/devices/CI для всех целевых платформ. При недоступности host IDE записать замену Cursor, не подменять доказательство документацией.
- [ ] Run: `pnpm --dir spikes/platform-probe test` и платформенные build-команды, записанные в compatibility.md. Gate: 0 потерянных selection/tap действий в контрольном сценарии, нет UI freeze, persistent token не виден JS, рабочий SSE reconnect; ≥4.5:1 у основного текста на diff-заливках. Если mobile WebView непригоден, вернуться к React Native companion до T1.
- [ ] Зафиксировать spike/report отдельным commit `chore: validate desktop and mobile stack`; exact dependency versions/lockfiles перенести в production только после go.

## T1 · Контракт, host и устойчивое хранилище

**Files:** create `Cargo.toml`, `pnpm-workspace.yaml`, `rust-toolchain.toml`, `crates/protocol/src/lib.rs`, `crates/storage/{src/lib.rs,migrations/001.sql,tests/durability.rs}`, `crates/host/src/{main.rs,local_ipc.rs}`, `packages/api/src/{generated.ts,client.ts}`, `scripts/check-contracts.ts`.
**Interfaces:** produces `HostService::read(principal, ReadRequest) -> Result<ReadResponse,AppError>`, `Store::append(meta, event, snapshots) -> Result<WriteReceipt,AppError>`, generated TS `HostClient.request<T>(request): Promise<T>`; one host profile lock.

- [ ] Add failing tests `duplicate_write_returns_same_id`, `different_payload_same_key_conflicts`, `crash_before_ack_recovers`, `two_gateways_one_writer`, `unsupported_schema_rejected`. Assertions: repeated key → identical durable ID; uncommitted event invisible after restart; acked event and selected snapshot both present.
- [ ] Run `cargo test -p agai-storage --test durability` → FAIL before implementation.
- [ ] Implement transactional SQLite snapshots/events + rebuildable projections/FTS, migration backup/rollback policy; length-bounded IPC records, OS user ACLs, startup singleton lock. Code content/path never interpolated into SQL/log statements.
- [ ] Run test above, `cargo test -p agai-protocol`, `pnpm contracts:check` → PASS; contract generation produces no diff. Validate paths containing Unicode, newline and invalid UTF8 without lossy command roundtrip.
- [ ] Commit only task files: `feat: add host protocol and durable event store`.

> Execution update 2026-10-30: T1 completed for macOS (`d76a496`). Future feature DTOs follow their implementations. Historical checklist wording above is retained; actual test names and evidence are in `docs/architecture/storage-and-ipc.md`.

## T2 · Git-чтение, снимки и актуальность anchors

**Files:** create `crates/git/src/{reader.rs,runner.rs}`, `crates/git/tests/read_repo.rs`, `crates/domain/src/{snapshot.rs,anchors.rs,scope.rs}`, `crates/domain/tests/snapshot_anchor.rs`, `crates/host/src/watch.rs`.
**Interfaces:** consumes T1; produces `GitReader::state(worktree) -> RepoState`, `history(worktree,cursor,limit) -> HistoryPage`, `SnapshotService::capture(session,paths,expected_generation) -> CapturedState`, `AnchorResolver::resolve(anchor,target_snapshot) -> AnchorResolution`.

- [ ] Add failing integration fixtures for dirty baseline, linked worktree, rename, CRLF/Unicode, duplicated function bodies, пары worktree/index, index/HEAD и commit/commit, rename/delete на каждой стороне, unmerged index stages, rebase/squash, GC, symlink escape and file >2 MiB. Assert original content survives Git GC; duplicate candidate → Ambiguous; changed content → Stale; never silently Exact.
- [ ] Run `cargo test -p agai-git --test read_repo` and `cargo test -p agai-domain --test snapshot_anchor` → FAIL.
- [ ] Implement argv Git reader with `-z` output where supported, pagination, bounded process output/cancellation, file watcher coalescing + rescan on missed notifications. Snapshot capture сохраняет HEAD/index/worktree как разные immutable manifests; сравнение материализует выбранные bytes обеих сторон в SQLite до выдачи comparison ID. Snapshot reads verify content/generation before and after capture; retry bounded or STALE_STATE. Manifest distinguishes exclusions.
- [ ] Run both suites → PASS; watch p95 ≤1 sec, hot first useful graph ≤2 sec, cold ≤5 sec on recorded fixtures. Head/ref graph uses true parent edges, not arrival order.
- [ ] Commit `feat: read repositories and bind explanations to snapshots`.

> Execution update 2026-10-30: T2 backend completed for macOS; see `docs/architecture/t2-results.md` for regression, review fixes and scope decisions. Backend timing passed; rendered graph and controlled cold-cache measurements remain T3/T10. T0 multi-platform gate remains open under the user-authorized macOS-only continuation.

## T3 · Desktop code workspace и нижний Git Log

**Files:** create `apps/client/src/{app.tsx,features/code/CodeWorkspace.tsx,features/code/CodeReader.tsx,features/git-log/GitLog.tsx,features/explanation/ExplanationPanel.tsx}`, `packages/ui/src/gruvbox.css`, `apps/client/tests/workspace.test.tsx`, `apps/client/e2e/workspace.spec.ts`, `apps/client/src-tauri/src/bridge.rs`.
**Interfaces:** consumes generated HostClient/ReadRequest; produces `CodeSelection {comparisonId,snapshotId,path,startLine,endLine}`, `openRevision(selection): void`; provider is identical for local and future remote transport.

- [ ] Add failing tests: branch click only filters; commit click changes details without checkout; working tab preserves scroll when opening historical revision; explanation panel/popover keyboard and tap have same target; stale update never silently swaps file.
- [ ] Run `pnpm --filter @agai/client test -- workspace` → FAIL.
- [ ] Implement read-only tabs, tree All/Changed, search/folding/breadcrumbs, version labels, unified/split diff, режимы worktree↔index/index↔HEAD/commit↔commit/snapshot↔snapshot, раскрываемые удаления и старая версия удалённого файла, whitespace-toggle только для вида, resizable Git dock ~30% initial height, virtualized lanes and filtered rows, explanation placeholder with exact absence/stale state. Gruvbox default and optional light theme; independent diff/trace/selection markers; переход к строке и безопасное открытие IDE/терминала с разрешёнными path/argv.
- [ ] Run `pnpm --filter @agai/client test -- workspace` and `pnpm e2e -- workspace` → PASS. Check 1280/1024/390 widths, keyboard and screen-reader labels; hot file switch ≤200 ms (≤2000 lines). Playwright proves React, packaged app is checked separately.
- [ ] Commit `feat: add code centered desktop workspace`.

> Execution update 2026-10-30: T3 implementation committed as `6997fbd`, with final-review corrections following. See `docs/architecture/t3-results.md` for tests, performance, scope decisions and two deferred minors. The corrected macOS bundle builds; final manual Quit lifecycle recheck awaits Mac unlock. T3 native acceptance is not declared fully closed until that check.

## T4 · MCP, объяснения и история решений — первый end-to-end сценарий

**Files:** create `crates/mcp/src/{main.rs,tools.rs}`, `crates/domain/src/{decisions.rs,context.rs,evidence.rs}`, `crates/domain/tests/decision_history.rs`, `crates/mcp/tests/tools.rs`, `crates/mcp/tests/transport_parity.rs`, `apps/client/src/features/explanation/DecisionHistory.tsx`, `docs/integrations/rider.md`.
**Interfaces:** consumes T1/T2/T3; produces `DecisionService::record(meta,principal,DecisionInput) -> WriteReceipt`, `supersede(meta,id,expected_revision,new_input) -> WriteReceipt`, `ContextService::get(scope,budget,cursor) -> ContextPage` and all 10 domain MCP tools плюс `integration_guide`, server/tool instructions, versioned inputSchema по `contracts/mcp/v1/tool-inputs.schema.json`. Для передачи tool inputSchema разрешить общие $refs в самодостаточную схему; проверка не должна зависеть от пути на диске автора.

- [ ] Add failing tests for record/retry/conflicting supersede, mixed authorship on dirty baseline, scope of other branch, agent evidence vs runner evidence, `acceptedByHuman` injection, missing tool calls/partial session, local Accepted сохраняется только для исходной пары снимков, remote Reviewed не может стать Accepted. Assert conflict for obsolete revision; agent can never create LocalUser provenance.
- [ ] Run `cargo test -p agai-domain --test decision_history` and `cargo test -p agai-mcp --test tools` → FAIL.
- [ ] Implement stdio `agai-mcp` и отдельный loopback Streamable HTTP gateway через SDK; wire names snake_case из контракта v1. Add integration_guide с workflow/scopes/examples, server instructions поддерживаемой версии и точные descriptions/inputSchema; session_open возвращает next_actions. Resources/prompt дублируют guide, но тест tools-only client обязателен. HTTP: отдельный scoped token, Origin/Host validation, выключен по умолчанию; не смешивать с remote mobile auth. Add local UI HumanDecisionReview (просмотрено/принято/вопрос) отдельно от stage, с двумя snapshot IDs; изменение блока требует нового ревью. Копируемый запрос объяснения содержит task/path/range/snapshot, без автоматической отправки агенту. Краткий/подробный режим, отсутствие альтернатив без выдумывания, покрытие блоков с определённым diff-знаменателем. Store schema/IDs/history, conservative relevance filters + FTS, explicit truncation/cursor. `trace_record`/`diagram_record` accept validated v1 schemas from T6; publish capability only when implemented, never fake successful tool output.
- [ ] Run suites → PASS; два независимых harness (Rider AI Assistant/stdio и Cursor/Streamable HTTP либо зафиксированные замены) проходят одинаковый сценарий; каждый creates session, edits example, captures snapshot, records rationale/alternative/evidence, supersedes after second change. User sees both versions linked to code; missing rationale remains missing. Save actual host/version/config and redacted protocol transcript. Validate tools-only discovery, missing server instructions, incompatible version, invalid schema, credential rejection, parity/retry/cancellation through both transports; без успешного обоих транспортов MCP milestone не завершён.
- [ ] Commit `feat: record agent decisions through MCP`. Demo milestone: реальная правка → объяснение в клиенте, без ручного изменения БД.

## T5 · Полный Git-набор MVP

**Files:** create `crates/git/src/{operations.rs,index_transaction.rs,credentials.rs}`, `crates/git/tests/{operations.rs,stage_races.rs}`, `apps/client/src/features/git-actions/{StageSelection.tsx,CommitPanel.tsx,RemoteActions.tsx}`.
**Interfaces:** consumes T2 `RepoState`; produces `GitService::start(principal,GitCommand,expected_generation) -> OperationId`, `cancel(id) -> GitOperation`, `prepareSelection(comparison_id,hunk_id,line_ids) -> PreparedPatch`.

- [ ] Add failing tests for init/clone, branch create/switch, stage/unstage file/hunk/arbitrary selected lines including deletions, commit, fetch/ff-pull/push to local bare remote; verify exact index bytes and untouched unselected changes. Add hooks failure, missing SSH/helper, cancellation, index.lock and external index/ref writer races; linked worktrees share mutation serialization by common Git dir.
- [ ] Run `cargo test -p agai-git --test operations` and `cargo test -p agai-git --test stage_races` → FAIL.
- [ ] Implement Git CLI operations with scoped paths and structured progress. For partial index writes: prepare against captured blobs in isolated temporary index, acquire Git-compatible index lock, compare live index fingerprint/HEAD to expected state, atomically replace index only on match, clean only owned lock/temp files. Revalidate selected worktree content and report remaining external changes; no claim of atomic lock against arbitrary editor writes.
- [ ] Pull default ff-only; diverged/conflicted repo shows exact state and opens external resolver/IDE. No automatic stash/reset/force push. Git credential helper/SSH/GPG/hook behavior respects user environment; secrets absent from logs; missing support fails visibly. `cancel` reports actual final state if commit already completed.
- [ ] Run both suites + packaged GUI auth/cancel smoke → PASS; MCP/remote principals get SCOPE_DENIED for every mutation. ReviewMark changes never alter index.
- [ ] Commit `feat: add guarded git operations and partial staging`.

## T6 · Учебный debugger и диаграммы

**Files:** create `crates/protocol/src/{trace.rs,diagram.rs}`, `crates/domain/src/trace.rs`, `apps/client/src/features/trace/{TracePlayer.tsx,transition.ts}`, `apps/client/src/features/diagram/DiagramPanel.tsx`, `packages/fixtures/trace-v1.json`, `apps/client/tests/trace.test.ts`.
**Interfaces:** produces `TraceScenario {snapshot_id,inputs,assumptions,steps}`, `TraceStep {id,phase,location,frames,locals,explanation,next,over,into,out,result}`, `transition(scenario,stepId,action) -> StepId`; Diagram `{snapshot_id,nodes,edges,source}` with node anchors.

- [ ] Add failing tests: resource30/cost20 →10, normalized direction, ticks10, active=true, return=true; resource10 →10, no direction/active change, return=false. Assert before line10 value30, before line11 value10; frame selection does not advance step; over and into/out reach same result; completed stack empty.
- [ ] Run `pnpm --filter @agai/client test -- trace` → FAIL.
- [ ] Implement deterministic viewer, typed locals/deltas vs previously viewed snapshot, caller navigation, validated watch values from model (no eval), same snapshot for source and frames. Validate frame nesting/step links, unknown conditions explicit; no arbitrary JS in trace. Complete MCP trace/diagram capability from T4.
- [ ] Render only validated diagram schema via React Flow/ELK; node click opens exact revision; unknown/inferred edges labelled; textual edge list. Run tests → PASS; stale trace/diagram cannot masquerade as current. Keyboard/touch checks in packaged shell.
- [ ] Commit `feat: add explained trace playback and linked diagrams`.

## T7 · Память, экспорт/импорт и управление сохранёнными данными

**Files:** create `crates/domain/src/{memory.rs,bundle.rs,redaction.rs}`, `crates/domain/tests/bundle.rs`, `apps/client/src/features/memory/MemoryView.tsx`, `apps/client/src/features/export/BundlePreview.tsx`.
**Interfaces:** produces `MemoryService::search(scope,query,cursor) -> DecisionPage`, `BundleService::preview/export/import(manifest,mapping) -> BundleReport`, `RedactionService::erase(selection) -> RedactionReceipt`.

- [ ] Add failing tests for retained superseded decisions, scope/author filters, FTS rebuild, preview exclusions, import collision/retry, Git object mismatch, ZIP traversal/bomb, malicious HTML, redaction of stored snapshot/event/index. Import leaves worktree/refs unchanged.
- [ ] Run `cargo test -p agai-domain --test bundle` → FAIL.
- [ ] Implement versioned zip manifest + explicit selected snapshots, hash validation, bounded decompression, opaque source IDs and reviewed mapping. Reject escaping/absolute paths and unknown major schema; imported human claims keep external provenance. User deletion rewrites sensitive payloads and derived stores, records tombstone; include SQLite WAL/checkpoint and owned backup handling, explain separately exported copies cannot be erased remotely.
- [ ] Run test → PASS; disable network and read local code/history/explanations/memory/trace; corruption of FTS recovers from events. UI success of export names the selected output, not a promise to synchronize devices.
- [ ] Commit `feat: add project memory and portable context bundles`.

## T8 · Headless host и приватный remote API

**Files:** create `crates/host/src/remote/{routes.rs,auth.rs,pairing.rs,events.rs}`, `crates/host/tests/remote.rs`, `apps/client/src/features/connection/{HostPicker.tsx,PairingPanel.tsx}`, `docs/remote-setup.md`, `packaging/systemd/agai-host.service`, `crates/admin/src/main.rs`, `crates/admin/tests/headless_bootstrap.rs`.
**Interfaces:** consumes HostService; produces `/v1/hello`, `/v1/pair/request`, `/v1/pair/status`, `/v1/read`, `/v1/reviews`, `/v1/events?after=...`; local IPC `create_invitation(repo_ids)` / `approve_pairing(id)` / `revoke_device(id)`; native `RemoteHostClient` implements T1 HostClient. Локальная CLI `agai-admin repo register PATH`, `remote enable|disable`, `pair create --repo ID`, `pair list`, `pair approve ID`, `devices list`, `devices revoke ID` обращается к тому же IPC под тем же OS-пользователем; не принимает arbitrary remote RPC.

- [ ] Add failing tests for expired/reused 5-min invitation, scope escalation, revoked token and active stream, cursor replay/gap, incompatible client, out-of-scope snapshot, hostile Origin and token leakage in URL/log; remote routes cannot reach Git writes, session tools or local arbitrary RPC.
- [ ] Run `cargo test -p agai-host --test remote` → FAIL.
- [ ] Implement ADR pairing (256-bit secrets, hashed stored tokens, rate limit, local approval), loopback-only listener off by default, bearer auth per request and event scope, SSE reconnect with RESYNC_REQUIRED. Auth never trusts client-supplied Principal or a forwarded header by itself. Headless bootstrap: пользователь по SSH запускает локальную CLI на сервере под выделенным непривилегированным владельцем service/profile, регистрирует путь, включает remote, создаёт приглашение и подтверждает телефон через `pair list/approve`; после привязки отзыв также через CLI. Invite выдаётся только по явной команде, не записывается в обычные логи. Host startup/profile/version handshake works without Tauri and uses systemd only when user enables it.
- [ ] Run suites and `cargo test -p agai-admin --test headless_bootstrap` → PASS (register → invite → request → local approve → read → revoke без GUI; другой UID запрещён); deploy to a test Linux x64 host and connect a second installed desktop client through Tailscale Serve. Inspect selected repo only, mark snapshot reviewed, revoke device and verify denial/closed stream. API stays private in tailnet. No implementation task publishes a public endpoint automatically.
- [ ] Commit `feat: add paired remote access to repository host`.

## T9 · Android/iOS companion

**Files:** create `apps/client/src/features/mobile/{MobileWorkspace.tsx,CodeSheet.tsx,MobileGitLog.tsx}`, `apps/client/src-tauri/src/secure_store.rs`, native Swift/Kotlin secure-store implementation under `apps/client/src-tauri/plugins/secure-store/`, `apps/client/tests/mobile.test.tsx`, `docs/qa/mobile.md`.
**Interfaces:** consumes RemoteHostClient, CodeSelection, trace/diagram schemas; produces native `pair(invitation)`, `disconnect(hostId)`, `request(hostId,ReadRequest)` and `markReviewed(ReviewMark)` without exposing credential values to JS.

- [ ] Add failing UI/transport tests for tap without hover, phone/pad layout, notch/safe area, large fonts, selected snapshot after reconnect, background stream closure, review response lost after durable write, revocation, cold-start offline. No mutation retry on changed snapshot; explicit revalidation/retry with same idempotency key.
- [ ] Run `pnpm --filter @agai/client test -- mobile` → FAIL.
- [ ] Implement native secure-store using mechanisms proven in M0, transport adapters, host picker/pairing QR/manual invitation, one-file unified diff, bottom-sheet explanation, separate Git log screen and stack/locals tabs. Phone never builds desktop host binary or Git; data in memory only, no persistent code cache in MVP.
- [ ] Run suite → PASS; install signed development Android and iOS builds on real devices, pair over Wi-Fi and cellular/private network, switch apps, suspend/resume host, revoke device. Validate fonts/selection/accessibility/code-file navigation. Record expected offline limitation; no “always live” promise or silent push-notification claim.
- [ ] Commit `feat: add mobile code review companion`.

## T10 · Выпуск, восстановление и итоговая приёмка

**Files:** create `.github/workflows/{ci.yml,release.yml}`, `scripts/{benchmark.ts,acceptance.ts}`, `docs/qa/{acceptance-mvp.md,recovery.md}`, `packaging/` platform configs; modify README.
**Interfaces:** consumes T0–T9; produces signed installers/builds, compatibility matrix, redacted diagnostics, migration recovery procedure and evidence for each acceptance ID.

- [ ] Add recovery cases: process killed around commit/ack, old database upgrade, malformed import, lost watcher, failed updater, host restart with two IDEs, remote cursor gap. Verify no lost acknowledged event and no overwritten unrelated Git changes.
- [ ] Run `cargo test --workspace`, `pnpm test`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm e2e`, `pnpm bench` → PASS against fixture/hardware manifest. Measured p95: explanation ≤150 ms; durable event ≤250 ms excluding large snapshots; other targets in T2/T3 and ТЗ §16. Record limitations and actual distributions, not just green checkmarks.
- [ ] Package macOS notarized desktop outside Mac App Store, Windows signed installer; Android internal distribution and iOS TestFlight. Linux host release has checksums/signature and explicit install instructions. Requires user-owned signing accounts/certificates; no purchase/publishing action implied by this plan.
- [ ] Verify installed builds on target OS and real phones; UI-only Playwright tests do not certify Tauri IPC/native capabilities. Для packaged desktop использовать актуальный WebdriverIO Tauri service с embedded driver на macOS/Windows/Linux; plain tauri-driver сам по себе ограничен Windows/Linux. Test-only driver не включать в release artifacts. Реальные iOS/Android и подпись/установка проверяются отдельно. Test update/migration and recovery from failed update; do not silently downgrade migrated DB.
- [ ] Run acceptance matrix below; release D after desktop subset, R only after mobile/remote subset. Commit `chore: validate and package connected mvp`; tag/publish only under subsequent release instruction.

## Приёмка и соответствие ТЗ

| Критерии | Владелец | Свидетельство |
| --- | --- | --- |
| A01–A03, A21, A23–A24, A28 | T0/T3/T10 | Real code UI, keyboard/tap, themes, code+Git dock, no accidental checkout |
| A04–A06, A09, A17, A22 | T2/T4/T6/T8 | Exact/Stale/Ambiguous, baseline, scope, original snapshots after GC/rebase |
| A07–A08 | T5 | Index content after partial selection, external-writer race fixture |
| A10–A14, A29 | T1/T4 | Retry/conflict/provenance/context/missing MCP history evidence |
| A15 | T7 | Bundle preview/import, no worktree/ref mutation |
| A16, A18, A25–A27 | T6 | Expected trace states, frame selection, diagram anchor/source |
| A19–A20 | T1/T7/T10 | Crash recovery and desktop offline acceptance |
| R01 | T8 | Paired second computer reads only granted repos; mutation routes denied |
| R02 | T8/T9 | Reconnect without mixed snapshot; revoked device loses stream/access |
| R03 | T9 | Android and iOS installed builds, touch review/trace/code/history |
| R04 | T8/T9 | Host offline/sleep shown accurately; mobile cold-start has no offline code cache |
| R05 | T8/T10 | Headless Linux bootstrap/approve/revoke through local CLI over SSH without GUI; isolated profile ownership |

## Что сознательно остаётся после этого MVP

Полноценный Git 1.0 из ТЗ (merge UI/rebase/cherry-pick/stash/blame и прочее), remote Git mutations, удалённые команды агенту, собственный relay/accounts/team sync, mobile persistent offline-cache, notifications, реальные debugger traces и универсальный language server. Эти функции не потеряны: они отдельный backlog следующего выпуска, не условия скрытого «готово» MVP.

## Следующая работа

Начать с M0/T0. До него не устанавливать стек и не переносить UI в production в рамках задачи планирования. По его результату утвердить зафиксированную матрицу платформ, доказать mobile code-viewer/remote и только затем выполнять T1–T10. Для исполнения рекомендую последовательную работу с отдельным ревью границ хранения, Git-мутаций и remote-auth; формат агентного выполнения выбирается при запуске реализации.


## Дополнение к плану — запуск 30 октября 2026

Пользователь разрешил последовательное исполнение с коммитами и проверками. Основные T0–T10 сохраняются; добавлены две самостоятельные задачи. Всего 13 крупных задач. Порядок: T0 → T1 → T2 → T3 → T4 → T5 → T6 → T3a → T6a → T7 → T8 → T9 → T10. T3/T4 включают упрощение интерфейса из §22 ТЗ; без новых верхнеуровневых режимов.

### T3a · Семантические связи и подсказки использований

- [ ] Выбрать и проверить адаптер анализа для C#, TS и Python; зафиксировать возможности отдельно по языкам и версиям. Универсальный language server остаётся вне MVP, но эти подсказки входят в согласованный объём.
- [ ] Определить DTO symbol/reference с ревизией, источником, полнотой и состоянием индексации; результаты другого snapshot не переиспользовать как точные.
- [ ] Сначала тесты overload/interface/override/read/write/неизвестный язык и устаревший индекс, затем реализация адаптера и подсказок.
- [ ] Проверить навигацию туда/назад, раскрытие связей, клавиатуру, неизвестное ≠ ноль; регрессия T2/T3/T4/T6. Критерий A30.
- [ ] Отдельный commit после зелёных проверок; непроверенные языки не объявлять поддержанными.

### T6a · Необязательные объяснения конструкций языка

- [ ] Подготовить версионированную справку с источниками и выбором по языку/контексту; неизвестные конструкции явно неподдерживаемые.
- [ ] Сначала тесты различения sealed class/sealed override и отсутствующего авторского мотива, затем карточка с примером и контекстным действием.
- [ ] Проверить клавиатуру/touch, отсутствие автоматических попапов, независимость от AI-проверок; регрессия T3/T4/T6/T3a. Критерий A31.
- [ ] Отдельный commit после проверок.

Регрессионные рубежи: после T2 — protocol/storage/Git reads; после T4 — repo→snapshot→MCP→объяснение; после T5 — все Git-чтения/записи и защита index; после T6a — код/связи/объяснения/разбор; после T7 — сохранение/восстановление/импорт; после T8/T9 — auth/scope/reconnect и desktop; T10 — вся матрица. Каждая задача запускает собственные тесты и затронутые ранее реализованные тесты до коммита. Не прошедшая платформенная приёмка остаётся незавершённой, даже если unit-тесты зелёные.
