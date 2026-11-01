import { it, expect, vi } from "vitest";
import { Workspace } from "../src/workspace";
import {
  SessionController,
  SESSION_KEY,
  captureSession,
  readSession,
} from "../src/features/session/session";

const oid = "a".repeat(40),
  parent = "b".repeat(40);
const path = (name: string) => ({
  display: name,
  raw_base64: btoa(name),
  encoding: "unix_bytes" as const,
});
const saved = () => ({
  version: 1 as const,
  root: "/repo",
  tabs: [
    {
      path: path("Old.cs"),
      base: { Commit: { oid: parent } },
      target: { Commit: { oid } },
      scroll: 210,
    },
    { path: path("Live.cs"), base: "Index", target: "Worktree", scroll: 45 },
  ],
  activeIndex: 0,
  selectedCommit: oid,
  selectedCommitBase: parent,
  filesFollowCommit: true,
  branchFilter: "all",
  settings: { view: "split", light: false },
});
function fixture(data: unknown = saved()) {
  const values = new Map([[SESSION_KEY, JSON.stringify(data)]]);
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const repo = {
    repo_id: "repo",
    worktree_id: "wt",
    generation: "g",
    status_entries: [],
  };
  const desktop = vi.fn(async (r: any): Promise<any> => {
    if (r.kind === "OpenRepository")
      return { kind: "Repository", root: r.path, state: repo, branches: [] };
    if (r.kind === "ListFiles") return { kind: "Files", paths: [] };
    if (r.kind === "LearningList") return { kind: "LearningList", items: [] };
    if (r.kind === "CommitDetails")
      return { kind: "CommitDetails", oid: r.oid, base_oid: parent, paths: [] };
    if (r.kind === "CompareFile")
      return {
        kind: "FileComparison",
        comparison: { id: r.path.display },
        base: { ...repo, id: "old", files: [] },
        target: { ...repo, id: "new", files: [] },
      };
    return { kind: "Remotes", remotes: [] };
  });
  const read = vi.fn(async (r: any): Promise<any> =>
    r.kind === "ListHistory"
      ? { kind: "History", page: { commits: [], cursor: null } }
      : { kind: "Decisions", decisions: [], truncated: false },
  );
  const w = new Workspace({ desktop, read });
  const controller = new SessionController(w, storage);
  return { w, controller, desktop, storage, values };
}
it("restores ordered historical/live tabs, active tab, scroll and selected commit only once", async () => {
  const { w, controller, desktop } = fixture();
  const apply = vi.fn();
  await Promise.all([controller.restore(apply), controller.restore(apply)]);
  expect(
    desktop.mock.calls.filter(([r]) => r.kind === "OpenRepository"),
  ).toHaveLength(1);
  expect(w.state.tabs.map((t) => t.path.display)).toEqual([
    "Old.cs",
    "Live.cs",
  ]);
  expect(w.active()?.path.display).toBe("Old.cs");
  expect(w.active()?.scroll).toBe(210);
  expect(w.state.selectedCommit).toBe(oid);
  expect(w.state.filesCommit).toEqual({ oid, base: parent });
  expect(desktop).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "CompareFile",
      base: "Index",
      target: "Worktree",
    }),
  );
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ view: "split" }),
  );
  expect(captureSession(w, {}).tabs[0]).not.toHaveProperty("data");
});
it("rejects corrupt, huge or executable-looking state instead of replaying actions", () => {
  for (const value of [
    null,
    "{}",
    "{bad",
    JSON.stringify({ ...saved(), version: 2 }),
    "x".repeat(200000),
    JSON.stringify({
      ...saved(),
      tabs: [{ path: path("x"), base: { Command: "rm" }, target: "Worktree" }],
    }),
  ])
    expect(readSession(value)).toBeNull();
});
it("retains the saved session when a project cannot be opened", async () => {
  const { controller, desktop, storage } = fixture();
  const original = storage.getItem(SESSION_KEY);
  desktop.mockRejectedValue({ code: "REPO_NOT_FOUND" });
  const result = await controller.restore(() => {});
  controller.save({});
  expect(result.warnings.join(" ")).toContain("REPO_NOT_FOUND");
  expect(storage.getItem(SESSION_KEY)).toBe(original);
});
it("skips one unavailable version and restores the remaining tabs without erasing recovery data", async () => {
  const { controller, desktop, w, storage } = fixture();
  const original = storage.getItem(SESSION_KEY),
    impl = desktop.getMockImplementation()!;
  desktop.mockImplementation(async (r: any) => {
    if (r.kind === "CompareFile" && r.path.display === "Old.cs")
      throw { code: "SNAPSHOT_NOT_FOUND" };
    return impl(r);
  });
  const result = await controller.restore(() => {});
  expect(w.state.tabs.map((t) => t.path.display)).toEqual(["Live.cs"]);
  expect(result.warnings.join(" ")).toContain("Old.cs");
  controller.save({});
  expect(storage.getItem(SESSION_KEY)).toBe(original);
});
it("manual navigation wins over a delayed restoration and no subsequent saved tabs are opened", async () => {
  const { controller, desktop, w } = fixture();
  const impl = desktop.getMockImplementation()!;
  let finish!: () => void;
  desktop.mockImplementation(async (r: any) => {
    if (r.kind === "CompareFile" && r.path.display === "Old.cs")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return impl(r);
  });
  const restoring = controller.restore(() => {});
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  w.selectCommit("c".repeat(40));
  finish();
  await restoring;
  expect(w.state.selectedCommit).toBe("c".repeat(40));
  expect(w.state.tabs).toHaveLength(0);
  expect(
    desktop.mock.calls.some(
      ([r]) => r.kind === "CompareFile" && r.path.display === "Live.cs",
    ),
  ).toBe(false);
});

it("closing a restored tab cancels a second in-flight file without reopening it", async () => {
  const { controller, desktop, w } = fixture();
  const impl = desktop.getMockImplementation()!;
  let finish!: () => void;
  desktop.mockImplementation(async (r: any) => {
    if (r.kind === "CompareFile" && r.path.display === "Live.cs")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return impl(r);
  });
  const restoring = controller.restore(() => {});
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(w.state.tabs).toHaveLength(1);
  w.close(w.state.tabs[0].id);
  finish();
  await restoring;
  expect(w.state.tabs).toHaveLength(0);
  expect(w.state.activeTab).toBeNull();
  expect(w.state.busy).toBe(false);
});
