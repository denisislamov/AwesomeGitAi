import { MemoryDialog } from "./features/memory/MemoryDialog";
import { RelationsDialog } from "./features/relations/RelationsDialog";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Workspace, revisionLabel, type WorkspaceApi } from "./workspace";
import {
  GitControls,
  GitJobStatus,
  GitPreview,
} from "./features/git-operations/GitControls";
import { Dialog, CommandMenu } from "./features/commands/CommandUI";
import { CodeReader } from "./features/code/CodeReader";
import { GitLog } from "./features/git-log/GitLog";
import { AgentConnection } from "./features/explanation/AgentConnection";
import { LearningPanel } from "./features/trace/LearningPanel";
import type { Revision, RepoPath } from "../../../packages/api/src/generated";
import "../../../packages/ui/src/gruvbox.css";
import { DockLayout } from "./features/layout/DockLayout";
import {
  detachedPanel,
  nativePanelsAvailable,
  publishPanelState,
  readPanelState,
  drainPanelActions,
  closePanel,
} from "./features/layout/native";
import {
  DetachedWorkspace,
  panelSnapshot,
  dispatchPanelAction,
  type SharedPanelState,
  type PanelSettings,
} from "./features/layout/sync";
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
  const panel = useMemo(
    () => (nativePanelsAvailable() ? detachedPanel() : null),
    [],
  );
  const workspace = useMemo(
    () => (panel ? new DetachedWorkspace(api) : new Workspace(api)),
    [api, panel],
  );
  const s = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const tab = workspace.active();
  const [codeActionsHost, setCodeActionsHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [root, setRoot] = useState("");
  const [source, setSource] = useState("");
  const [create, setCreate] = useState(false);
  const [dialog, setDialog] = useState<
    "repository" | "git" | "appearance" | "editor" | "memory" | null
  >(null);
  const [gitSection, setGitSection] = useState<
    "commit" | "branches" | "remotes"
  >("commit");
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("agai-recent-repos") ?? "[]")
        .filter((p: unknown) => typeof p === "string")
        .slice(0, 8);
    } catch {
      return [];
    }
  });
  const chooseRepository = async (path: string) => {
    await workspace.openRepository(path);
    if (!workspace.state.error && workspace.state.repo) {
      setRoot(path);
      setDialog(null);
      setCreate(false);
      const next = [path, ...recent.filter((p) => p !== path)].slice(0, 8);
      setRecent(next);
      try {
        localStorage.setItem("agai-recent-repos", JSON.stringify(next));
      } catch {
        /* optional convenience */
      }
    }
  };
  const commandRef = useRef<(id: string) => void>(() => {});
  commandRef.current = (id) => {
    window.dispatchEvent(new Event("agai-dismiss-overlays"));
    setLayoutOpen(false);
    setDialog(null);
    if (id === "repo-open" || id === "repo-create") {
      setCreate(id === "repo-create");
      setDialog("repository");
    } else if (id.startsWith("git-")) {
      const section = id.slice(4);
      if (["commit", "branches", "remotes"].includes(section)) {
        setGitSection(section as typeof gitSection);
        setDialog("git");
      }
    } else if (id === "appearance") setDialog("appearance");
    else if (id === "editor-options") setDialog("editor");
    else if (id === "memory") setDialog("memory");
    else if (id === "panels") setLayoutOpen(true);
    else if (id === "agent-connect")
      document
        .querySelector<HTMLButtonElement>("[data-agent-connect]")
        ?.click();
  };
  useEffect(() => {
    if (panel) return;
    const handler = (e: Event) =>
      commandRef.current((e as CustomEvent<string>).detail);
    window.addEventListener("agai-command", handler);
    return () => window.removeEventListener("agai-command", handler);
  }, [panel]);
  const [treeMode, setTreeMode] = useState("changed");
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"unified" | "split">("unified");
  const [mode, setMode] = useState("work");
  const [light, setLight] = useState(false);
  const [scale, setScale] = useState(100);
  const [showDeleted, setShowDeleted] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [snapA, setSnapA] = useState("");
  const [snapB, setSnapB] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState(
    panel ? "Waiting for the main window…" : "",
  );
  const applySettings = (v: PanelSettings) => {
    if (v.view) setView(v.view);
    if (v.light !== undefined) setLight(v.light);
    if (v.scale) setScale(v.scale);
    if (v.showDeleted !== undefined) setShowDeleted(v.showDeleted);
    if (v.ignoreWhitespace !== undefined)
      setIgnoreWhitespace(v.ignoreWhitespace);
    if (v.mode) setMode(v.mode);
  };
  const updateSettings = (v: PanelSettings) => {
    if (workspace instanceof DetachedWorkspace)
      void workspace.action("set_view", v);
    else applySettings(v);
  };
  useEffect(() => {
    if (workspace.state.recordedLocation?.side === "Old")
      updateSettings({ view: "split" });
  }, [workspace.state.recordedLocation]);
  const settings = { view, light, scale, showDeleted, ignoreWhitespace, mode };
  const shared = useRef(panelSnapshot(workspace, settings));
  shared.current = panelSnapshot(workspace, settings);
  const applySettingsRef = useRef(applySettings);
  applySettingsRef.current = applySettings;
  useEffect(() => {
    if (!nativePanelsAvailable()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastState: unknown;
    let lastSettings = "";
    let revision = -1;
    const tick = async () => {
      try {
        if (workspace instanceof DetachedWorkspace) {
          const snapshot = await readPanelState<SharedPanelState>(
            revision < 0 ? undefined : revision,
          );
          if (!stopped && snapshot.revision > 0) setBridgeStatus("");
          if (!stopped && snapshot.state && snapshot.revision !== revision) {
            revision = snapshot.revision;
            workspace.hydrate(snapshot.state);
            applySettingsRef.current(snapshot.state.settings);
            setBridgeStatus("");
          }
        } else {
          const observed = workspace.state;
          const current = panelSnapshot(workspace, shared.current.settings);
          const serialized = JSON.stringify(current.settings);
          if (lastState !== workspace.state || lastSettings !== serialized) {
            await publishPanelState(current);
            lastState = observed;
            lastSettings = serialized;
          }
          const messages = await drainPanelActions();
          for (const message of messages) {
            if (stopped) break;
            await dispatchPanelAction(
              workspace,
              message,
              applySettingsRef.current,
            );
          }
          if (!stopped) setBridgeStatus("");
        }
      } catch (e) {
        if (!stopped)
          setBridgeStatus(`Main window connection unavailable: ${String(e)}`);
      } finally {
        if (!stopped) timer = setTimeout(tick, 250);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspace]);
  useEffect(() => {
    if (panel) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await workspace.pollGit();
      await workspace.poll();
      if (!stopped) timer = setTimeout(tick, 1200);
    };
    timer = setTimeout(tick, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspace, panel]);
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
  const panels = {
    files: (
      <aside className="file-tree" aria-label="Repository files">
        <div className="segmented">
          <button
            aria-pressed={treeMode === "changed"}
            onClick={() => setTreeMode("changed")}
          >
            Changes
          </button>
          <button
            aria-pressed={treeMode === "all"}
            onClick={() => setTreeMode("all")}
          >
            All files
          </button>
        </div>
        <input
          aria-label="Search files"
          placeholder="Find a file…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="file-list">
          {[...groups].map(([dir, files]) => (
            <details key={dir} open>
              <summary title={dir}>{dir === "." ? "Project" : dir}</summary>
              {files.map((p) => (
                <button
                  key={p.raw_base64}
                  aria-label={`File ${p.display}`}
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
                ? "No changed files. Switch to All files."
                : "No files found."}
            </p>
          )}
        </div>
      </aside>
    ),
    code: (
      <section className="code-workspace" aria-label="Code">
        <div className="tabs" role="tablist" aria-label="Open versions">
          {s.tabs.map((t) => (
            <div
              className={"tab " + (t.id === s.activeTab ? "active" : "")}
              key={t.id}
            >
              <button
                role="tab"
                aria-label={`${t.path.display.split("/").at(-1)} ${revisionLabel(t.target)}`}
                title={`${t.path.display} · ${revisionLabel(t.base)} → ${revisionLabel(t.target)}`}
                aria-selected={t.id === s.activeTab}
                onClick={() => workspace.activate(t.id)}
              >
                {t.path.display.split("/").at(-1)}
                {s.tabs.filter(
                  (other) => other.path.raw_base64 === t.path.raw_base64,
                ).length > 1 && <small> · {revisionLabel(t.target)}</small>}

                {t.stale ? " ●" : ""}
              </button>
              <button
                aria-label={`Close ${t.path.display}`}
                onClick={() => workspace.close(t.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <GitPreview workspace={workspace} />
        <div className="code-context-bar">
          {tab && (
            <details className="revision-details">
              <summary title="Version details">
                {JSON.stringify(tab.base) === JSON.stringify(tab.target)
                  ? typeof tab.target === "object" && "Snapshot" in tab.target
                    ? "Recorded version"
                    : revisionLabel(tab.target)
                  : `${revisionLabel(tab.base)} → ${revisionLabel(tab.target)}`}
              </summary>
              <div className="revision-popup">
                <strong>{tab.path.display}</strong>
                <p>
                  Base: {revisionLabel(tab.base)} ·{" "}
                  <code data-testid="base-version-id">{tab.data.base.id}</code>
                </p>
                {tab.data.target.id !== tab.data.base.id && (
                  <p>
                    Target: {revisionLabel(tab.target)} ·{" "}
                    <code data-testid="target-version-id">
                      {tab.data.target.id}
                    </code>
                  </p>
                )}
                <p>
                  Read-only view. Saved versions do not follow current
                  working-copy changes.
                </p>
              </div>
            </details>
          )}
          <span className="context-spacer" />
          <div className="code-actions-host" ref={setCodeActionsHost} />
          <button onClick={() => setDialog("editor")}>View options</button>
          {tab &&
            ((tab.base === "Index" && tab.target === "Worktree") ||
              (tab.base === "Head" && tab.target === "Index")) && (
              <button
                disabled={
                  tab.stale || s.gitStarting || s.gitJob?.status === "Running"
                }
                onClick={() =>
                  void workspace.runGit({
                    kind: tab.target === "Index" ? "Unstage" : "Stage",
                    path: tab.path,
                  })
                }
              >
                {tab.target === "Index" ? "Unstage file" : "Stage file"}
              </button>
            )}
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
              aria-label="Base snapshot ID"
              placeholder="Base snapshot UUID"
              value={snapA}
              onChange={(e) => setSnapA(e.target.value)}
            />
            <input
              aria-label="Target snapshot ID"
              placeholder="Target snapshot UUID"
              value={snapB}
              onChange={(e) => setSnapB(e.target.value)}
            />
            <button disabled={!tab}>Compare snapshots</button>
          </form>
        )}
        {tab ? (
          <>
            {tab.stale && (
              <div className="stale-banner" role="status">
                New changes available. Showing the previous snapshot.{" "}
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
                  Refresh snapshot
                </button>
              </div>
            )}
            <RelationsDialog workspace={workspace} />
            <CodeReader
              key={tab.id}
              actionsHost={codeActionsHost}
              tab={tab}
              workspace={workspace}
              view={view}
              light={light}
              ignoreWhitespace={ignoreWhitespace}
              showDeleted={showDeleted}
            />
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-symbol">{`{ }`}</div>
            <h1>Code at the center</h1>
            <button onClick={() => setDialog("repository")}>
              Open repository…
            </button>
            <p>
              Open a repository and select a file.
              <br />
              History, changes, and context stay close.
            </p>
            <span>Local · Guarded Git operations · Persistent snapshots</span>
          </div>
        )}
      </section>
    ),
    explanation: (
      <LearningPanel
        workspace={workspace}
        onBrowseMemory={panel ? undefined : () => commandRef.current("memory")}
      />
    ),
    git: (
      <div className="git-panel-content">
        {panel && (
          <button
            className="git-panel-actions"
            onClick={() => setDialog("git")}
          >
            Git…
          </button>
        )}
        <GitLog workspace={workspace} />
      </div>
    ),
  };
  const dialogs = (
    <>
      {dialog === "memory" && (
        <MemoryDialog
          workspace={workspace}
          onClose={() => setDialog(null)}
          onErased={() => {
            workspace.clearStoredContext();
            void workspace.openRepository(s.root);
          }}
        />
      )}
      {dialog === "editor" && (
        <Dialog
          error={s.error || undefined}
          title="View options"
          onClose={() => setDialog(null)}
        >
          {" "}
          <div className="editor-settings">
            <select
              aria-label="Comparison mode"
              value={mode}
              onChange={(e) => {
                const m = e.target.value;
                updateSettings({ mode: m });
                if (tab)
                  void workspace.openFile(
                    tab.path,
                    ...((m === "index"
                      ? ["Head", "Index"]
                      : ["Index", "Worktree"]) as [Revision, Revision]),
                  );
              }}
            >
              <option value="work">Index → worktree</option>
              <option value="index">HEAD → Index</option>
            </select>
            <select
              aria-label="Diff view"
              value={view}
              onChange={(e) =>
                updateSettings({ view: e.target.value as typeof view })
              }
            >
              <option value="unified">Unified</option>
              <option value="split">Side by side</option>
            </select>
            <button
              aria-pressed={showSnapshots}
              onClick={() => {
                setShowSnapshots(!showSnapshots);
                setDialog(null);
              }}
            >
              Snapshots
            </button>
            <button
              onClick={() => workspace.showExplanation(!s.explanationOpen)}
              aria-pressed={s.explanationOpen}
            >
              Explanation
            </button>
            <select
              aria-label="Explanation placement"
              value={s.explanationLayout}
              onChange={(e) =>
                workspace.setExplanationLayout(
                  e.target.value as "panel" | "popover",
                )
              }
            >
              <option value="panel">Side panel</option>
              <option value="popover">Popover</option>
            </select>
          </div>
          <div className="editor-settings">
            <label>
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) =>
                  updateSettings({ showDeleted: e.target.checked })
                }
              />{" "}
              Deleted lines −
            </label>
            <label>
              <input
                type="checkbox"
                checked={ignoreWhitespace}
                onChange={(e) =>
                  updateSettings({ ignoreWhitespace: e.target.checked })
                }
              />{" "}
              Ignore trailing whitespace · display only
            </label>
            {openExternal && !panel && tab && (
              <>
                <button
                  onClick={() =>
                    void openExternal(s.root, tab.path, "ide").catch((e) =>
                      workspace.error(e),
                    )
                  }
                >
                  Open in Rider ↗
                </button>
                <button
                  onClick={() =>
                    void openExternal(s.root, null, "terminal").catch((e) =>
                      workspace.error(e),
                    )
                  }
                >
                  Terminal ↗
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
      {dialog === "git" && (
        <Dialog
          error={s.error || undefined}
          title="Git"
          onClose={() => setDialog(null)}
        >
          <div className="segmented">
            {(["commit", "branches", "remotes"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={gitSection === v}
                onClick={() => setGitSection(v)}
              >
                {v === "commit"
                  ? "Commit"
                  : v === "branches"
                    ? "Branches"
                    : "Remotes"}
              </button>
            ))}
          </div>
          <GitJobStatus workspace={workspace} />
          <GitControls workspace={workspace} section={gitSection} />
        </Dialog>
      )}
      {dialog === "appearance" && (
        <Dialog
          error={s.error || undefined}
          title="Appearance"
          onClose={() => setDialog(null)}
        >
          <label>
            <input
              type="checkbox"
              checked={light}
              onChange={(e) => updateSettings({ light: e.target.checked })}
            />{" "}
            Light theme
          </label>
          <label>
            Interface scale{" "}
            <select
              aria-label="Interface scale"
              value={scale}
              onChange={(e) =>
                updateSettings({ scale: Number(e.target.value) })
              }
            >
              {[100, 110, 125, 150].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
        </Dialog>
      )}
      {dialog === "repository" && (
        <Dialog
          error={s.error || undefined}
          title="Repository"
          onClose={() => setDialog(null)}
        >
          <form
            className="repository-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void chooseRepository(root);
            }}
          >
            <label>
              Repository path
              <input
                autoFocus
                aria-label="Repository path"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="/path/to/repository"
                spellCheck={false}
              />
            </label>
            <button type="submit" disabled={s.busy || !root}>
              Open repository
            </button>
          </form>
          <button aria-expanded={create} onClick={() => setCreate(!create)}>
            Init / Clone…
          </button>
          {create && (
            <div className="repository-dialog-form">
              <input
                aria-label="Clone source"
                placeholder="Remote URL or path; leave empty for Init"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              <button
                disabled={
                  !root || s.gitStarting || s.gitJob?.status === "Running"
                }
                onClick={() =>
                  void workspace
                    .createRepository(root, source || null)
                    .then(() => {
                      if (!workspace.state.error) setDialog(null);
                    })
                }
              >
                {source ? "Clone" : "Initialize repository"} at the path above
              </button>
            </div>
          )}
          {recent.length > 0 && (
            <section aria-label="Recent repositories">
              <h4>Recent repositories</h4>
              {recent.map((p) => (
                <button
                  className="recent-repo"
                  key={p}
                  title={p}
                  onClick={() => void chooseRepository(p)}
                >
                  {p.split("/").at(-1)}
                  <small>{p}</small>
                </button>
              ))}
            </section>
          )}
        </Dialog>
      )}
    </>
  );
  if (panel)
    return (
      <main
        className={"app " + (light ? "light" : "")}
        style={
          {
            "--ui-size": `${(15 * scale) / 100}px`,
            "--code-size": `${(15 * scale) / 100}px`,
          } as React.CSSProperties
        }
      >
        <header className="dock-title">
          <strong>
            {s.root ? s.root.split("/").at(-1) : "AwesomeGitAi"} · {panel}
          </strong>
          <button onClick={() => void closePanel(panel)}>
            Return to main window
          </button>
        </header>
        {dialogs}

        {dialog !== "git" && <GitJobStatus workspace={workspace} />}
        {bridgeStatus && <div role="status">{bridgeStatus}</div>}
        {s.error && <div role="alert">{s.error}</div>}
        <div className="dock-content">{panels[panel]}</div>
      </main>
    );
  return (
    <main
      className={"app " + (light ? "light" : "")}
      style={
        {
          "--ui-size": `${(15 * scale) / 100}px`,
          "--code-size": `${(15 * scale) / 100}px`,
        } as React.CSSProperties
      }
    >
      <header className="topbar compact-topbar">
        <button
          className="repository-switcher"
          title={s.root || "Open a repository"}
          aria-label="Choose repository"
          onClick={() => {
            setCreate(false);
            setDialog("repository");
          }}
        >
          ⑂ {s.root ? s.root.split("/").at(-1) : "Open project"} ▾
        </button>
        {!nativePanelsAvailable() && (
          <nav aria-label="Application commands">
            <CommandMenu label="File">
              <button onClick={() => commandRef.current("repo-open")}>
                Open repository…
              </button>
              <button onClick={() => commandRef.current("repo-create")}>
                Init / Clone…
              </button>
            </CommandMenu>
            <CommandMenu label="Git">
              <button onClick={() => commandRef.current("git-commit")}>
                Commit…
              </button>
              <button onClick={() => commandRef.current("git-branches")}>
                Branches…
              </button>
              <button onClick={() => commandRef.current("git-remotes")}>
                Remotes…
              </button>
            </CommandMenu>
            <CommandMenu label="Agent">
              <button
                disabled={!s.repo}
                onClick={() => commandRef.current("agent-connect")}
              >
                Connect MCP…
              </button>
            </CommandMenu>
            <CommandMenu label="View">
              <button onClick={() => commandRef.current("memory")}>
                Project memory…
              </button>
              <button onClick={() => commandRef.current("editor-options")}>
                Editor options…
              </button>
              <button onClick={() => commandRef.current("panels")}>
                Panels…
              </button>
              <button onClick={() => commandRef.current("appearance")}>
                Appearance…
              </button>
            </CommandMenu>
          </nav>
        )}
        {s.busy && <span role="status">Loading…</span>}
      </header>
      <AgentConnection root={s.root} hiddenTrigger />
      {dialogs}

      {dialog !== "git" && <GitJobStatus workspace={workspace} />}
      {bridgeStatus && <div role="status">{bridgeStatus}</div>}
      {s.error && (
        <div role="alert" className="error-banner">
          Action failed: {s.error}. The open snapshot is preserved.
        </div>
      )}
      <DockLayout
        panels={panels}
        settingsOpen={layoutOpen}
        onSettingsClose={() => setLayoutOpen(false)}
      />
      <footer className="statusbar">
        <span>● macOS · Local host</span>
        <span>
          {tab
            ? `${tab.data.target.files.find((f) => f.path.raw_base64 === tab.path.raw_base64)!.newline.toUpperCase()} · UTF-8 · ${tab.data.target.files.find((f) => f.path.raw_base64 === tab.path.raw_base64)!.bytes.length} bytes`
            : "No open file"}
        </span>
        <span>
          {s.repo?.branch
            ? `⑂ ${s.repo.branch} · ${s.repo.status_entries.length} changed`
            : ""}
        </span>
      </footer>
    </main>
  );
}
