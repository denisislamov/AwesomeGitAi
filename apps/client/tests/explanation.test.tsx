import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
it("counts changed old and new lines, excluding unbound and superseded explanations", () => {
  expect(coverage(tab, [decision])).toEqual({ total: 2, explained: 1 });
  expect(
    coverage(tab, [{ ...decision, base_snapshot_id: "other" }]).explained,
  ).toBe(0);
  expect(coverage(tab, [{ ...decision, superseded_by: "new" }]).explained).toBe(
    0,
  );
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
  cleanup();
});
