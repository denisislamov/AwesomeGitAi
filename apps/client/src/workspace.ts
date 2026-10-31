import explanationPolicy from "../../../docs/integrations/explanation-quality.md?raw";
import {
  transition,
  validateTrace,
  type StepAction,
} from "./features/trace/transition";
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
  DecisionView,
  ReviewState,
  GitAction,
  GitJob,
  LearningItem,
  LearningRecord,
  SourceLocation,
  CodeRelationsReport,
} from "../../../packages/api/src/generated";
export type RecordedAnchor = {
  comparison_id: string;
  snapshot_id: string;
  path: string;
  side: "old" | "new";
  start_line: number;
  end_line: number;
};
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
// A recorded review can use two distinct snapshots of identical content.
export function isRecordedReview(tab: CodeTab): boolean {
  if (
    ![tab.base, tab.target].every(
      (r) => typeof r === "object" && "Snapshot" in r,
    )
  )
    return false;
  const a = tab.data.base,
    b = tab.data.target;
  if (
    a.exclusions?.length ||
    b.exclusions?.length ||
    a.files.length !== b.files.length
  )
    return false;
  const files = new Map(a.files.map((f) => [f.path.raw_base64, f]));
  return b.files.every((f) => {
    const old = files.get(f.path.raw_base64);
    return old && old.state === f.state && old.sha256 === f.sha256;
  });
}
export type RelationsState = {
  key: string;
  snapshotId: string;
  path: RepoPath;
  loading: boolean;
  report: CodeRelationsReport | null;
  error: string | null;
  open: boolean;
  symbolId: string | null;
};
type State = {
  recordedLocation: CodeSelection | null;
  relations: RelationsState | null;
  relationBack: {
    tab: CodeTab;
    selection: CodeSelection | null;
    relations: RelationsState;
  } | null;
  relationLocation: {
    snapshotId: string;
    path: RepoPath;
    line: number;
    column: number;
  } | null;
  learningMode: "explanation" | "trace" | "diagram";
  learningItems: LearningItem[];
  learningRecord: LearningRecord | null;
  traceStep: string | null;
  traceFrame: string | null;
  tracePreviousStep: string | null;
  learningLocation: { snapshotId: string; location: SourceLocation } | null;
  gitJob: GitJob | null;
  gitStarting: boolean;
  gitRemotes: string[];
  gitPreview: {
    id: string;
    before: string;
    after: string;
    generation: string;
    path: string;
  } | null;
  explanations: DecisionView[];
  explanationsTruncated: boolean;
  explanationsError: string | null;
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
        Empty: "Empty tree",
        Head: "HEAD",
        Index: "Index",
        Worktree: "Worktree",
      }[r]
    : "Commit" in r
      ? r.Commit.oid.slice(0, 8)
      : `Snapshot ${r.Snapshot.id.slice(0, 8)}`;
export class Workspace {
  state: State = {
    relations: null,
    relationBack: null,
    recordedLocation: null,
    relationLocation: null,
    learningMode: "explanation",
    learningItems: [],
    learningRecord: null,
    traceStep: null,
    traceFrame: null,
    tracePreviousStep: null,
    learningLocation: null,
    gitJob: null,
    gitStarting: false,
    gitRemotes: [],
    gitPreview: null,
    explanations: [],
    explanationsTruncated: false,
    explanationsError: null,
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
  private learningRequest = 0;
  private learningNavigation = 0;
  private opening = 0;
  private relationsRequest = 0;
  private relationNavigation = 0;
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
    const code =
      typeof e === "object" && e && "code" in e ? String(e.code) : String(e);
    this.patch({
      error:
        code === "HOST_TIMEOUT"
          ? "The local Git service took too long to respond. Your open code is preserved. Try again shortly."
          : code === "HOST_OFFLINE"
            ? "The local Git service is unavailable. This is a local process, not an Internet connection."
            : code,
      busy: false,
    });
  }
  clearStoredContext() {
    ++this.epoch;
    ++this.opening;
    ++this.learningRequest;
    ++this.learningNavigation;
    ++this.relationsRequest;
    ++this.relationNavigation;
    this.patch({
      tabs: [],
      activeTab: null,
      selection: null,
      explanations: [],
      explanationsTruncated: false,
      explanationsError: null,
      learningItems: [],
      learningRecord: null,
      learningLocation: null,
      traceStep: null,
      traceFrame: null,
      tracePreviousStep: null,
      relations: null,
      relationBack: null,
      relationLocation: null,
      gitPreview: null,
      busy: false,
    });
  }
  async openRepository(path: string) {
    let epoch = ++this.epoch;
    ++this.opening;
    this.patch({
      busy: true,
      error: null,
      openingRepository: true,
      relations: null,
      relationBack: null,
      relationLocation: null,
    });
    try {
      const r = await this.api.desktop({ kind: "OpenRepository", path });
      if (r.kind !== "Repository") throw Error("INVALID_RESPONSE");
      if (epoch !== this.epoch) return;
      epoch = ++this.epoch; // Accepting a new scope invalidates every old-scope request.
      this.patch({
        learningItems: [],
        learningRecord: null,
        traceStep: null,
        traceFrame: null,
        tracePreviousStep: null,
        learningLocation: null,
        gitPreview: null,
        gitRemotes: [],
        openingRepository: false,
        repo: r.state,
        root: r.root,
        branches: r.branches,
        tabs: [],
        explanations: [],
        explanationsTruncated: false,
        explanationsError: null,
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
      void this.refreshRemotes();
      void this.refreshLearning();
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
  setLearningMode(mode: State["learningMode"]) {
    this.patch({ learningMode: mode, explanationOpen: true });
    void this.refreshLearning();
  }
  async refreshLearning() {
    if (!this.state.repo || this.state.openingRepository) return;
    const epoch = this.epoch;
    try {
      const r = await this.api.desktop({
        kind: "LearningList",
        scope: this.scope(),
      });
      if (epoch === this.epoch && r.kind === "LearningList")
        this.patch({ learningItems: r.items });
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  async openLearning(id: string) {
    const item = this.state.learningItems.find((i) => i.id === id);
    if (!item || this.state.openingRepository) return;
    const epoch = this.epoch;
    const serial = ++this.learningRequest;
    try {
      const r = await this.api.desktop({
        kind: "LearningGet",
        scope: this.scope(),
        id,
        artifact_kind: item.kind,
      });
      if (
        epoch !== this.epoch ||
        serial !== this.learningRequest ||
        r.kind !== "LearningRecord"
      )
        return;
      const t = r.record.trace;
      if (t) validateTrace(t);
      const step = t?.steps[0];
      this.patch({
        learningRecord: r.record,
        learningMode: t ? "trace" : "diagram",
        traceStep: step?.id ?? null,
        traceFrame: step?.frames.at(-1)?.id ?? null,
        tracePreviousStep: null,
        learningLocation: null,
      });
      const location =
        step?.location ??
        r.record.diagram?.nodes.find((n) => n.location)?.location;
      if (location) await this.openLearningLocation(location);
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  async openLearningLocation(location: SourceLocation) {
    const r = this.state.learningRecord;
    if (!r || this.state.openingRepository) return;
    const allowed = [
      ...(r.trace?.steps.flatMap((s) => [
        s.location,
        ...s.frames.map((f) => f.location),
      ]) ?? []),
      ...(r.diagram?.nodes.map((n) => n.location) ?? []),
    ];
    const match = allowed.find(
      (l) =>
        l &&
        l.line === location.line &&
        l.path.raw_base64 === location.path.raw_base64,
    );
    if (!match) return;
    const epoch = this.epoch;
    const navigation = ++this.learningNavigation;
    await this.openFile(
      match.path,
      { Snapshot: { id: r.item.snapshot_id } },
      { Snapshot: { id: r.item.snapshot_id } },
    );
    if (
      epoch === this.epoch &&
      navigation === this.learningNavigation &&
      this.state.learningRecord?.item.id === r.item.id
    )
      this.patch({
        learningLocation: { snapshotId: r.item.snapshot_id, location: match },
      });
  }
  async moveTrace(action: StepAction | "back" | "restart") {
    const t = this.state.learningRecord?.trace,
      id = this.state.traceStep;
    if (!t || !id) return;
    const i = t.steps.findIndex((s) => s.id === id);
    const next =
      action === "restart"
        ? t.entry_step
        : action === "back"
          ? t.steps[Math.max(0, i - 1)].id
          : transition(t, id, action);
    const step = t.steps.find((s) => s.id === next)!;
    ++this.learningNavigation;
    this.patch({
      tracePreviousStep: id,
      traceStep: next,
      traceFrame: step.frames.at(-1)?.id ?? null,
      learningLocation: null,
    });
    if (step.location) await this.openLearningLocation(step.location);
  }
  async chooseTraceFrame(id: string) {
    const frame = this.state.learningRecord?.trace?.steps
      .find((s) => s.id === this.state.traceStep)
      ?.frames.find((f) => f.id === id);
    if (!frame) return;
    this.patch({ traceFrame: id });
    await this.openLearningLocation(frame.location);
  }
  async refreshRemotes() {
    if (!this.state.repo) return;
    const epoch = this.epoch;
    try {
      const r = await this.api.desktop({
        kind: "GitRemotes",
        scope: this.scope(),
      });
      if (epoch === this.epoch && r.kind === "GitRemotes")
        this.patch({ gitRemotes: r.names });
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  async runGit(action: GitAction) {
    if (
      !this.state.repo ||
      this.state.openingRepository ||
      this.state.gitStarting ||
      this.state.gitJob?.status === "Running"
    )
      return;
    const expected_generation = this.state.repo.generation;
    this.patch({ gitStarting: true, error: null });
    try {
      const r = await this.api.desktop({
        kind: "GitStart",
        scope: this.scope(),
        expected_generation,
        action,
      });
      if (r.kind !== "GitJob") throw Error("INVALID_RESPONSE");
      this.patch({ gitJob: r.job, gitPreview: null });
    } catch (e) {
      this.error(e);
    } finally {
      this.patch({ gitStarting: false });
    }
  }
  async createRepository(path: string, source: string | null) {
    if (this.state.gitStarting || this.state.gitJob?.status === "Running")
      return;
    this.patch({ gitStarting: true, error: null });
    try {
      const r = await this.api.desktop({
        kind: "CreateRepository",
        path,
        source,
      });
      if (r.kind !== "GitJob") throw Error("INVALID_RESPONSE");
      this.patch({ gitJob: r.job });
    } catch (e) {
      this.error(e);
    } finally {
      this.patch({ gitStarting: false });
    }
  }
  async pollGit() {
    const job = this.state.gitJob;
    if (!job || job.status !== "Running") return;
    try {
      const r = await this.api.desktop({ kind: "GitPoll", id: job.id });
      if (r.kind !== "GitJob" || this.state.gitJob?.id !== job.id) return;
      if (r.job.status !== "Running" && this.state.root === r.job.root) {
        await this.poll();
        await this.refreshHistory();
        void this.refreshRemotes();
      }
      if (this.state.gitJob?.id === job.id) this.patch({ gitJob: r.job });
    } catch (e) {
      this.error(e);
    }
  }
  async cancelGit() {
    const id = this.state.gitJob?.id;
    if (id)
      try {
        await this.api.desktop({ kind: "GitCancel", id });
      } catch (e) {
        this.error(e);
      }
  }
  async prepareSelection(old_lines: number[], new_lines: number[]) {
    const tab = this.active();
    if (!tab || tab.stale || this.state.openingRepository || !this.state.repo)
      return;
    const unstage = tab.base === "Head" && tab.target === "Index";
    if (!unstage && !(tab.base === "Index" && tab.target === "Worktree"))
      return;
    const epoch = this.epoch,
      comparison_id = tab.data.comparison.id,
      expected_generation = this.state.repo.generation;
    try {
      const r = await this.api.desktop({
        kind: "PrepareSelection",
        scope: this.scope(),
        comparison_id,
        path: tab.path,
        expected_generation,
        old_lines,
        new_lines,
        unstage,
      });
      if (
        epoch === this.epoch &&
        this.active()?.data.comparison.id === comparison_id &&
        r.kind === "PreparedSelection"
      )
        this.patch({
          gitPreview: {
            ...r,
            generation: expected_generation,
            path: tab.path.display,
          },
        });
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  dismissGitPreview() {
    this.patch({ gitPreview: null });
  }
  async applyGitPreview() {
    const p = this.state.gitPreview;
    if (!p) return;
    if (p.generation !== this.state.repo?.generation) {
      this.error({ code: "STALE_STATE" });
      return;
    }
    await this.runGit({ kind: "ApplyPrepared", id: p.id });
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
  /** Request identity includes immutable source snapshot and byte-exact path. */
  private relationKey(tab: CodeTab) {
    return JSON.stringify([
      tab.data.target.repo_id,
      tab.data.target.worktree_id,
      tab.data.target.id,
      tab.path.raw_base64,
    ]);
  }
  async loadRelations(open = false, symbolId: string | null = null) {
    const tab = this.active();
    if (!tab || !this.state.repo || this.state.openingRepository) return;
    const key = this.relationKey(tab);
    if (
      this.state.relations?.key === key &&
      (this.state.relations.loading || this.state.relations.report)
    ) {
      if (open) this.showRelations(true, symbolId);
      return;
    }
    const epoch = this.epoch,
      request = ++this.relationsRequest;
    const current = () =>
      epoch === this.epoch &&
      request === this.relationsRequest &&
      this.active() &&
      this.relationKey(this.active()!) === key;
    this.patch({
      relations: {
        key,
        snapshotId: tab.data.target.id,
        path: tab.path,
        loading: true,
        report: null,
        error: null,
        open,
        symbolId,
      },
    });
    try {
      const result = await this.api.desktop({
        kind: "CodeRelations",
        scope: this.scope(),
        snapshot_id: tab.data.target.id,
        path: tab.path,
      });
      if (!current()) return;
      if (
        result.kind !== "CodeRelations" ||
        result.report.origin_snapshot_id !== tab.data.target.id
      )
        throw Error("RELATIONS_SNAPSHOT_MISMATCH");
      this.patch({
        relations: {
          ...this.state.relations!,
          loading: false,
          report: result.report,
        },
      });
    } catch (error) {
      if (current())
        this.patch({
          relations: {
            ...this.state.relations!,
            loading: false,
            error: String(error),
          },
        });
    } finally {
      if (
        epoch === this.epoch &&
        request === this.relationsRequest &&
        !current() &&
        this.state.relations?.key === key
      )
        this.patch({
          relations: { ...this.state.relations, loading: false, open: false },
        });
    }
  }
  showRelations(open: boolean, symbolId: string | null = null) {
    if (this.state.relations)
      this.patch({ relations: { ...this.state.relations, open, symbolId } });
  }
  async openRelationLocation(path: RepoPath, line = 1, column = 1) {
    const report = this.state.relations?.report,
      tab = this.active();
    if (!report || !tab || this.state.openingRepository) return;
    const samePath = (p: RepoPath) => p.raw_base64 === path.raw_base64;
    const allowed =
      (line === 1 && column === 1 && report.files.some(samePath)) ||
      report.symbols.some(
        (s) =>
          (samePath(s.path) && s.line === line && s.column === column) ||
          s.references.some(
            (r) => samePath(r.path) && r.line === line && r.column === column,
          ),
      );
    if (!allowed) return;
    const epoch = this.epoch,
      navigation = ++this.relationNavigation;
    if (!this.state.relationBack)
      this.patch({
        relationBack: {
          tab: { ...tab },
          selection: this.state.selection,
          relations: this.state.relations!,
        },
      });
    this.showRelations(false);
    const revision = { Snapshot: { id: report.snapshot_id } };
    await this.openFile(path, revision, revision);
    const active = this.active();
    if (
      epoch === this.epoch &&
      navigation === this.relationNavigation &&
      active?.data.target.id === report.snapshot_id &&
      samePath(active.path)
    )
      this.patch({
        relationLocation: {
          snapshotId: report.snapshot_id,
          path,
          line,
          column,
        },
      });
  }
  backFromRelations() {
    const back = this.state.relationBack;
    if (!back || this.state.openingRepository) return;
    ++this.opening;
    ++this.relationNavigation;
    ++this.relationsRequest;
    const tabs = this.state.tabs.filter((t) => t.id !== back.tab.id);
    if (tabs.length >= 12) tabs.shift();
    this.patch({
      tabs: [...tabs, back.tab],
      activeTab: back.tab.id,
      selection: back.selection,
      relations: { ...back.relations, open: false },
      relationLocation: null,
      relationBack: null,
      busy: false,
    });
    void this.refreshExplanations();
  }
  async openRecordedAnchor(anchor: RecordedAnchor): Promise<boolean> {
    if (!this.state.repo || this.state.openingRepository) return false;
    const epoch = this.epoch;
    const opening = this.opening;
    try {
      if (
        !anchor ||
        typeof anchor.path !== "string" ||
        !["old", "new"].includes(anchor.side) ||
        !Number.isInteger(anchor.start_line) ||
        !Number.isInteger(anchor.end_line) ||
        anchor.start_line < 1 ||
        anchor.end_line < anchor.start_line
      )
        throw Error("INVALID_ANCHOR");
      const r = await this.api.read({
        kind: "GetComparison",
        ...this.scope(),
        comparison_id: anchor.comparison_id,
      });
      if (epoch !== this.epoch || opening !== this.opening) return false;
      if (r.kind !== "Comparison") throw Error("INVALID_RESPONSE");
      const pair = r.comparison;
      if (
        (anchor.side === "old"
          ? pair.base_snapshot_id
          : pair.target_snapshot_id) !== anchor.snapshot_id
      )
        throw Error("INVALID_ANCHOR");
      const path: RepoPath = {
        display: anchor.path,
        raw_base64: btoa(
          Array.from(new TextEncoder().encode(anchor.path), (b) =>
            String.fromCharCode(b),
          ).join(""),
        ),
        encoding: "unix_bytes",
      };
      await this.openFile(
        path,
        { Snapshot: { id: pair.base_snapshot_id } },
        { Snapshot: { id: pair.target_snapshot_id } },
      );
      const active = this.active();
      if (
        epoch !== this.epoch ||
        !active ||
        active.path.raw_base64 !== path.raw_base64 ||
        active.data.base.id !== pair.base_snapshot_id ||
        active.data.target.id !== pair.target_snapshot_id
      )
        return false;
      this.setLearningMode("explanation");
      this.explain(
        anchor.side === "old" ? "Old" : "New",
        anchor.start_line,
        anchor.end_line,
      );
      this.patch({ recordedLocation: this.state.selection });
      return true;
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
      return false;
    }
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
    this.showRelations(false);
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
        relationLocation: null,
        explanations: [],
        explanationsTruncated: false,
        selection: null,
        busy: false,
      });
      void this.refreshExplanations();
      return;
    } catch (e) {
      if (epoch === this.epoch && serial === this.opening) this.error(e);
    }
  }
  activate(id: string) {
    ++this.opening;
    if (this.state.activeTab === id) {
      this.patch({ busy: false });
      return;
    }
    this.showRelations(false);
    this.patch({
      activeTab: id,
      relationLocation: null,
      selection: null,
      busy: false,
      explanations: [],
      explanationsTruncated: false,
    });
    void this.refreshExplanations();
  }
  close(id: string) {
    this.showRelations(false);
    const tabs = this.state.tabs.filter((t) => t.id !== id);
    this.patch({
      tabs,
      explanations: [],
      explanationsTruncated: false,
      activeTab:
        this.state.activeTab === id
          ? (tabs.at(-1)?.id ?? null)
          : this.state.activeTab,
      selection: null,
    });
    void this.refreshExplanations();
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
      if (epoch !== this.epoch || cursor !== this.state.cursor) return;
      if ((e as { code?: string })?.code === "STALE_STATE")
        await this.refreshHistory();
      else this.error(e);
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
            ([t.base, t.target].some(
              (r) => typeof r === "string" && r !== "Empty",
            ) &&
              generation !== t.data.observed_generation),
        })),
      });
      void this.refreshExplanations();
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
        error: null,
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
  async refreshExplanations() {
    const tab = this.active();
    if (!tab || this.state.openingRepository) return;
    const epoch = this.epoch;
    const comparisonId = tab.data.comparison.id;
    try {
      const result = await this.api.desktop({
        kind: "GetDecisions",
        scope: this.scope(),
        comparison_id: comparisonId,
        path: tab.path,
      });
      if (
        epoch !== this.epoch ||
        this.active()?.data.comparison.id !== comparisonId ||
        this.state.activeTab !== tab.id ||
        this.state.openingRepository
      )
        return;
      if (result.kind !== "Decisions") throw Error("INVALID_RESPONSE");
      this.patch({
        explanations: result.decisions,
        explanationsTruncated: result.truncated,
        explanationsError: null,
      });
    } catch (e) {
      if (
        epoch === this.epoch &&
        this.active()?.data.comparison.id === comparisonId &&
        this.state.activeTab === tab.id
      )
        this.patch({
          explanationsError:
            e && typeof e === "object" && "code" in e
              ? String(e.code)
              : String(e),
        });
    }
  }
  async reviewDecision(id: string, state: ReviewState, note = "") {
    const tab = this.active();
    const decision = this.state.explanations.find((d) => d.id === id);
    if (!tab || !decision || this.state.openingRepository) return;
    const epoch = this.epoch;
    try {
      await this.api.desktop({
        kind: "ReviewDecision",
        scope: this.scope(),
        decision_id: id,
        base_snapshot_id: tab.data.base.id,
        target_snapshot_id: tab.data.target.id,
        state,
        note,
        idempotency_key: crypto.randomUUID(),
      });
      if (epoch === this.epoch) await this.refreshExplanations();
    } catch (e) {
      if (epoch === this.epoch) this.error(e);
    }
  }
  async openDecision(id: string) {
    const d = this.state.explanations.find((d) => d.id === id);
    const tab = this.active();
    if (!d || !tab) return;
    await this.openFile(
      tab.path,
      { Snapshot: { id: d.base_snapshot_id } },
      { Snapshot: { id: d.target_snapshot_id } },
    );
  }
  explanationRequest() {
    const tab = this.active();
    if (!tab || !this.state.repo) return "";
    return JSON.stringify(
      {
        instruction:
          "Read integration_guide via AwesomeGitAi MCP and follow explanation_policy. Ask for Junior / Middle / Senior before explaining unless the user already chose for this task. Explain the selected source version using recorded facts; preserve provenance and do not invent alternatives or execution results.",
        explanation_policy: explanationPolicy,
        schema_version: 1,
        ...this.scope(),
        comparison_id: tab.data.comparison.id,
        base_snapshot_id: tab.data.base.id,
        target_snapshot_id: tab.data.target.id,
        path: tab.path.display,
        selection: this.state.selection,
      },
      null,
      2,
    );
  }
  setExplanationLayout(layout: "panel" | "popover") {
    this.patch({ explanationLayout: layout });
  }
  showExplanation(open: boolean) {
    this.patch({ explanationOpen: open });
  }
}
