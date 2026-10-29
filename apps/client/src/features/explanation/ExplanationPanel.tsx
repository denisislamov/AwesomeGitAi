import React from "react";
import type { Workspace } from "../../workspace";
export function ExplanationPanel({ workspace }: { workspace: Workspace }) {
  const s = workspace.state;
  const tab = workspace.active();
  if (!s.explanationOpen) return null;
  const selection = s.selection;
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
        <h2>
          {tab?.stale
            ? "Снимок устарел"
            : selection
              ? "Пока нет объяснения"
              : "Выберите строки"}
        </h2>
        <p>
          {tab?.stale
            ? "Рабочая копия изменилась. Здесь остаётся прежний снимок; обновите его явно, чтобы читать новые изменения."
            : selection
              ? "Для этого фрагмента агент ещё не передал объяснение. Наличие подсветки diff не означает, что решение проверено."
              : "Выделите фрагмент кода и нажмите «Объяснить выделение». Здесь появятся суть решения, варианты и основания."}
        </p>
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
        <div className="quiet-note">
          Объяснения через MCP появятся на этапе T4. Автоматических выводов о
          мотивах автора сейчас нет.
        </div>
      </div>
    </aside>
  );
}
