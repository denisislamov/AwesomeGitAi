import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Workspace, type CodeTab } from "../src/workspace";
import { coverage } from "../src/features/explanation/coverage";
import { ExplanationPanel } from "../src/features/explanation/ExplanationPanel";
import type { DecisionView } from "../../../packages/api/src/generated";
const path = {
  display: "a.cs",
  raw_base64: "YS5jcw==",
  encoding: "unix_bytes" as const,
};
const file = (s: string) => ({
  path,
  state: "Present",
  bytes: [...new TextEncoder().encode(s)],
});
const tab = {
  id: "tab",
  path,
  data: {
    kind: "FileComparison",
    comparison: { id: "comparison" },
    base: { id: "base", files: [file("old\n")] },
    target: { id: "target", files: [file("new\n")] },
  },
} as CodeTab;
const decision = {
  id: "d",
  revision: 1,
  session_id: "s",
  summary: "Changed",
  behavior: "new behavior",
  rationale: "reason",
  constraints: [],
  alternatives: [],
  anchors: [
    {
      anchor: { path, start_line: 1, end_line: 1, side: "New" },
      resolution: "Exact",
    },
  ],
  evidence: [],
  source: "agent_reported",
  superseded_by: null,
  supersedes: null,
  supersede_reason: null,
  base_snapshot_id: "base",
  target_snapshot_id: "target",
  review: null,
} as DecisionView;
it("copies audience guidance alongside exact source scope before an agent explains code", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.tabs = [tab];
  w.state.activeTab = tab.id;
  w.state.repo = { repo_id: "repo", worktree_id: "worktree" } as any;
  const request = JSON.parse(w.explanationRequest());
  expect(request.explanation_policy).toContain("Junior / Middle / Senior");
  expect(request.explanation_policy).toContain(
    "Do not record an explanation until",
  );
  expect(request.path).toBe("a.cs");
  expect(request.target_snapshot_id).toBe("target");
  expect(request.comparison_id).toBe("comparison");
});
it("counts changed old and new lines, excluding unbound and superseded explanations", () => {
  expect(coverage(tab, [decision])).toEqual({ total: 2, explained: 1 });
  expect(
    coverage(tab, [{ ...decision, base_snapshot_id: "other" }]).explained,
  ).toBe(0);
  expect(coverage(tab, [{ ...decision, superseded_by: "new" }]).explained).toBe(
    0,
  );
});
it("offers a diagram for the explanation's recorded version, not an unrelated snapshot", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.tabs = [tab];
  w.state.activeTab = tab.id;
  w.state.explanations = [decision];
  w.state.learningItems = [
    {
      id: "diagram",
      kind: "diagram",
      title: "Recorded flow",
      snapshot_id: "target",
      source: "agent_reported",
    },
  ];
  const open = vi.spyOn(w, "openLearning").mockResolvedValue();
  const ui = render(<ExplanationPanel workspace={w} />);
  fireEvent.click(screen.getByRole("button", { name: "View diagram" }));
  expect(open).toHaveBeenCalledWith("diagram");
  w.state.learningItems[0].snapshot_id = "unrelated";
  ui.rerender(<ExplanationPanel workspace={w} />);
  expect(screen.queryByRole("button", { name: "View diagram" })).toBeNull();
  cleanup();
});
it("human acceptance is absent for another pair and alternatives are not fabricated", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.tabs = [tab];
  w.state.activeTab = tab.id;
  w.state.explanations = [{ ...decision, base_snapshot_id: "other" }];
  render(<ExplanationPanel workspace={w} />);
  expect(
    screen.queryByRole("button", { name: "Accepted", exact: true }),
  ).toBeNull();
  expect(
    screen
      .getByText(
        "Different snapshot pair. Review is available in the original comparison.",
      )
      .closest("details")?.open,
  ).toBe(false);
  expect(screen.queryByText("Details and checks")).toBeNull();
  fireEvent.click(screen.getByText("Source details"));
  expect(
    screen.getByRole("button", { name: "Open original version" }),
  ).toBeTruthy();
  expect(
    screen.getByText("The agent did not report alternatives."),
  ).toBeTruthy();
  cleanup();
});

it("describes identical recorded code without changed-line coverage", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  const saved = {
    ...tab,
    base: { Snapshot: { id: "base" } },
    target: { Snapshot: { id: "target" } },
    data: {
      ...tab.data,
      base: { ...tab.data.base, files: [{ ...file("same"), sha256: "same" }] },
      target: {
        ...tab.data.target,
        files: [{ ...file("same"), sha256: "same" }],
      },
    },
  } as CodeTab;
  w.state.tabs = [saved];
  w.state.activeTab = saved.id;
  w.state.explanations = [decision];
  render(<ExplanationPanel workspace={w} />);
  expect(screen.getByRole("heading", { name: "About this code" })).toBeTruthy();
  expect(screen.queryByText(/Exactly anchored explanations/)).toBeNull();
  const details = screen.getByText("Source details").closest("details")!;
  expect(details.open).toBe(false);
  expect(
    screen.getByText("new behavior").compareDocumentPosition(details) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  cleanup();
});

it("keeps superseded prose in source details rather than mixing it with the current explanation", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.tabs = [tab];
  w.state.activeTab = tab.id;
  w.state.explanations = [
    { ...decision, id: "old", behavior: "Earlier wording", superseded_by: "d" },
    decision,
  ];
  render(<ExplanationPanel workspace={w} />);
  expect(screen.getByText("Earlier wording").closest("details")?.open).toBe(false);
  expect(screen.getByText("new behavior").closest("details")).toBeNull();
  fireEvent.click(screen.getByText("Source details"));
  expect(screen.getByText("Earlier wording")).toBeTruthy();
  cleanup();
});
