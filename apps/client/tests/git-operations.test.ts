import { describe, it, expect } from "vitest";
import { Workspace } from "../src/workspace";
describe("guarded Git workspace", () => {
  it("never prepares historical or stale tabs", async () => {
    const calls: unknown[] = [];
    const w = new Workspace({
      read: async () => {
        throw Error("unused");
      },
      desktop: async (r) => {
        calls.push(r);
        throw Error("unexpected");
      },
    });
    w.state.repo = { repo_id: "r", worktree_id: "w", generation: "g" } as any;
    w.state.activeTab = "a";
    w.state.tabs = [
      {
        id: "a",
        base: "Head",
        target: "Worktree",
        stale: false,
        path: {},
        data: { comparison: { id: "c" } },
      } as any,
    ];
    await w.prepareSelection([1], [1]);
    expect(calls).toHaveLength(0);
    w.state.tabs[0].base = "Index";
    w.state.tabs[0].stale = true;
    await w.prepareSelection([1], [1]);
    expect(calls).toHaveLength(0);
  });
  it("ties Git writes to observed generation and keeps running jobs visible", async () => {
    const calls: any[] = [];
    const w = new Workspace({
      read: async () => {
        throw Error("unused");
      },
      desktop: async (r) => {
        calls.push(r);
        return {
          kind: "GitJob",
          job: {
            id: "j",
            root: "/r",
            status: "Running",
            error: null,
            cancel_requested: false,
            state_changed: false,
            outcome_uncertain: false,
          },
        };
      },
    });
    w.state.repo = { repo_id: "r", worktree_id: "w", generation: "g" } as any;
    await w.runGit({ kind: "Commit", message: "test" });
    await w.runGit({ kind: "Commit", message: "duplicate" });
    expect(calls).toHaveLength(1);
    expect(calls[0].expected_generation).toBe("g");
    expect(w.state.gitJob?.id).toBe("j");
  });
});
