import { Workspace, type WorkspaceApi } from "../../workspace";
import type {
  RepoPath,
  Revision,
  Side,
  ReviewState,
  GitAction,
  SourceLocation,
} from "../../../../../packages/api/src/generated";
import {
  sendPanelAction,
  closePanel,
  type PanelAction,
  type PanelActionName,
} from "./native";
export type PanelSettings = {
  view?: "unified" | "split";
  light?: boolean;
  scale?: number;
  showDeleted?: boolean;
  ignoreWhitespace?: boolean;
  mode?: string;
};
const scopeKey = (w: Workspace) =>
  JSON.stringify([
    w.state.root,
    w.state.repo?.repo_id,
    w.state.repo?.worktree_id,
    w.state.repo?.generation,
  ]);
export function panelSnapshot(w: Workspace, settings: PanelSettings) {
  return {
    scope: scopeKey(w),
    workspace: {
      ...w.state,
      tabs: w.state.tabs.map((t) => ({
        ...t,
        data: t.id === w.state.activeTab ? t.data : undefined,
      })),
    },
    settings,
  };
}
export type SharedPanelState = ReturnType<typeof panelSnapshot>;
function object(p: unknown): p is Record<string, any> {
  return !!p && typeof p === "object" && !Array.isArray(p);
}
function revision(r: unknown): r is Revision {
  if (["Empty", "Head", "Index", "Worktree"].includes(r as string)) return true;
  if (!object(r)) return false;
  return (
    (object(r.Commit) &&
      typeof r.Commit.oid === "string" &&
      /^[a-f0-9]{40,64}$/.test(r.Commit.oid)) ||
    (object(r.Snapshot) &&
      typeof r.Snapshot.id === "string" &&
      /^[a-f0-9-]{36}$/.test(r.Snapshot.id))
  );
}
export async function dispatchPanelAction(
  w: Workspace,
  message: PanelAction,
  onSettings?: (v: PanelSettings) => void,
): Promise<void> {
  const p = message.payload;
  if (!object(p) || p.scope !== scopeKey(w) || w.state.openingRepository)
    return;
  const tab = w.active();
  switch (message.action) {
    case "relations_load":
      if (
        message.panel === "code" &&
        tab &&
        p.comparisonId === tab.data.comparison.id &&
        typeof p.open === "boolean"
      )
        await w.loadRelations(
          p.open,
          typeof p.symbolId === "string" ? p.symbolId : null,
        );
      break;
    case "relations_show":
      if (
        message.panel === "code" &&
        p.key === w.state.relations?.key &&
        typeof p.open === "boolean"
      )
        w.showRelations(
          p.open,
          typeof p.symbolId === "string" ? p.symbolId : null,
        );
      break;
    case "relation_location":
      if (
        message.panel === "code" &&
        p.key === w.state.relations?.key &&
        object(p.path) &&
        typeof p.path.raw_base64 === "string" &&
        Number.isSafeInteger(p.line) &&
        p.line > 0 &&
        Number.isSafeInteger(p.column) &&
        p.column > 0
      )
        await w.openRelationLocation(p.path as RepoPath, p.line, p.column);
      break;
    case "relations_back":
      if (message.panel === "code" && p.tabId === w.state.relationBack?.tab.id)
        w.backFromRelations();
      break;
    case "learning_mode":
      if (["explanation", "trace", "diagram"].includes(p.mode))
        w.setLearningMode(p.mode);
      break;
    case "learning_refresh":
      await w.refreshLearning();
      break;
    case "learning_open":
      if (typeof p.id === "string") await w.openLearning(p.id);
      break;
    case "learning_location":
      if (
        p.artifact === w.state.learningRecord?.item.id &&
        object(p.location) &&
        object(p.location.path) &&
        Number.isSafeInteger(p.location.line)
      )
        await w.openLearningLocation(p.location as SourceLocation);
      break;
    case "trace_move":
      if (
        p.artifact === w.state.learningRecord?.item.id &&
        p.step === w.state.traceStep &&
        ["next", "over", "into", "out", "back", "restart"].includes(p.action)
      )
        await w.moveTrace(p.action);
      break;
    case "trace_frame":
      if (
        p.artifact === w.state.learningRecord?.item.id &&
        p.step === w.state.traceStep &&
        typeof p.id === "string"
      )
        await w.chooseTraceFrame(p.id);
      break;
    case "git_cancel":
      if (p.id === w.state.gitJob?.id) await w.cancelGit();
      break;
    case "git_dismiss":
      if (p.id === w.state.gitPreview?.id) w.dismissGitPreview();
      break;
    case "git_apply":
      if (p.id === w.state.gitPreview?.id) await w.applyGitPreview();
      break;
    case "git_prepare":
      if (
        tab &&
        p.comparisonId === tab.data.comparison.id &&
        Array.isArray(p.old) &&
        Array.isArray(p.new) &&
        p.old.length + p.new.length <= 100000 &&
        [...p.old, ...p.new].every((n) => Number.isSafeInteger(n) && n > 0)
      )
        await w.prepareSelection(p.old, p.new);
      break;
    case "git_action": {
      const a = p.action;
      if (!object(a)) break;
      if (a.kind === "Stage" || a.kind === "Unstage") {
        if (
          tab &&
          p.comparisonId === tab.data.comparison.id &&
          !tab.stale &&
          object(a.path) &&
          a.path.raw_base64 === tab.path.raw_base64
        )
          await w.runGit({ kind: a.kind, path: tab.path });
      } else if (message.panel === "git") {
        if (
          a.kind === "Commit" &&
          typeof a.message === "string" &&
          a.message.length <= 32768
        )
          await w.runGit({ kind: a.kind, message: a.message });
        if (
          (a.kind === "CreateBranch" || a.kind === "SwitchBranch") &&
          typeof a.name === "string" &&
          a.name.length <= 255
        )
          await w.runGit({ kind: a.kind, name: a.name });
        if (
          ["Fetch", "Pull", "Push"].includes(a.kind) &&
          typeof a.remote === "string" &&
          w.state.gitRemotes.includes(a.remote)
        ) {
          if (a.kind === "Fetch")
            await w.runGit({ kind: "Fetch", remote: a.remote });
          else if (typeof a.branch === "string" && a.branch.length <= 255)
            await w.runGit({
              kind: a.kind as "Pull" | "Push",
              remote: a.remote,
              branch: a.branch,
            });
        }
      }
      break;
    }
    case "refresh_explanations":
      await w.refreshExplanations();
      break;
    case "review_decision":
      if (
        tab &&
        p.comparisonId === tab.data.comparison.id &&
        p.baseSnapshotId === tab.data.base.id &&
        p.targetSnapshotId === tab.data.target.id &&
        w.state.explanations.some((d) => d.id === p.id) &&
        ["Viewed", "Accepted", "Question"].includes(p.state) &&
        typeof p.note === "string" &&
        p.note.length <= 4096
      )
        await w.reviewDecision(p.id, p.state, p.note);
      break;
    case "explain_detail":
      if (
        tab &&
        p.comparisonId === tab.data.comparison.id &&
        w.state.explanations.some((d) => d.id === p.id)
      )
        await w.openDecision(p.id);
      break;
    case "redock":
      await closePanel(message.panel);
      break;
    case "select_tab":
      if (w.state.tabs.some((t) => t.id === p.id)) w.activate(p.id);
      break;
    case "close_tab":
      if (w.state.tabs.some((t) => t.id === p.id)) w.close(p.id);
      break;
    case "select_commit":
      if (w.state.commits.some((c) => c.oid === p.oid)) w.selectCommit(p.oid);
      break;
    case "select_branch":
      if (p.name === "all" || w.state.branches.some((b) => b.name === p.name))
        w.filterBranch(p.name);
      break;
    case "load_more":
      await w.more();
      break;
    case "refresh":
      if (p.kind === "history") await w.refreshHistory();
      else if (tab) await w.openFile(tab.path, tab.base, tab.target, true);
      break;
    case "show_explanation":
      if (typeof p.open === "boolean") w.showExplanation(p.open);
      break;
    case "explanation_layout":
    case "set_explanation_layout":
      if (p.layout === "panel" || p.layout === "popover")
        w.setExplanationLayout(p.layout);
      break;
    case "set_selection": {
      const file =
        tab &&
        (p.side === "Old" ? tab.data.base : tab.data.target).files.find(
          (f) => f.path.raw_base64 === tab.path.raw_base64,
        );
      if (
        tab &&
        file &&
        p.comparisonId === tab.data.comparison.id &&
        (p.side === "Old" || p.side === "New") &&
        Number.isSafeInteger(p.startLine) &&
        Number.isSafeInteger(p.endLine) &&
        p.startLine >= 1 &&
        p.endLine >= p.startLine &&
        p.endLine <=
          1 +
            file.bytes.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0)
      )
        w.explain(p.side, p.startLine, p.endLine);
      break;
    }
    case "set_view": {
      const v: PanelSettings = {};
      if (p.view === "split" || p.view === "unified") v.view = p.view;
      if (typeof p.light === "boolean") v.light = p.light;
      if ([100, 110, 125, 150].includes(p.scale)) v.scale = p.scale;
      if (typeof p.showDeleted === "boolean") v.showDeleted = p.showDeleted;
      if (typeof p.ignoreWhitespace === "boolean")
        v.ignoreWhitespace = p.ignoreWhitespace;
      if (p.mode === "work" || p.mode === "index") v.mode = p.mode;
      onSettings?.(v);
      break;
    }
    case "select_file":
    case "open_revision": {
      if (!revision(p.base) || !revision(p.target)) break;
      let path =
        w.state.paths.find((f) => f.raw_base64 === p.path)?.raw_base64 ===
        p.path
          ? w.state.paths.find((f) => f.raw_base64 === p.path)
          : w.state.tabs.find((t) => t.path.raw_base64 === p.path)?.path;
      const activeTabId = w.state.activeTab;
      const selectedCommit = w.state.selectedCommit;
      const activePair =
        !!tab &&
        JSON.stringify([p.base, p.target]) ===
          JSON.stringify([tab.base, tab.target]);
      if (!path && activePair) {
        path = tab.data.base.files.find(
          (f) =>
            f.path.raw_base64 === p.path &&
            tab.data.target.files.some(
              (other) => other.path.raw_base64 === p.path,
            ),
        )?.path;
      }
      // Historical-only files are validated against the selected or open commit pair.

      if (
        !path &&
        object(p.target) &&
        "Commit" in p.target &&
        object(p.target.Commit) &&
        (p.target.Commit.oid === w.state.selectedCommit || activePair)
      ) {
        const r = await w.api.desktop({
          kind: "CommitDetails",
          scope: w.scope(),
          oid: p.target.Commit.oid,
          base:
            object(p.base) && "Commit" in p.base && object(p.base.Commit)
              ? p.base.Commit.oid
              : null,
        });
        if (
          p.scope !== scopeKey(w) ||
          w.state.activeTab !== activeTabId ||
          (activePair &&
            JSON.stringify([w.active()?.base, w.active()?.target]) !==
              JSON.stringify([p.base, p.target])) ||
          (!activePair && w.state.selectedCommit !== selectedCommit)
        )
          break;
        if (r.kind === "CommitDetails")
          path = r.paths.find((f) => f.raw_base64 === p.path);
      }
      if (path) await w.openFile(path, p.base, p.target, p.refresh === true);
      break;
    }
  }
}
export class DetachedWorkspace extends Workspace {
  private remoteListeners = new Set<() => void>();
  private remoteScope = "";
  constructor(api: WorkspaceApi) {
    super(api);
  }
  override subscribe = (f: () => void) => {
    this.remoteListeners.add(f);
    return () => {
      this.remoteListeners.delete(f);
    };
  };
  hydrate(snapshot: SharedPanelState) {
    const incoming = snapshot.workspace;
    const sameRepository =
      this.state.root === incoming.root &&
      this.state.repo?.repo_id === incoming.repo?.repo_id &&
      this.state.repo?.worktree_id === incoming.repo?.worktree_id;
    const previousTabs = new Map(
      sameRepository ? this.state.tabs.map((tab) => [tab.id, tab]) : [],
    );
    const tabs = incoming.tabs.map((tab) => {
      const previous = previousTabs.get(tab.id);
      if (!previous) return tab;
      // Snapshot/comparison IDs identify immutable content. Wire deserialization
      // must not recreate CodeMirror for an unchanged comparison on every poll.
      const old = previous.data;
      const next = tab.data;
      const sameComparison =
        old?.comparison?.id &&
        next?.comparison?.id &&
        old.comparison.id === next.comparison.id &&
        old.base.id === next.base.id &&
        old.target.id === next.target.id;
      return {
        ...tab,
        scroll: previous.scroll,
        data: sameComparison || !next ? old : next,
      };
    });
    this.remoteScope = snapshot.scope;
    this.state = { ...incoming, tabs } as Workspace["state"];
    this.remoteListeners.forEach((f) => f());
  }
  action(action: PanelActionName, payload: Record<string, unknown> = {}) {
    return sendPanelAction(action, {
      ...payload,
      scope: this.remoteScope,
    }).catch((e) => this.error(e));
  }
  override error(e: unknown) {
    this.state = { ...this.state, error: String(e) };
    this.remoteListeners.forEach((f) => f());
  }
  override async openFile(
    path: RepoPath,
    base: Revision = "Index",
    target: Revision = "Worktree",
    refresh = false,
  ) {
    await this.action("open_revision", {
      path: path.raw_base64,
      base,
      target,
      refresh,
    });
  }
  override async loadRelations(open = false, symbolId: string | null = null) {
    await this.action("relations_load", {
      open,
      symbolId,
      comparisonId: this.active()?.data.comparison.id,
    });
  }
  override showRelations(open: boolean, symbolId: string | null = null) {
    void this.action("relations_show", {
      open,
      symbolId,
      key: this.state.relations?.key,
    });
  }
  override async openRelationLocation(path: RepoPath, line = 1, column = 1) {
    await this.action("relation_location", {
      path,
      line,
      column,
      key: this.state.relations?.key,
    });
  }
  override backFromRelations() {
    void this.action("relations_back", {
      tabId: this.state.relationBack?.tab.id,
    });
  }
  override activate(id: string) {
    void this.action("select_tab", { id });
  }
  override close(id: string) {
    void this.action("close_tab", { id });
  }
  override selectCommit(oid: string) {
    void this.action("select_commit", { oid });
  }
  override filterBranch(name: string) {
    void this.action("select_branch", { name });
  }
  override async more() {
    await this.action("load_more");
  }
  override async refreshHistory() {
    await this.action("refresh", { kind: "history" });
  }
  override async refreshExplanations() {
    await this.action("refresh_explanations");
  }
  override async reviewDecision(id: string, state: ReviewState, note = "") {
    const tab = this.active();
    if (tab)
      await this.action("review_decision", {
        id,
        state,
        note,
        comparisonId: tab.data.comparison.id,
        baseSnapshotId: tab.data.base.id,
        targetSnapshotId: tab.data.target.id,
      });
  }
  override async openDecision(id: string) {
    await this.action("explain_detail", {
      id,
      comparisonId: this.active()?.data.comparison.id,
    });
  }
  override setLearningMode(mode: Workspace["state"]["learningMode"]) {
    void this.action("learning_mode", { mode });
  }
  override async refreshLearning() {
    await this.action("learning_refresh");
  }
  override async openLearning(id: string) {
    await this.action("learning_open", { id });
  }
  override async openLearningLocation(location: SourceLocation) {
    await this.action("learning_location", {
      location,
      artifact: this.state.learningRecord?.item.id,
    });
  }
  override async moveTrace(action: Parameters<Workspace["moveTrace"]>[0]) {
    await this.action("trace_move", {
      action,
      step: this.state.traceStep,
      artifact: this.state.learningRecord?.item.id,
    });
  }
  override async chooseTraceFrame(id: string) {
    await this.action("trace_frame", {
      id,
      step: this.state.traceStep,
      artifact: this.state.learningRecord?.item.id,
    });
  }
  override async runGit(action: GitAction) {
    await this.action("git_action", {
      action,
      comparisonId: this.active()?.data.comparison.id,
    });
  }
  override async prepareSelection(old: number[], next: number[]) {
    await this.action("git_prepare", {
      old,
      new: next,
      comparisonId: this.active()?.data.comparison.id,
    });
  }
  override async applyGitPreview() {
    await this.action("git_apply", { id: this.state.gitPreview?.id });
  }
  override dismissGitPreview() {
    void this.action("git_dismiss", { id: this.state.gitPreview?.id });
  }
  override async cancelGit() {
    await this.action("git_cancel", { id: this.state.gitJob?.id });
  }
  override async createRepository() {
    throw Error("MAIN_WINDOW_REQUIRED");
  }
  override async refreshRemotes() {}
  override async pollGit() {}
  override async poll() {}
  override async openRepository() {
    throw Error("MAIN_WINDOW_REQUIRED");
  }
  override explain(side: Side, startLine: number, endLine: number) {
    void this.action("set_selection", {
      side,
      startLine,
      endLine,
      comparisonId: this.active()?.data.comparison.id,
    });
  }
  override setExplanationLayout(layout: "panel" | "popover") {
    void this.action("explanation_layout", { layout });
  }
  override showExplanation(open: boolean) {
    void this.action("show_explanation", { open });
  }
}
