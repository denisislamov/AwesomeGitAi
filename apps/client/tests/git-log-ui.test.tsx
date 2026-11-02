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
it("resizes every log column and restores saved dimensions", () => {
  setup();
  for (const label of ["Graph", "Message", "Author", "Date", "Hash"]) {
    const handle = screen.getByRole("separator", {
      name: `${label} column width`,
    });
    const before = Number(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(
      before,
    );
  }
  const width = screen
    .getByRole("separator", { name: "Author column width" })
    .getAttribute("aria-valuenow");
  cleanup();
  setup();
  expect(
    screen
      .getByRole("separator", { name: "Author column width" })
      .getAttribute("aria-valuenow"),
  ).toBe(width);
});
it("places a directory tree above independently resizable commit details", async () => {
  const path = (display: string) => ({
    display,
    raw_base64: btoa(display),
    encoding: "unix_bytes",
  });
  const desktop = vi
    .fn()
    .mockResolvedValue({
      kind: "CommitDetails",
      oid: "abc",
      base_oid: null,
      message: "Subject\n\nLong description",
      author: "Author",
      date: "2026-11-02",
      paths: [path("src/core/One.cs"), path("src/core/Two.cs")],
    });
  const w = new Workspace({ read: vi.fn(), desktop });
  w.state.repo = { repo_id: "r", worktree_id: "w" } as any;
  w.state.selectedCommit = "abc";
  render(<GitLog workspace={w} />);
  const file = await screen.findByRole("button", { name: "src/core/One.cs" });
  expect(file.textContent).toBe("One.cs");
  expect(screen.getByText("core").closest("details")).toBeTruthy();
  const split = screen.getByRole("separator", { name: "Changed files height" });
  expect(split.getAttribute("aria-orientation")).toBe("horizontal");
  fireEvent.keyDown(split, { key: "ArrowDown" });
  expect(split.getAttribute("aria-valuenow")).toBe("65");
  const files = screen.getByRole("region", { name: "Changed files" });
  const message = screen.getByRole("region", { name: "Commit message" });
  expect(
    files.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  fireEvent.click(file);
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ display: "src/core/One.cs" }),
    "Empty",
    { Commit: { oid: "abc" } },
  );
});
