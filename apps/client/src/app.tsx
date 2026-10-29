import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Workspace, revisionLabel, type WorkspaceApi } from "./workspace";
import { CodeReader } from "./features/code/CodeReader";
import { GitLog } from "./features/git-log/GitLog";
import { ExplanationPanel } from "./features/explanation/ExplanationPanel";
import type { Revision, RepoPath } from "../../../packages/api/src/generated";
import "../../../packages/ui/src/gruvbox.css";
export function App({
  api,
  openExternal,
}: {
  api: WorkspaceApi;
  openExternal?: (
    root: string,
    path: RepoPath | null,
    target: "ide" | "terminal",
  ) => Promise<void>;
}) {
  const workspace = useMemo(() => new Workspace(api), [api]);
  const s = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const tab = workspace.active();
  const [root, setRoot] = useState("");
  const [treeMode, setTreeMode] = useState("changed");
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"unified" | "split">("unified");
  const [mode, setMode] = useState("work");
  const [light, setLight] = useState(false);
  const [scale, setScale] = useState(100);
  const [showDeleted, setShowDeleted] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [dock, setDock] = useState(() =>
    Number(localStorage.getItem("agai-dock") ?? 30),
  );
  const [dockOpen, setDockOpen] = useState(true);
  const [snapA, setSnapA] = useState("");
  const [snapB, setSnapB] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await workspace.poll();
      if (!stopped) timer = setTimeout(tick, 1200);
    };
    timer = setTimeout(tick, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspace]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") workspace.showExplanation(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [workspace]);
  const revisions = (): [Revision, Revision] =>
    mode === "index" ? ["Head", "Index"] : ["Index", "Worktree"];
  const open = (p: RepoPath) => void workspace.openFile(p, ...revisions());
  const changed = new Map(
    s.repo?.status_entries.flatMap(
      (e) =>
        [
          [e.path.raw_base64, e.status],
          ...(e.original_path ? [[e.original_path.raw_base64, "D"]] : []),
        ] as [string, string][],
    ) ?? [],
  );
  const paths = s.paths.filter(
    (p) =>
      (treeMode === "all" || changed.has(p.raw_base64)) &&
      p.display.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = new Map<string, RepoPath[]>();
  for (const p of paths) {
    const dir = p.display.includes("/")
      ? p.display.slice(0, p.display.lastIndexOf("/"))
      : ".";
    groups.set(dir, [...(groups.get(dir) ?? []), p]);
  }
  const sizeDock = (value: number) => {
    const n = Math.min(70, Math.max(16, value));
    setDock(n);
    localStorage.setItem("agai-dock", String(n));
  };
  return (
    <main
      className={"app " + (light ? "light" : "")}
      style={
        {
          "--ui-size": `${(15 * scale) / 100}px`,
          "--code-size": `${(15 * scale) / 100}px`,
          "--dock-height": `${dock}vh`,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">⑂</span>
          <strong>AwesomeGitAi</strong>
          <span className="stage">Код</span>
        </div>
        <form
          className="repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void workspace.openRepository(root);
          }}
        >
          <input
            aria-label="Путь к репозиторию"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="/путь/к/репозиторию"
            spellCheck={false}
          />
          <button type="submit" disabled={s.busy}>
            Открыть репозиторий
          </button>
        </form>
        <button
          title="Переключить тему"
          aria-label="Светлая тема"
          aria-pressed={light}
          onClick={() => setLight(!light)}
        >
          {light ? "☾" : "☀"}
        </button>
        <select
          aria-label="Масштаб интерфейса"
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        >
          {[100, 110, 125, 150].map((n) => (
            <option key={n} value={n}>
              {n}%
            </option>
          ))}
        </select>
      </header>
      <div className="repo-strip">
        <span title={s.root}>
          {s.root ? s.root.split("/").at(-1) : "Локальный репозиторий"}
        </span>
        <span>⑂ {s.repo?.branch ?? "—"}</span>
        <span title={s.root}>
          Worktree · {s.repo?.worktree_id.slice(0, 8) ?? "—"}
        </span>
        <span className="status-text">
          {s.busy
            ? "Чтение…"
            : s.repo
              ? `${s.repo.status_entries.length} изменённых файлов`
              : "Откройте папку проекта"}
        </span>
        <button onClick={() => setDockOpen(!dockOpen)} aria-pressed={dockOpen}>
          Git Log
        </button>
      </div>
      {s.error && (
        <div role="alert" className="error-banner">
          Не удалось выполнить действие: {s.error}. Открытый снимок сохранён.
        </div>
      )}
      <div className="workspace">
        <aside className="file-tree" aria-label="Файлы репозитория">
          <div className="segmented">
            <button
              aria-pressed={treeMode === "changed"}
              onClick={() => setTreeMode("changed")}
            >
              Изменения
            </button>
            <button
              aria-pressed={treeMode === "all"}
              onClick={() => setTreeMode("all")}
            >
              Все файлы
            </button>
          </div>
          <input
            aria-label="Поиск файлов"
            placeholder="Найти файл…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="file-list">
            {[...groups].map(([dir, files]) => (
              <details key={dir} open>
                <summary title={dir}>{dir === "." ? "Проект" : dir}</summary>
                {files.map((p) => (
                  <button
                    key={p.raw_base64}
                    aria-label={`Файл ${p.display}`}
                    aria-current={
                      tab?.path.raw_base64 === p.raw_base64 ? "page" : undefined
                    }
                    title={p.display}
                    onClick={() => open(p)}
                  >
                    <span className="file-icon">
                      {p.display.endsWith(".cs")
                        ? "C#"
                        : p.display.endsWith(".ts")
                          ? "TS"
                          : "◇"}
                    </span>
                    <span>{p.display.split("/").at(-1)}</span>
                    <small>{changed.get(p.raw_base64)?.trim() || ""}</small>
                  </button>
                ))}
              </details>
            ))}
            {s.repo && paths.length === 0 && (
              <p className="empty-small">
                {treeMode === "changed"
                  ? "Нет изменённых файлов. Перейдите во «Все файлы»."
                  : "Файлы не найдены."}
              </p>
            )}
          </div>
        </aside>
        <section className="code-workspace" aria-label="Код">
          <div className="tabs" role="tablist" aria-label="Открытые версии">
            {s.tabs.map((t) => (
              <div
                className={"tab " + (t.id === s.activeTab ? "active" : "")}
                key={t.id}
              >
                <button
                  role="tab"
                  aria-selected={t.id === s.activeTab}
                  onClick={() => workspace.activate(t.id)}
                >
                  {t.path.display.split("/").at(-1)}{" "}
                  <small>{revisionLabel(t.target)}</small>
                  {t.stale ? " ●" : ""}
                </button>
                <button
                  aria-label={`Закрыть ${t.path.display}`}
                  onClick={() => workspace.close(t.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="code-toolbar">
            <select
              aria-label="Режим сравнения"
              value={mode}
              onChange={(e) => {
                const m = e.target.value;
                setMode(m);
                if (tab)
                  void workspace.openFile(
                    tab.path,
                    ...((m === "index"
                      ? ["Head", "Index"]
                      : ["Index", "Worktree"]) as [Revision, Revision]),
                  );
              }}
            >
              <option value="work">Index → рабочая копия</option>
              <option value="index">HEAD → Index</option>
            </select>
            <select
              aria-label="Вид сравнения"
              value={view}
              onChange={(e) => setView(e.target.value as typeof view)}
            >
              <option value="unified">Unified</option>
              <option value="split">Рядом</option>
            </select>
            <button
              aria-pressed={showSnapshots}
              onClick={() => setShowSnapshots(!showSnapshots)}
            >
              Снимки
            </button>
            <button
              onClick={() => workspace.showExplanation(!s.explanationOpen)}
              aria-pressed={s.explanationOpen}
            >
              Объяснение
            </button>
            <select
              aria-label="Размещение объяснения"
              value={s.explanationLayout}
              onChange={(e) =>
                workspace.setExplanationLayout(
                  e.target.value as "panel" | "popover",
                )
              }
            >
              <option value="panel">Панель справа</option>
              <option value="popover">Карточка</option>
            </select>
          </div>
          {showSnapshots && (
            <form
              className="snapshot-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (tab)
                  void workspace.openFile(
                    tab.path,
                    { Snapshot: { id: snapA } },
                    { Snapshot: { id: snapB } },
                  );
              }}
            >
              <input
                aria-label="Базовый snapshot ID"
                placeholder="Базовый snapshot UUID"
                value={snapA}
                onChange={(e) => setSnapA(e.target.value)}
              />
              <input
                aria-label="Целевой snapshot ID"
                placeholder="Целевой snapshot UUID"
                value={snapB}
                onChange={(e) => setSnapB(e.target.value)}
              />
              <button disabled={!tab}>Сравнить снимки</button>
            </form>
          )}
          {tab ? (
            <>
              <div className="breadcrumbs">
                <span title={tab.path.display}>{tab.path.display}</span>
                <small>
                  {revisionLabel(tab.base)} → {revisionLabel(tab.target)}
                </small>
              </div>
              <div className="view-options">
                <label>
                  <input
                    type="checkbox"
                    checked={showDeleted}
                    onChange={(e) => setShowDeleted(e.target.checked)}
                  />{" "}
                  Удалённые строки −
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={ignoreWhitespace}
                    onChange={(e) => setIgnoreWhitespace(e.target.checked)}
                  />{" "}
                  Без концевых пробелов · только вид
                </label>
                {openExternal && (
                  <>
                    <button
                      onClick={() =>
                        void openExternal(s.root, tab.path, "ide").catch((e) =>
                          workspace.error(e),
                        )
                      }
                    >
                      Открыть в Rider ↗
                    </button>
                    <button
                      onClick={() =>
                        void openExternal(s.root, null, "terminal").catch((e) =>
                          workspace.error(e),
                        )
                      }
                    >
                      Терминал ↗
                    </button>
                  </>
                )}
              </div>
              {tab.stale && (
                <div className="stale-banner" role="status">
                  Есть новые изменения. Показан прежний снимок.{" "}
                  <button
                    onClick={() =>
                      void workspace.openFile(
                        tab.path,
                        tab.base,
                        tab.target,
                        true,
                      )
                    }
                  >
                    Обновить снимок
                  </button>
                </div>
              )}
              <CodeReader
                key={tab.id}
                tab={tab}
                workspace={workspace}
                view={view}
                light={light}
                ignoreWhitespace={ignoreWhitespace}
                showDeleted={showDeleted}
              />
              <div className="snapshot-status">
                <span>− {tab.data.base.id}</span>
                <span>+ {tab.data.target.id}</span>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-symbol">{`{ }`}</div>
              <h1>Код — в центре внимания</h1>
              <p>
                Откройте репозиторий и выберите файл.
                <br />
                История, изменения и контекст останутся рядом.
              </p>
              <span>Локально · Только чтение · Снимки сохраняются</span>
            </div>
          )}
        </section>
        <ExplanationPanel workspace={workspace} />
      </div>
      {dockOpen && (
        <>
          <div
            className="dock-resizer"
            role="separator"
            aria-label="Высота Git Log"
            aria-orientation="horizontal"
            aria-valuemin={16}
            aria-valuemax={70}
            aria-valuenow={dock}
            tabIndex={0}
            onKeyDown={(e) => {
              if (["ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                sizeDock(dock + (e.key === "ArrowUp" ? 5 : -5));
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                sizeDock(
                  (100 * (window.innerHeight - e.clientY)) / window.innerHeight,
                );
            }}
            onPointerUp={(e) =>
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          />
          <div className="git-dock">
            <GitLog workspace={workspace} />
          </div>
        </>
      )}
      <footer className="statusbar">
        <span>● macOS · Local host</span>
        <span>
          {tab
            ? `${tab.data.target.files[0].newline.toUpperCase()} · UTF-8 · ${tab.data.target.files[0].bytes.length} bytes`
            : "Нет открытого файла"}
        </span>
        <span>Git-записи появятся в T5</span>
      </footer>
    </main>
  );
}
