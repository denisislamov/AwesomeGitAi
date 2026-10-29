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
