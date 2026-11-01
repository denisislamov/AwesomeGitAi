import type {
  RepoPath,
  Revision,
} from "../../../../../packages/api/src/generated";
import type { Workspace } from "../../workspace";
import type { PanelSettings } from "../layout/sync";
import { FONT_SCALES } from "../appearance/fontScale";

export const SESSION_KEY = "agai-workspace-session-v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type SavedTab = {
  path: RepoPath;
  base: Revision;
  target: Revision;
  scroll: number;
};
export type SavedSession = {
  version: 1;
  root: string;
  tabs: SavedTab[];
  activeIndex: number;
  selectedCommit: string | null;
  selectedCommitBase: string | null;
  filesFollowCommit: boolean;
  branchFilter: string;
  settings: PanelSettings;
};
const oid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40,64}$/.test(v);
const revision = (v: any): v is Revision =>
  ["Empty", "Head", "Index", "Worktree"].includes(v) ||
  (!!v &&
    typeof v === "object" &&
    (oid(v.Commit?.oid) ||
      (typeof v.Snapshot?.id === "string" &&
        /^[a-f0-9-]{36}$/.test(v.Snapshot.id))));
const path = (v: any): v is RepoPath =>
  !!v &&
  typeof v.display === "string" &&
  v.display.length > 0 &&
  v.display.length < 16384 &&
  !v.display.includes("\0") &&
  v.encoding === "unix_bytes" &&
  typeof v.raw_base64 === "string" &&
  v.raw_base64.length > 0 &&
  v.raw_base64.length < 32768 &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    v.raw_base64,
  );
function settings(v: any): PanelSettings {
  const out: PanelSettings = {};
  if (!v || typeof v !== "object") return out;
  if (v.view === "unified" || v.view === "split") out.view = v.view;
  if (v.mode === "work" || v.mode === "index") out.mode = v.mode;
  if (FONT_SCALES.includes(v.scale)) out.scale = v.scale;
  for (const k of ["light", "showDeleted", "ignoreWhitespace"] as const)
    if (typeof v[k] === "boolean") out[k] = v[k];
  return out;
}
export function readSession(raw: string | null): SavedSession | null {
  try {
    if (!raw || raw.length > 131072) return null;
    const v = JSON.parse(raw);
    if (
      v.version !== 1 ||
      typeof v.root !== "string" ||
      !v.root.startsWith("/") ||
      v.root.length > 16384 ||
      v.root.includes("\0") ||
      !Array.isArray(v.tabs) ||
      v.tabs.length > 12 ||
      !v.tabs.every(
        (t: any) => path(t.path) && revision(t.base) && revision(t.target),
      )
    )
      return null;
    const tabs: SavedTab[] = v.tabs.map((t: any) => ({
      path: {
        display: t.path.display,
        raw_base64: t.path.raw_base64,
        encoding: "unix_bytes",
      },
      base: t.base,
      target: t.target,
      scroll: Number.isFinite(t.scroll)
        ? Math.max(0, Math.min(1e8, t.scroll))
        : 0,
    }));
    return {
      version: 1,
      root: v.root,
      tabs,
      activeIndex:
        Number.isInteger(v.activeIndex) &&
        v.activeIndex >= 0 &&
        v.activeIndex < tabs.length
          ? v.activeIndex
          : tabs.length - 1,
      selectedCommit: oid(v.selectedCommit) ? v.selectedCommit : null,
      selectedCommitBase: oid(v.selectedCommitBase)
        ? v.selectedCommitBase
        : null,
      filesFollowCommit: v.filesFollowCommit === true,
      branchFilter:
        typeof v.branchFilter === "string" && v.branchFilter.length < 2048
          ? v.branchFilter
          : "all",
      settings: settings(v.settings),
    };
  } catch {
    return null;
  }
}
export function captureSession(
  w: Workspace,
  view: PanelSettings,
): SavedSession {
  return {
    version: 1,
    root: w.state.root,
    tabs: w.state.tabs.slice(0, 12).map((t) => ({
      path: t.path,
      base: t.base,
      target: t.target,
      scroll: t.scroll,
    })),
    activeIndex: w.state.tabs.findIndex((t) => t.id === w.state.activeTab),
    selectedCommit: w.state.selectedCommit,
    selectedCommitBase: w.state.selectedCommitBase,
    filesFollowCommit: !!w.state.filesCommit,
    branchFilter: w.state.branchFilter,
    settings: settings(view),
  };
}
export type RestoreResult = { warnings: string[]; restored: boolean };
export class SessionController {
  restoring = false;
  private started: Promise<RestoreResult> | null = null;
  private cancelled = false;
  private blockedAt: number | null = null;
  private lastWritten = "";
  constructor(
    private w: Workspace,
    private storage: Storage | null,
  ) {}
  restore(applySettings: (s: PanelSettings) => void): Promise<RestoreResult> {
    return (this.started ??= this.run(applySettings));
  }
  cancel() {
    if (!this.restoring) return;
    this.cancelled = true;
    this.w.cancelPendingNavigation();
    this.restoring = false;
  }
  save(view: PanelSettings) {
    if (
      !this.storage ||
      this.restoring ||
      !this.w.state.repo ||
      !this.w.state.root ||
      this.w.state.openingRepository ||
      this.w.state.busy ||
      this.blockedAt === this.w.navigationVersion
    )
      return;
    try {
      const value = JSON.stringify(captureSession(this.w, view));
      if (value !== this.lastWritten) {
        this.storage.setItem(SESSION_KEY, value);
        this.lastWritten = value;
      }
    } catch {
      /* Optional local settings must not block code navigation. */
    }
  }
  private async run(
    applySettings: (s: PanelSettings) => void,
  ): Promise<RestoreResult> {
    const result: RestoreResult = { warnings: [], restored: false };
    let saved: SavedSession | null = null;
    try {
      const raw = this.storage?.getItem(SESSION_KEY) ?? null;
      saved = readSession(raw);
      if (!raw) {
        const recent = JSON.parse(
          this.storage?.getItem("agai-recent-repos") ?? "[]",
        );
        if (Array.isArray(recent) && typeof recent[0] === "string")
          saved = readSession(
            JSON.stringify({ version: 1, root: recent[0], tabs: [] }),
          );
      }
    } catch {
      /* Corrupt or disabled storage behaves like a first launch. */
    }
    if (!saved) return result;
    this.restoring = true;
    let expected = this.w.navigationVersion;
    const current = () =>
      !this.cancelled && this.w.navigationVersion === expected;
    const invoke = async (action: () => Promise<void>) => {
      const pending = action();
      expected = this.w.navigationVersion;
      await pending;
      return current();
    };
    try {
      applySettings(saved.settings);
      if (!(await invoke(() => this.w.openRepository(saved!.root))))
        return result;
      if (!this.w.state.repo || this.w.state.error) {
        result.warnings.push(
          `Could not reopen ${saved.root}: ${this.w.state.error ?? "repository unavailable"}`,
        );
        return result;
      }
      result.restored = true;
      const opened: (string | null)[] = [];
      for (const tab of saved.tabs) {
        if (!current()) return result;
        if (
          !(await invoke(() =>
            this.w.openFile(tab.path, tab.base, tab.target, false, tab.scroll),
          ))
        )
          return result;
        const id = JSON.stringify([tab.path.raw_base64, tab.base, tab.target]);
        const found = this.w.state.tabs.find((t) => t.id === id);
        opened.push(found ? id : null);
        if (found) this.w.setScroll(id, tab.scroll);
        else
          result.warnings.push(
            `Could not restore ${tab.path.display}: ${this.w.state.error ?? "version unavailable"}`,
          );
      }
      if (!current()) return result;
      const active = opened[saved.activeIndex] ?? opened.filter(Boolean).at(-1);
      if (saved.selectedCommit) {
        try {
          await this.w.api.desktop({
            kind: "CommitDetails",
            scope: this.w.scope(),
            oid: saved.selectedCommit,
            base: saved.selectedCommitBase,
          });
          if (!current()) return result;
          this.w.selectCommit(saved.selectedCommit, saved.selectedCommitBase);
          expected = this.w.navigationVersion;
        } catch (e) {
          if (!current()) return result;
          result.warnings.push(
            `Could not restore selected commit: ${(e as any)?.code ?? String(e)}`,
          );
        }
      }
      if (active) {
        this.w.activate(active);
        expected = this.w.navigationVersion;
        if (saved.filesFollowCommit && this.w.state.selectedCommit)
          this.w.selectCommit(
            this.w.state.selectedCommit,
            this.w.state.selectedCommitBase,
          );
        expected = this.w.navigationVersion;
      }
      this.w.filterBranch(
        this.w.state.branches.some((b) => b.name === saved!.branchFilter)
          ? saved.branchFilter
          : "all",
      );
    } catch (e) {
      result.warnings.push(
        `Could not restore previous session: ${(e as any)?.code ?? String(e)}`,
      );
    } finally {
      this.restoring = false;
      if (result.warnings.length) this.blockedAt = this.w.navigationVersion;
    }
    return result;
  }
}
