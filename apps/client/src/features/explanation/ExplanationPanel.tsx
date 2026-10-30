import React, { useMemo, useState } from "react";
import type { Workspace } from "../../workspace";
import type {
  AnchorResolution,
  DecisionView,
} from "../../../../../packages/api/src/generated";
import { coverage } from "./coverage";
const label = (r: AnchorResolution) =>
  typeof r === "object"
    ? "Привязка перенесена — проверьте контекст"
    : {
        Exact: "Точная версия",
        Stale: "Код изменился",
        Missing: "Фрагмент отсутствует",
        Ambiguous: "Несколько совпадений",
      }[r];
export function ExplanationPanel({ workspace }: { workspace: Workspace }) {
  const s = workspace.state,
    tab = workspace.active(),
    selection = s.selection;
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const counts = useMemo(
    () => (tab ? coverage(tab, s.explanations) : null),
    [tab, s.explanations],
  );
  if (!s.explanationOpen) return null;
  const visible = s.explanations.filter(
    (d) =>
      !selection ||
      d.anchors.some(
        (v) =>
          v.anchor.side === selection.side &&
          (typeof v.resolution === "object"
            ? v.resolution.Relocated.start_line <= selection.endLine &&
              v.resolution.Relocated.end_line >= selection.startLine
            : v.anchor.start_line <= selection.endLine &&
              v.anchor.end_line >= selection.startLine),
      ),
  );
  return (
    <aside
      aria-label="Объяснение"
      className={
        "explanation " + (s.explanationLayout === "popover" ? "popover" : "")
      }
    >
      <header>
        <span>Объяснение</span>
        <button
          aria-label="Закрыть объяснение"
          onClick={() => workspace.showExplanation(false)}
        >
          ×
        </button>
      </header>
      <div className="explanation-body">
        <span className="eyebrow">КОНТЕКСТ КОДА</span>
        {tab?.stale && (
          <p role="status">
            Снимок устарел. Рабочая копия изменилась; здесь остаётся прежняя
            версия кода.
          </p>
        )}
        <h2>
          {visible.length
            ? "Почему изменили код"
            : selection
              ? "Пока нет объяснения"
              : "Выберите строки"}
        </h2>
        {!visible.length && (
          <p>
            {selection
              ? "Для этого фрагмента агент ещё не передал объяснение. Наличие подсветки diff не означает, что решение проверено."
              : "Выделите фрагмент кода и нажмите «Объяснить выделение»."}
          </p>
        )}
        {selection && (
          <div className="context-card" data-testid="explanation-target">
            <strong>{selection.path.display}</strong>
            <br />
            {selection.side === "Old" ? "Старая" : "Новая"} сторона · строки{" "}
            {selection.startLine}–{selection.endLine}
            <br />
            <small>
              Снимок {selection.snapshotId.slice(0, 8)}
              <br />
              Сравнение {selection.comparisonId.slice(0, 8)}
            </small>
          </div>
        )}
        {counts && (
          <p className="quiet-note">
            Точно привязано объяснений: {counts.explained} из {counts.total}{" "}
            изменённых строк (обе стороны). Это покрытие объяснениями, не
            проверка корректности.
          </p>
        )}
        {s.explanationsError && (
          <p role="alert">
            Не удалось загрузить объяснения: {s.explanationsError}
          </p>
        )}
        {s.explanationsTruncated && (
          <p>Показаны последние 100 решений для файла.</p>
        )}
        {visible.map((d) => (
          <DecisionCard key={d.id} d={d} workspace={workspace} />
        ))}
        {tab && (
          <div className="explanation-actions">
            <button onClick={() => void workspace.refreshExplanations()}>
              Обновить объяснения
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    workspace.explanationRequest(),
                  );
                  setCopied(true);
                  setCopyError("");
                } catch {
                  setCopyError("Не удалось скопировать запрос");
                }
              }}
            >
              {copied ? "Запрос скопирован" : "Скопировать запрос агенту"}
            </button>
            {copyError && <p role="alert">{copyError}</p>}
          </div>
        )}
        <p className="quiet-note">
          Объяснения и результаты проверок передаёт агент через MCP. Приложение
          не приписывает автору неизвестные мотивы.
        </p>
      </div>
    </aside>
  );
}
function DecisionCard({
  d,
  workspace,
}: {
  d: DecisionView;
  workspace: Workspace;
}) {
  const [note, setNote] = useState("");
  const tab = workspace.active();
  const exact =
    tab?.data.base.id === d.base_snapshot_id &&
    tab?.data.target.id === d.target_snapshot_id;
  return (
    <article className="context-card decision-card">
      <small>
        Сообщено агентом · версия {d.revision}
        {d.superseded_by ? " · заменено новым решением" : ""}
      </small>
      <h3>{d.summary}</h3>
      <p>{d.behavior}</p>
      <p>{d.rationale}</p>
      {d.anchors.map((v, i) => (
        <p className="quiet-note" key={i}>
          {v.anchor.side === "Old" ? "До" : "После"} · строки{" "}
          {v.anchor.start_line}–{v.anchor.end_line} · {label(v.resolution)}
        </p>
      ))}
      {!exact && (
        <>
          <p>
            Другая пара снимков. Подтверждение доступно в исходном сравнении.
          </p>
          <button onClick={() => void workspace.openDecision(d.id)}>
            Открыть исходную версию
          </button>
        </>
      )}
      <details>
        <summary>Подробности и проверки</summary>
        <h4>Ограничения</h4>
        {d.constraints.length ? (
          <ul>
            {d.constraints.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        ) : (
          <p>Не указаны.</p>
        )}
        <h4>Рассмотренные варианты</h4>
        {d.alternatives.length ? (
          d.alternatives.map((v, i) => (
            <p key={i}>
              <strong>{v.description}</strong>
              <br />
              {v.reason_not_chosen}
            </p>
          ))
        ) : (
          <p>Агент не сообщил альтернативы.</p>
        )}
        <h4>Проверки — со слов агента</h4>
        {d.evidence.length ? (
          d.evidence.map((e, i) => (
            <p key={i}>
              <strong>
                {e.check} · {e.status}
              </strong>
              <br />
              {e.environment}
              <br />
              {e.summary}
            </p>
          ))
        ) : (
          <p>Подтверждений нет.</p>
        )}
        {d.supersedes && (
          <p>
            Заменяет решение {d.supersedes.slice(0, 8)}:{" "}
            {d.supersede_reason || "Причина не указана"}
          </p>
        )}
        {d.superseded_by && (
          <button onClick={() => void workspace.openDecision(d.superseded_by!)}>
            Открыть новую версию
          </button>
        )}
      </details>
      {d.review && (
        <p>
          Ваша отметка:{" "}
          {
            {
              Viewed: "Просмотрено",
              Accepted: "Принято",
              Question: "Есть вопрос",
            }[d.review.state]
          }
          {d.review.note && ` — ${d.review.note}`}
        </p>
      )}
      {exact && !d.superseded_by && (
        <div className="human-review">
          <label>
            Комментарий
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2048}
            />
          </label>
          <div className="explanation-actions">
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Viewed", note)
              }
            >
              Просмотрено
            </button>
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Accepted", note)
              }
            >
              Принято
            </button>
            <button
              onClick={() =>
                void workspace.reviewDecision(d.id, "Question", note)
              }
            >
              Есть вопрос
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
