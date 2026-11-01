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

### Улучшение объяснений после закрытия сессии

Для чтения старого снимка `context_get` принимает любой непустой поднабор путей этого снимка. Не требуется повторять все файлы сессии. Ответ содержит исходники только выбранных файлов и связанные сохранённые записи. Чтение с `snapshot_id` имеет `session_baseline: false` и не заменяет текущую рабочую базу для `session_open`; для новой сессии сначала вызови `context_get` без `snapshot_id`. `SNAPSHOT_PATH_OUT_OF_SCOPE` означает, что запрошенный путь не входил в снимок. Ошибка владельца/grant остаётся `SCOPE_DENIED`.

`decision_supersede` доступен для уже закрытой сессии тому же grant, которому принадлежат объяснение и сессия. Передай исходный `session_id`, ID текущей версии решения, её `expected_revision` и причину пересмотра. `context_get` включает `revision` в сохранённые источники; если контекст усечён, дочитай его через cursor. Не угадывай ревизию.

После закрытия можно менять `summary`, `behavior`, `rationale`, `constraints` и `alternatives`. `snapshot_id` и весь массив `anchors` должны остаться прежними. Изменение привязок возвращает `CLOSED_SESSION_SOURCE_CHANGE`; новая версия кода требует новой сессии. Устаревшая ревизия или попытка заменить уже заменённую запись возвращает `REVISION_CONFLICT`. Идентичный повтор с тем же idempotency key возвращает исходный receipt.

Старая запись сохраняет текст, получает `superseded_by`, новая — `supersedes` и `supersede_reason`; обновление атомарно. Закрытая сессия и её итог не изменяются. Дополнительную diagram можно записать по уже принадлежащему этой сессии снимку; она сохраняется как post_session. Новые решения, снимки, evidence и trace в закрытую сессию записывать нельзя. Человеческое принятие и свидетельства старой записи не переносятся автоматически на новую.

## Ответы и ошибки

`integration_guide` возвращает доступные текущему principal repo/worktree IDs, понятные имена и наблюдаемую generation для выбора проекта. `context_get` обновляет generation и сообщает полноту/пропуски контекста. Это наблюдаемые версии, не блокировка файлов: `session_open` и `snapshot_capture` сверяют expected generation с выбранными файлами; захват дополнительно перепроверяет байты и возвращают `STALE_STATE` при изменениях. Нельзя угадывать ID или автоматически выбирать первый проект при неоднозначности.

Каждый write возвращает специфичный для инструмента receipt (`session_id`, `decision_id`, `id` или `snapshot_id`, с revision где применимо) только после durable commit. Идентичный повтор возвращает тот же JSON. `session_open` дополнительно возвращает session_id, baseline snapshots/generation и next_actions; `snapshot_capture` — IDs слоёв HEAD/index/worktree и comparison. Номера строк и content_hash агент вычисляет по точным исходным байтам; host проверяет их. Agent-аргумент `actor` — заявленный источник, не authentication principal; `source` не позволяет создать local-runner или человеческое подтверждение.

Ошибки `STALE_STATE`, `REVISION_CONFLICT`, `SCOPE_DENIED`, `UNSUPPORTED_VERSION`, `IDEMPOTENCY_CONFLICT` имеют структурированный code и понятный next_action. Повтор идентичного write с тем же key возвращает прежний receipt; другой payload с тем же key отклоняется. Курсор, token budget и omitted summary не создают иллюзию полной истории.

Trace/diagram schemas — минимальный исполняемый валидатором контракт модели. Они не разрешают исполнение кода. Проверка связности шагов/кадров, совпадения snapshot, return-stack и отсутствия out-of-scope anchors выполняется domain-валидатором. Derived diagram source из MCP всегда остаётся заявлением агента, пока отдельный trusted analyzer не подтвердил его.

## Подключение в текущем macOS MVP

Кнопка «Подключить MCP» выполняет диагностический read локального host и выдаёт generic `mcpServers` JSON с реальным binary/profile/repo/grant-file и копируемую инструкцию. Специфические настройки IDE различаются. Stdio готов сразу; loopback HTTP включается вручную с отдельным private token-файлом по [инструкции gateway](../../crates/mcp/README.md). На macOS MCP сам запускает локальный хост при необходимости; приложение можно закрывать. После обновления переподключите MCP один раз, чтобы загрузить новый gateway.
