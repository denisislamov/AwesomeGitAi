import React, { useState } from "react";
import type { Workspace } from "../../workspace";
export function GitControls({ workspace: w }: { workspace: Workspace }) {
  const s = w.state;
  const [message, setMessage] = useState(""),
    [branch, setBranch] = useState(""),
    [remote, setRemote] = useState(""),
    [target, setTarget] = useState("");
  const busy =
    s.gitStarting || s.gitJob?.status === "Running" || s.openingRepository;
  const remoteName = s.gitRemotes.includes(remote)
    ? remote
    : (s.gitRemotes[0] ?? "");
  const targetName = target || s.repo?.branch || "";
  return (
    <details className="git-controls">
      <summary>Git-операции · staging, ветки, синхронизация</summary>
      <fieldset disabled={busy || !s.repo}>
        <legend>Коммит</legend>
        <p>
          {s.repo?.status_entries.filter(
            (e) =>
              e.status[0] !== "." && e.status[0] !== " " && e.status[0] !== "?",
          ).length ?? 0}{" "}
          файлов в Index. В коммит попадёт только Index.
        </p>
        <textarea
          aria-label="Сообщение коммита"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Что изменилось и зачем?"
          rows={2}
        />
        <button
          disabled={!message.trim()}
          onClick={() => void w.runGit({ kind: "Commit", message })}
        >
          Создать коммит
        </button>
      </fieldset>
      <fieldset disabled={busy || !s.repo}>
        <legend>Ветки</legend>
        <input
          aria-label="Новая ветка"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="feature/name"
        />
        <button
          disabled={!branch}
          onClick={() => void w.runGit({ kind: "CreateBranch", name: branch })}
        >
          Создать ветку
        </button>
        <select
          aria-label="Переключить ветку"
          value=""
          onChange={(e) =>
            void w.runGit({ kind: "SwitchBranch", name: e.target.value })
          }
        >
          <option value="">Переключить на…</option>
          {s.branches
            .filter((b) => !b.remote)
            .map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
        </select>
      </fieldset>
      <fieldset disabled={busy || !s.repo || !remoteName}>
        <legend>Удалённый репозиторий</legend>
        <select
          aria-label="Git remote"
          value={remoteName}
          onChange={(e) => setRemote(e.target.value)}
        >
          {s.gitRemotes.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input
          aria-label="Удалённая ветка"
          value={targetName}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="main"
        />
        <button
          onClick={() => void w.runGit({ kind: "Fetch", remote: remoteName })}
        >
          Fetch
        </button>
        <button
          disabled={!targetName}
          onClick={() =>
            void w.runGit({
              kind: "Pull",
              remote: remoteName,
              branch: targetName,
            })
          }
        >
          Pull · только fast-forward
        </button>
        <button
          disabled={!targetName}
          onClick={() =>
            void w.runGit({
              kind: "Push",
              remote: remoteName,
              branch: targetName,
            })
          }
        >
          Push HEAD → {targetName}
        </button>
      </fieldset>
      {s.repo && s.gitRemotes.length === 0 && (
        <p>Remote не настроен. Его можно добавить в терминале.</p>
      )}
      <p className="hint">
        Git использует ваши hooks, SSH, credential helper и подпись. Пароли в
        приложении не сохраняются.
      </p>
    </details>
  );
}
export function GitJobStatus({ workspace: w }: { workspace: Workspace }) {
  const j = w.state.gitJob;
  if (!j) return null;
  return (
    <div className="git-job" role="status">
      <span>
        {j.root.split("/").at(-1)} ·{" "}
        {(
          {
            Running: "Git выполняется…",
            Succeeded: "Git: готово",
            Failed: "Git: ошибка",
            Cancelled: "Запрошена отмена",
          } as Record<string, string>
        )[j.status] ?? j.status}
      </span>
      {j.status === "Running" && (
        <button onClick={() => void w.cancelGit()}>
          Отменить Git-операцию
        </button>
      )}
      {j.error && <span>{j.error}</span>}
      {j.state_changed && <span>Состояние репозитория изменилось.</span>}
      {j.outcome_uncertain && (
        <strong>
          Операция могла успеть изменить Git. Проверьте историю и remote перед
          повтором.
        </strong>
      )}
      {j.error === "AUTH_INTERACTION_REQUIRED" && (
        <span>
          Авторизуйтесь через Git credential helper / SSH в терминале и
          повторите.
        </span>
      )}
      {j.status === "Succeeded" && j.root !== w.state.root && (
        <button onClick={() => void w.openRepository(j.root)}>
          Открыть результат
        </button>
      )}
    </div>
  );
}
export function GitPreview({ workspace: w }: { workspace: Workspace }) {
  const p = w.state.gitPreview;
  if (!p) return null;
  return (
    <section
      className="git-preview"
      role="dialog"
      aria-label="Предпросмотр Index"
    >
      <h3>Предпросмотр Index · {p.path}</h3>
      <p>
        Рабочий файл останется без изменений. Проверьте итог перед применением.
      </p>
      <div className="preview-columns">
        <div>
          <strong>Текущий Index</strong>
          <pre>{p.before || "(пусто)"}</pre>
        </div>
        <div>
          <strong>После применения</strong>
          <pre>{p.after || "(пусто)"}</pre>
        </div>
      </div>
      <button
        disabled={
          w.state.gitStarting ||
          w.state.gitJob?.status === "Running" ||
          p.generation !== w.state.repo?.generation
        }
        onClick={() => void w.applyGitPreview()}
      >
        Применить к Index
      </button>
      <button onClick={() => w.dismissGitPreview()}>
        Закрыть предпросмотр
      </button>
    </section>
  );
}
