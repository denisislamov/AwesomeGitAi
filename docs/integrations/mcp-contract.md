# MCP: как любой совместимый harness узнаёт, что передавать

Статус: проект контракта v1 и готовые материалы для интеграции, не работающий MCP-сервер. Публичный репозиторий не является MCP endpoint. Реализация обязательна в M2/T4 плана; прежнее название этапа не меняет этот критерий.

## Три слоя инструкций

1. **Инструкция сервера.** Поддерживаемый механизм server instructions выбранной версии MCP плюс краткие tool descriptions объясняют назначение сервера. Не рассчитываем, что каждый harness автоматически прочитает server instructions.
2. **Обнаруживаемый инструмент `integration_guide`.** Возвращает contract version, workflow, scopes, required fields, примеры, ограничения и подсказки восстановления. Доступен также клиентам, которые умеют только tools. Остальные инструменты ссылаются на него в description; `session_open` возвращает `next_actions`. Поэтому использование не зависит от поддержки resources/prompts.
3. **Необязательная переносимая инструкция.** [agent-bootstrap.md](agent-bootstrap.md) можно включить в AGENTS.md, правила IDE или задачу агенту. Позднее можно добавить skills для отдельных harness, но skill не является единственным носителем контракта.

Ресурс `agai://integration/v1` и prompt `agai_workflow` могут дублировать guide для harness, умеющих MCP resources/prompts. Это удобство, не обязательная предпосылка работы.

## Транспорты и совместимость

Обязательны **stdio** и **Streamable HTTP** на одном наборе инструментов. Стандартные транспорты описаны в [MCP specification](https://modelcontextprotocol.io/specification/latest/basic/transports). Версия протокола MCP и `schema_version` наших аргументов — разные вещи.

В M0 фиксируются реально поддерживаемые версии SDK и harness. На этапе T4 проверяются capabilities/version negotiation и одинаковые результаты обоих транспортов. Нельзя вручную закрепить устаревший initialize-handshake для всех будущих версий: transport/session plumbing предоставляет SDK выбранной версии, совместимость проверяется тестами.

HTTP MVP локальный, loopback-only, off по умолчанию, отдельный от mobile Remote API; отдельный scoped token из настроек host, Origin/Host validation, никакого cookie-login и wildcard CORS. Клиент, не умеющий безопасно передать credentials в HTTP, использует stdio. Токен не размещается в URL, примерах или git. Удалённый публичный HTTP MCP с OAuth/discovery — отдельное расширение, не переиспользование mobile pairing token. Удалённый harness может запускать stdio gateway на машине host по своему безопасному механизму запуска.

Фраза «любой harness» означает открытый протокол без зависимости от бренда IDE и публичные схемы. Проверенная совместимость публикуется отдельно по версиям; сервер не может заставить агента вызвать инструменты или передать отсутствующие данные.

Минимальная приёмка: Rider AI Assistant и ещё один независимый harness (предлагается Cursor), не менее одного реального подключения каждым транспортом; общий protocol conformance test на stdio/HTTP. При отсутствии доступа ко второму host выпуск не заявляется проверенным на нём. SDK/host версии и ограничения записываются в compatibility.md. Автосбор всех действий IDE — будущие адаптеры; базовый MCP хранит явно переданные события.

## Схемы и примеры

- [Валидируемый пакет inputSchema v1](../../contracts/mcp/v1/tool-inputs.schema.json): `$defs` соответствует имени инструмента. Сервер экспортирует соответствующий inputSchema через tools/list после реализации. Runtime Rust DTO и этот контракт должны проверяться на совпадение в CI.
- [Последовательность аргументов](../../examples/mcp/session-calls.json): fixture с синтетическими UUID/hashes. В реальной работе все repo/worktree/session/snapshot/comparison IDs и hashes берутся из ответов сервера. Это не JSON-RPC transcript и не готовая команда для запуска.
- Схема описывает форму. Семантическая проверка scope, существования ID, hash, версий, диапазона строк и происхождения обязательна на host. Успешная JSON Schema validation не означает, что anchor допустим.

| Инструмент | Когда | Основное содержание |
| --- | --- | --- |
| `integration_guide` | Перед первой сессией | schema version; ответ — инструкция и capabilities |
| `context_get` | Перед правками / при уточнении | repo/worktree, task, пути, budget, cursor |
| `session_open` | До первой правки | задача, заявленный actor, baseline generation |
| `snapshot_capture` | После логической группы правок | session, пути, expected generation |
| `decision_record` | Для решения | summary, behavior, rationale, constraints, alternatives, anchors |
| `event_append` | Существенное действие | action/question/clarification, source, причинные ссылки |
| `evidence_record` | После проверки | result, command/test, environment, snapshot, source |
| `decision_supersede` | Пересмотр решения | old ID/revision, новая запись, причина |
| `trace_record` | Учебное объяснение выполнения | frames, locals, переходы и explanatory text |
| `diagram_record` | Схема улучшает объяснение | nodes/edges/anchors, declared/inferred source |
| `session_close` | Итог / остановка | final snapshot, outcome, unresolved |

`summary`: «Не тратить ресурс при отклонённом рывке».
`behavior`: «При недостатке выносливости TryDash возвращает false, запас не меняется».
`rationale`: «Проверка и списание находятся в одном методе, вызывающий код не может пропустить проверку».
`alternatives`: «Проверить Current в вызывающем коде» с фактической причиной отказа — только если этот вариант действительно рассматривался.

## Ответы и ошибки

`integration_guide` возвращает доступные текущему principal repo/worktree IDs, понятные имена и наблюдаемую generation для выбора проекта. `context_get` обновляет generation и сообщает полноту/пропуски контекста. Это наблюдаемые версии, не блокировка файлов: `session_open` и `snapshot_capture` сверяют expected generation атомарно и возвращают `STALE_STATE` при изменениях. Нельзя угадывать ID или автоматически выбирать первый проект при неоднозначности.

Каждый write возвращает `WriteReceipt {event_id, entity_id, revision}` только после durable commit. `session_open` дополнительно возвращает session_id, baseline snapshots/generation и next_actions; `snapshot_capture` — слои HEAD/index/worktree, comparison IDs и anchors-кандидаты. Agent-аргумент `actor` — заявленный источник, не authentication principal; `source` не позволяет создать local-runner или человеческое подтверждение.

Ошибки `STALE_STATE`, `REVISION_CONFLICT`, `SCOPE_DENIED`, `UNSUPPORTED_VERSION`, `IDEMPOTENCY_CONFLICT` имеют структурированный code и понятный next_action. Повтор идентичного write с тем же key возвращает прежний receipt; другой payload с тем же key отклоняется. Курсор, token budget и omitted summary не создают иллюзию полной истории.

Trace/diagram schemas — минимальный исполняемый валидатором контракт модели. Они не разрешают исполнение кода. Проверка связности шагов/кадров, совпадения snapshot, return-stack и отсутствия out-of-scope anchors выполняется domain-валидатором. Derived diagram source из MCP всегда остаётся заявлением агента, пока отдельный trusted analyzer не подтвердил его.

## Что будет включено в первый запуск приложения

Экран «Подключить агента»: выбрать stdio/HTTP → получить конфигурацию с реальным путём к установленному binary → выполнить диагностический read → скопировать workflow-инструкцию при необходимости. Клиентские `mcpServers` форматы различаются: приложение выдаёт формат конкретного поддерживаемого harness и generic command/args либо URL. В репозитории до появления бинарника не публикуем команду, которая якобы уже работает.
