import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GitLog } from "../src/features/git-log/GitLog";
import { Workspace } from "../src/workspace";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function setup() {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  w.state.repo = {
    repo_id: "r",
    worktree_id: "w",
    branch: "d.islamov/EFT-848",
    head_oid: "abc",
  } as any;
  w.state.branches = [
    { name: "d.islamov/EFT-848", oid: "abc", remote: false },
    { name: "backup/old", oid: "old", remote: false },
    { name: "origin/develop", oid: "def", remote: true },
  ];
  render(<GitLog workspace={w} />);
  return w;
}
it("keeps current branch visible and groups branch prefixes", () => {
  const w = setup();
  expect(
    screen.getByRole("button", { name: "Current branch d.islamov/EFT-848" }),
  ).toBeTruthy();
  expect(screen.getByText("d.islamov")).toBeTruthy();
  const current = screen.getByRole("button", {
    name: "Branch d.islamov/EFT-848",
  });
  expect(current.getAttribute("aria-current")).toBe("true");
  fireEvent.click(current);
  expect(w.state.branchFilter).toBe("d.islamov/EFT-848");
  expect(screen.getByRole("button", { name: "All branches" })).toBeTruthy();
});
it("resizes internal panes by keyboard and persists widths", () => {
  setup();
  const split = screen.getByRole("separator", { name: "Branches width" });
  const before = Number(split.getAttribute("aria-valuenow"));
  fireEvent.keyDown(split, { key: "ArrowRight" });
  expect(Number(split.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  expect(localStorage.getItem("agai-git-panes-v1")).toBeTruthy();
  expect(
    screen.getByRole("separator", { name: "Commit details width" }),
  ).toBeTruthy();
});
