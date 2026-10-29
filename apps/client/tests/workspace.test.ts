import { describe, it, expect } from "vitest";
import { Workspace, type WorkspaceApi } from "../src/workspace";
import type {
  DesktopRequest,
  DesktopResponse,
  ReadRequest,
  ReadResponse,
  RepoPath,
} from "../../../packages/api/src/generated";
const path: RepoPath = {
  display: "Code.cs",
  raw_base64: "Q29kZS5jcw==",
  encoding: "unix_bytes",
};
const state = {
  repo_id: "repo",
  worktree_id: "wt",
  generation: "g1",
  head_oid: "a",
  branch: "main",
  status_entries: [{ path, original_path: null, status: " M" }],
  capabilities: ["git.read"],
};
function fixture() {
  const calls: (DesktopRequest | ReadRequest)[] = [];
  let generation = "g1";
  const api: WorkspaceApi = {
    async read(r) {
      calls.push(r);
      if (r.kind === "GetRepoState")
        return { kind: "RepoState", state: { ...state, generation } };
      if (r.kind === "ListHistory")
        return {
          kind: "History",
          page: {
            commits: [
              {
                author: "Test",
                date: "2026-10-30T00:00:00Z",
                oid: "a",
                parents: ["b"],
                subject: "Latest",
              },
              {
                author: "Test",
                date: "2026-10-30T00:00:00Z",
                oid: "b",
                parents: [],
                subject: "First",
              },
            ],
            cursor: null,
          },
        };
      throw Error("Unexpected request");
    },
    async desktop(r) {
      calls.push(r);
      if (r.kind === "OpenRepository")
        return {
          kind: "Repository",
          state,
          root: "/repo",
          branches: [
            { name: "main", oid: "a", remote: false },
            { name: "feature", oid: "b", remote: false },
          ],
        };
      if (r.kind === "ListFiles") return { kind: "Files", paths: [path] };
      if (r.kind === "CompareFile") return comparison(r);
      throw Error("Unexpected request");
    },
  };
  return {
    api,
    calls,
    change() {
      generation = "g2";
    },
  };
}
function comparison(
  r: Extract<DesktopRequest, { kind: "CompareFile" }>,
): DesktopResponse {
  const revision = typeof r.target === "string" ? r.target : "Commit";
  const file = {
    path,
    state: "Present" as const,
    sha256: "hash",
    blob_oid: null,
    bytes: [97, 10],
    encoding: "utf8",
    newline: "lf",
    stages: [],
  };
  const s = {
    repo_id: "repo",
    worktree_id: "wt",
    generation: "g1",
    files: [file],
    exclusions: [],
    captured_at: "0",
  };
  return {
    kind: "FileComparison",
    comparison: {
      id: "cmp" + revision,
      base_snapshot_id: "old" + revision,
      target_snapshot_id: "new" + revision,
      file_pairs: [{ old_path: path, new_path: path }],
      diff_algorithm_version: "path-pairs-v1",
    },
    base: { ...s, id: "old" + revision, layer: "Index" },
    target: { ...s, id: "new" + revision, layer: "Worktree" },
    observed_generation: "g1",
  };
}
describe("workspace safety and navigation", () => {
  it("branch selection filters loaded ancestry without checkout or changing code", async () => {
    const f = fixture();
    const w = new Workspace(f.api);
    await w.openRepository("/repo");
    await w.openFile(path);
    const selected = w.state.activeTab;
    w.filterBranch("feature");
    expect(w.visibleCommits().map((c) => c.oid)).toEqual(["b"]);
    expect(w.state.activeTab).toBe(selected);
    expect(f.calls.some((c) => c.kind.includes("Checkout"))).toBe(false);
  });
  it("commit selection is separate from working code and opening history preserves scroll", async () => {
    const f = fixture();
    const w = new Workspace(f.api);
    await w.openRepository("/repo");
    await w.openFile(path);
    const working = w.state.activeTab;
    w.setScroll(working!, 420);
    w.selectCommit("b");
    expect(w.state.activeTab).toBe(working);
    await w.openFile(path, { Commit: { oid: "a" } }, { Commit: { oid: "b" } });
    w.activate(working!);
    expect(w.active()?.scroll).toBe(420);
    expect(w.active()?.data.target.id).toBe("newWorktree");
  });
  it("a new repo generation marks pinned working code stale without replacing bytes", async () => {
    const f = fixture();
    const w = new Workspace(f.api);
    await w.openRepository("/repo");
    await w.openFile(path);
    const pinned = w.active()?.data;
    f.change();
    await w.poll();
    expect(w.active()?.stale).toBe(true);
    expect(w.active()?.data).toBe(pinned);
    expect(w.state.historyStale).toBe(true);
  });
  it("panel and popover use the same exact snapshot and line selection", async () => {
    const f = fixture();
    const w = new Workspace(f.api);
    await w.openRepository("/repo");
    await w.openFile(path);
    w.explain("New", 1, 1);
    const selection = w.state.selection;
    w.setExplanationLayout("popover");
    expect(w.state.selection).toBe(selection);
    expect(selection).toMatchObject({
      snapshotId: "newWorktree",
      comparisonId: "cmpWorktree",
      startLine: 1,
      endLine: 1,
    });
  });
  it("out-of-order file responses cannot steal focus from the last selection", async () => {
    const f = fixture();
    let release!: () => void;
    const original = f.api.desktop;
    f.api.desktop = async (r) => {
      if (r.kind === "CompareFile" && r.path.display === "Slow.cs")
        await new Promise<void>((yes) => (release = yes));
      return original(r);
    };
    const w = new Workspace(f.api);
    await w.openRepository("/repo");
    const slow = w.openFile({
      ...path,
      display: "Slow.cs",
      raw_base64: "U2xvdy5jcw==",
    });
    await w.openFile(path);
    release();
    await slow;
    expect(w.active()?.path.display).toBe("Code.cs");
  });
});

it("graph retains both merge parents and converges on the shared ancestor", async () => {
  const { graphRows } = await import("../src/features/git-log/GitLog");
  const c = (oid: string, parents: string[]) => ({
    oid,
    parents,
    subject: oid,
    author: "A",
    date: "2026-10-30T00:00:00Z",
  });
  const rows = graphRows([
    c("merge", ["left", "right"]),
    c("left", ["base"]),
    c("right", ["base"]),
    c("base", []),
  ]);
  expect(rows[0].after).toEqual(["left", "right"]);
  expect(rows[0].edges).toEqual([0, 1]);
  expect(rows[2].before).toEqual(["base", "right"]);
  expect(rows[2].edges).toEqual([0]);
  expect(rows[3].after).toEqual([]);
});

it("switching to an existing tab cancels a pending file selection", async () => {
  const f = fixture();
  let release!: () => void;
  const original = f.api.desktop;
  f.api.desktop = async (r) => {
    if (r.kind === "CompareFile" && r.path.display === "Slow.cs")
      await new Promise<void>((yes) => (release = yes));
    return original(r);
  };
  const w = new Workspace(f.api);
  await w.openRepository("/repo");
  await w.openFile(path);
  const id = w.state.activeTab!;
  const pending = w.openFile({
    ...path,
    display: "Slow.cs",
    raw_base64: "U2xvdy5jcw==",
  });
  w.activate(id);
  release();
  await pending;
  expect(w.state.activeTab).toBe(id);
  expect(w.state.busy).toBe(false);
});
