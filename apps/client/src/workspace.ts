import type {
  DesktopRequest,
  DesktopResponse,
  ReadRequest,
  ReadResponse,
  RepoState,
  RepoPath,
  BranchRef,
  Commit,
  Revision,
  Side,
} from "../../../packages/api/src/generated";
export interface WorkspaceApi {
  read(request: ReadRequest): Promise<ReadResponse>;
  desktop(request: DesktopRequest): Promise<DesktopResponse>;
}
export type FileComparison = Extract<
  DesktopResponse,
  { kind: "FileComparison" }
>;
export type CodeSelection = {
  comparisonId: string;
  snapshotId: string;
  path: RepoPath;
  side: Side;
  startLine: number;
  endLine: number;
};
export type CodeTab = {
  id: string;
  path: RepoPath;
  base: Revision;
  target: Revision;
  data: FileComparison;
  scroll: number;
  stale: boolean;
};
type State = {
  repo: RepoState | null;
  root: string;
  branches: BranchRef[];
  paths: RepoPath[];
  commits: Commit[];
  cursor: string | null;
  branchFilter: string;
  selectedCommit: string | null;
  tabs: CodeTab[];
  activeTab: string | null;
  selection: CodeSelection | null;
  explanationLayout: "panel" | "popover";
  explanationOpen: boolean;
  busy: boolean;
  error: string | null;
  historyStale: boolean;
  historyBusy: boolean;
  openingRepository: boolean;
};
export const revisionLabel = (r: Revision): string =>
  typeof r === "string"
    ? {
        Empty: "Пустое дерево",
        Head: "HEAD",
        Index: "Index",
        Worktree: "Рабочая копия",
      }[r]
    : "Commit" in r
      ? r.Commit.oid.slice(0, 8)
      : `Снимок ${r.Snapshot.id.slice(0, 8)}`;
export class Workspace {
  state: State = {
    repo: null,
    root: "",
    branches: [],
    paths: [],
    commits: [],
    cursor: null,
    branchFilter: "all",
    selectedCommit: null,
    tabs: [],
    activeTab: null,
    selection: null,
    explanationLayout: "panel",
    explanationOpen: true,
    busy: false,
    error: null,
    historyStale: false,
    historyBusy: false,
    openingRepository: false,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private opening = 0;
  constructor(readonly api: WorkspaceApi) {}
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  getSnapshot = () => this.state;
  private patch(p: Partial<State>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f());
  }
  error(e: unknown) {
    this.patch({
      error:
        typeof e === "object" && e && "code" in e ? String(e.code) : String(e),
      busy: false,
    });
  }
  async openRepository(path: string) {
    let epoch = ++this.epoch;
    ++this.opening;
    this.patch({ busy: true, error: null, openingRepository: true });
    try {
      const r = await this.api.desktop({ kind: "OpenRepository", path });
      if (r.kind !== "Repository") throw Error("INVALID_RESPONSE");
      if (epoch !== this.epoch) return;
      epoch = ++this.epoch; // Accepting a new scope invalidates every old-scope request.
      this.patch({
        openingRepository: false,
        repo: r.state,
        root: r.root,
        branches: r.branches,
        tabs: [],
        activeTab: null,
        selection: null,
        paths: [],
        commits: [],
        cursor: null,
        selectedCommit: null,
        branchFilter: "all",
        historyStale: false,
        historyBusy: false,
      });
      const [files, history] = await Promise.all([
        this.api.desktop({
          kind: "ListFiles",
          scope: this.scope(),
          revision: null,
        }),
        this.api.read({
          kind: "ListHistory",
          ...this.scope(),
          cursor: null,
          limit: 200,
        }),
      ]);
      if (epoch !== this.epoch) return;
      if (files.kind !== "Files" || history.kind !== "History")
        throw Error("INVALID_RESPONSE");
      this.patch({
        paths: files.paths,
        commits: history.page.commits,
        cursor: history.page.cursor,
        busy: false,
      });
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    } finally {
      if (epoch === this.epoch) this.patch({ openingRepository: false });
    }
  }
  scope() {
    if (!this.state.repo) throw Error("NO_REPOSITORY");
    return {
      repo_id: this.state.repo.repo_id,
      worktree_id: this.state.repo.worktree_id,
    };
  }
  active() {
    return this.state.tabs.find((t) => t.id === this.state.activeTab);
  }
  async openFile(
    path: RepoPath,
    base: Revision = "Index",
    target: Revision = "Worktree",
    refresh = false,
  ) {
    if (this.state.openingRepository || !this.state.repo) return;
    const scope = this.scope();
    const epoch = this.epoch;
    const serial = ++this.opening;
    const id = JSON.stringify([path.raw_base64, base, target]);
    const existing = this.state.tabs.find((t) => t.id === id);
    if (existing && !refresh) {
      this.activate(id);
      return;
    }
    this.patch({ busy: true, error: null });
    try {
      const data = await this.api.desktop({
        kind: "CompareFile",
        scope,
        path,
        base,
        target,
      });
      if (epoch !== this.epoch || serial !== this.opening) return;
      if (data.kind !== "FileComparison") throw Error("INVALID_RESPONSE");
      if (
        [data.base, data.target].some(
          (s) =>
            s.repo_id !== scope.repo_id || s.worktree_id !== scope.worktree_id,
        )
      )
        throw Error("SCOPE_DENIED");
      const tab: CodeTab = {
        id,
        path,
        base,
        target,
        data,
        scroll: existing?.scroll ?? 0,
        stale: false,
      };
      const tabs = this.state.tabs.filter((t) => t.id !== id);
      if (tabs.length >= 12) tabs.shift();
      this.patch({
        tabs: [...tabs, tab],
        activeTab: id,
        selection: null,
        busy: false,
      });
    } catch (e) {
      if (epoch === this.epoch && serial === this.opening) this.error(e);
    }
  }
  activate(id: string) {
    ++this.opening;
    this.patch({ activeTab: id, selection: null, busy: false });
  }
  close(id: string) {
    const tabs = this.state.tabs.filter((t) => t.id !== id);
    this.patch({
      tabs,
      activeTab:
        this.state.activeTab === id
          ? (tabs.at(-1)?.id ?? null)
          : this.state.activeTab,
      selection: null,
    });
  }
  setScroll(id: string, scroll: number) {
    const tab = this.state.tabs.find((t) => t.id === id);
    if (tab) tab.scroll = scroll;
  }
  selectCommit(oid: string) {
    this.patch({ selectedCommit: oid });
  }
  filterBranch(name: string) {
    this.patch({ branchFilter: name });
  }
  visibleCommits() {
    if (this.state.branchFilter === "all") return this.state.commits;
    const tip = this.state.branches.find(
      (b) => b.name === this.state.branchFilter,
    )?.oid;
    const visible = new Set<string>(tip ? [tip] : []);
    for (const c of this.state.commits)
      if (visible.has(c.oid)) c.parents.forEach((p) => visible.add(p));
    return this.state.commits.filter((c) => visible.has(c.oid));
  }
  async more() {
    if (this.state.openingRepository) return;
    const epoch = this.epoch;
    const cursor = this.state.cursor;
    if (!cursor) return;
    try {
      const r = await this.api.read({
        kind: "ListHistory",
        ...this.scope(),
        cursor,
        limit: 200,
      });
      if (
        epoch !== this.epoch ||
        r.kind !== "History" ||
        cursor !== this.state.cursor
      )
        return;
      this.patch({
        commits: [...this.state.commits, ...r.page.commits],
        cursor: r.page.cursor,
      });
    } catch (e) {
      this.error(e);
    }
  }
  async poll() {
    if (!this.state.repo || this.state.openingRepository) return;
    const scope = this.scope();
    const epoch = this.epoch;
    try {
      const r = await this.api.read({ kind: "GetRepoState", ...this.scope() });
      if (epoch !== this.epoch || r.kind !== "RepoState") return;
      if (
        r.state.repo_id !== scope.repo_id ||
        r.state.worktree_id !== scope.worktree_id
      )
        throw Error("SCOPE_DENIED");
      const generation = r.state.generation;
      const changed = generation !== this.state.repo?.generation;
      this.patch({
        repo: r.state,
        historyStale: this.state.historyStale || changed,
        tabs: this.state.tabs.map((t) => ({
          ...t,
          stale:
            t.stale ||
            ([t.base, t.target].some((r) => typeof r === "string") &&
              generation !== t.data.observed_generation),
        })),
      });
      if (changed) {
        const files = await this.api.desktop({
          kind: "ListFiles",
          scope: this.scope(),
          revision: null,
        });
        if (epoch === this.epoch && files.kind === "Files")
          this.patch({ paths: files.paths });
      }
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  async refreshHistory() {
    if (
      !this.state.repo ||
      this.state.historyBusy ||
      this.state.openingRepository
    )
      return;
    this.patch({ historyBusy: true });
    const epoch = this.epoch;
    try {
      const repo = await this.api.desktop({
        kind: "OpenRepository",
        path: this.state.root,
      });
      const page = await this.api.read({
        kind: "ListHistory",
        ...this.scope(),
        cursor: null,
        limit: 200,
      });
      if (
        epoch !== this.epoch ||
        repo.kind !== "Repository" ||
        page.kind !== "History"
      )
        return;
      this.patch({
        branches: repo.branches,
        commits: page.page.commits,
        cursor: page.page.cursor,
        historyStale: false,
        historyBusy: false,
      });
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    } finally {
      if (epoch === this.epoch) this.patch({ historyBusy: false });
    }
  }
  explain(side: Side, startLine: number, endLine: number) {
    const tab = this.active();
    if (!tab) return;
    this.patch({
      selection: {
        comparisonId: tab.data.comparison.id,
        snapshotId: side === "Old" ? tab.data.base.id : tab.data.target.id,
        path: tab.path,
        side,
        startLine,
        endLine,
      },
      explanationOpen: true,
    });
  }
  setExplanationLayout(layout: "panel" | "popover") {
    this.patch({ explanationLayout: layout });
  }
  showExplanation(open: boolean) {
    this.patch({ explanationOpen: open });
  }
}
