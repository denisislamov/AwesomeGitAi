# Исполнение MVP

План: docs/superpowers/plans/2026-10-29-awesomegitai-mvp.md

## 2026-10-30 — старт T0

Последние UX-уточнения закреплены в §22 ТЗ; декомпозиция расширена до 13 задач. Все продуктовые задачи пока незавершены.

Выполнена проверка среды: Node v24.7.0; pnpm 9.15.4; Xcode выбран из /Applications/Xcode.app/Contents/Developer; iphoneos SDK 26.5; adb доступен. cargo/rustc отсутствуют в PATH и стандартном ~/.cargo/bin; tailscale отсутствует в PATH. Наличие adb/SDK не доказывает наличие подключённых устройств или signing. Windows, Android/iOS installation, secure-store и remote не проверены.

T0: in progress, только preflight. Сборки и тесты приложения ещё не запускались: исходников приложения нет. Следующий шаг — установить локальный toolchain, создать изолированный platform probe и выполнить сценарии T0. Gate T0 не пройден; T1 не начинать.

Рабочая ветка при старте: d.islamov/awesomegitai-design, чистый checkout. Текущий коммит фиксирует только требования/декомпозицию/preflight, не завершение T0.

## T0 local checkpoint

See docs/architecture/m0-results.md. User deferred Android and requested continued macOS/backend work. Provisional desktop go; original full T0 acceptance remains open. Four editor tests pass, Vite and macOS debug build verified, packaged Git hello works. T1 starts next on this explicitly limited basis.
