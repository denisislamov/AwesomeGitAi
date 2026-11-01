import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { FileNavigator } from "../src/features/files/FileNavigator";
import { Workspace } from "../src/workspace";
afterEach(cleanup);
const p = (display: string) => ({
  display,
  raw_base64: btoa(display),
  encoding: "unix_bytes",
});
function fixture() {
  const desktop = vi.fn(async () => ({
    kind: "CommitDetails",
    paths: [p("src/Changed.cs"), p("src/Deleted.cs")],
  }));
  const w = new Workspace({ desktop: desktop as any, read: vi.fn() });
  w.state.repo = {
    repo_id: "repo",
    worktree_id: "wt",
    status_entries: [],
  } as any;
  w.state.paths = [p("Current.cs")];
  const tab = {
    id: "t",
    path: p("src/Changed.cs"),
    base: { Commit: { oid: "a" } },
    target: { Commit: { oid: "b" } },
    data: {
      comparison: { id: "c" },
      base: { files: [] },
      target: { files: [] },
    },
  } as any;
  w.state.tabs = [tab];
  w.state.activeTab = "t";
  return { w, tab, desktop };
}
it("shows committed/deleted files on a clean worktree and opens the same pair", async () => {
  const { w, tab, desktop } = fixture();
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  render(<FileNavigator workspace={w} stagingMode="work" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "File src/Deleted.cs" }),
  );
  expect(open).toHaveBeenCalledWith(p("src/Deleted.cs"), tab.base, tab.target);
  expect(desktop).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "CommitDetails", oid: "b", base: "a" }),
  );
  fireEvent.change(screen.getByLabelText("File list scope"), {
    target: { value: "working" },
  });
  expect(screen.getByText("No uncommitted changes.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "File src/Changed.cs" }),
  ).toBeNull();
});
it("shows recorded snapshot files even when there are no differences", async () => {
  const { w, tab, desktop } = fixture();
  tab.base = { Snapshot: { id: "saved" } };
  tab.target = tab.base;
  tab.data.base = {
    id: "saved",
    files: [{ path: p("Gone.cs"), sha256: "x", state: "Present" }],
  };
  tab.data.target = tab.data.base;
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  render(<FileNavigator workspace={w} stagingMode="work" />);
  fireEvent.click(await screen.findByRole("button", { name: "File Gone.cs" }));
  expect(open).toHaveBeenCalledWith(p("Gone.cs"), tab.base, tab.target);
  expect(desktop).not.toHaveBeenCalled();
});
it("ignores late file lists from an older comparison", async () => {
  const { w, tab, desktop } = fixture();
  let finish: any;
  desktop.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const ui = render(<FileNavigator workspace={w} stagingMode="work" />);
  const next = { ...tab, id: "next", target: { Commit: { oid: "new" } } };
  w.state.tabs = [next];
  w.state.activeTab = "next";
  desktop.mockResolvedValue({
    kind: "CommitDetails",
    paths: [p("New.cs")],
  } as any);
  ui.rerender(<FileNavigator workspace={w} stagingMode="work" />);
  await screen.findByRole("button", { name: "File New.cs" });
  finish({ kind: "CommitDetails", paths: [p("Stale.cs")] });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "File Stale.cs" })).toBeNull(),
  );
});

it("keeps explicit All files when opening current code from a historical tab", async () => {
  const { w, tab } = fixture();
  const open = vi.spyOn(w, "openFile").mockImplementation(async (path) => {
    w.state.tabs = [
      { ...tab, id: "live", path, base: "Index", target: "Worktree" },
    ];
    w.state.activeTab = "live";
  });
  const ui = render(<FileNavigator workspace={w} stagingMode="work" />);
  fireEvent.change(screen.getByLabelText("File list scope"), {
    target: { value: "all" },
  });
  fireEvent.click(screen.getByRole("button", { name: "File Current.cs" }));
  ui.rerender(<FileNavigator workspace={w} stagingMode="work" />);
  expect(
    (screen.getByLabelText("File list scope") as HTMLSelectElement).value,
  ).toBe("all");
  expect(screen.getByRole("button", { name: "File Current.cs" })).toBeTruthy();
  expect(open).toHaveBeenCalled();
});

it("does not accept a scope choice before a repository has opened", () => {
  const w = new Workspace({ read: vi.fn(), desktop: vi.fn() });
  render(<FileNavigator workspace={w} stagingMode="work" />);
  expect(
    (screen.getByLabelText("File list scope") as HTMLSelectElement).disabled,
  ).toBe(true);
});

it("keeps All files visible throughout an asynchronous historical-to-live open", async () => {
  const { w, tab } = fixture();
  let finish!: () => void;
  vi.spyOn(w, "openFile").mockImplementation(async (path) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    w.state.tabs = [
      { ...tab, id: "live", path, base: "Index", target: "Worktree" },
    ];
    w.state.activeTab = "live";
  });
  const ui = render(<FileNavigator workspace={w} stagingMode="work" />);
  fireEvent.change(screen.getByLabelText("File list scope"), {
    target: { value: "all" },
  });
  fireEvent.click(screen.getByRole("button", { name: "File Current.cs" }));
  expect(
    (screen.getByLabelText("File list scope") as HTMLSelectElement).value,
  ).toBe("all");
  expect(screen.getByRole("button", { name: "File Current.cs" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "Opening Current.cs",
  );
  finish();
  await waitFor(() => expect(w.state.activeTab).toBe("live"));
  ui.rerender(<FileNavigator workspace={w} stagingMode="work" />);
  expect(
    (screen.getByLabelText("File list scope") as HTMLSelectElement).value,
  ).toBe("all");
});
it("names identical recorded versions explicitly instead of promising a diff", () => {
  const { w, tab } = fixture();
  tab.base = { Snapshot: { id: "before" } };
  tab.target = { Snapshot: { id: "after" } };
  tab.data.base.files = [
    { path: p("Context.cs"), state: "Present", sha256: "same" },
  ];
  tab.data.target.files = tab.data.base.files;
  render(<FileNavigator workspace={w} stagingMode="work" />);
  expect(screen.getByRole("option", { name: "Recorded files" })).toBeTruthy();
  expect(
    screen.getByText("Saved explanation · identical versions, no + / −"),
  ).toBeTruthy();
});

it("offers selected commit files before any code tab opens, including root commits", async () => {
  const { w, desktop } = fixture();
  w.state.tabs = [];
  w.state.activeTab = null;
  desktop.mockResolvedValue({
    kind: "CommitDetails",
    oid: "root",
    base_oid: null,
    paths: [p("Root.cs")],
  } as any);
  w.selectCommit("root");
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  render(<FileNavigator workspace={w} stagingMode="work" />);
  const option = screen.getByRole("option", {
    name: "Commit changes",
  }) as HTMLOptionElement;
  expect(option.disabled).toBe(false);
  await screen.findByRole("button", { name: "File Root.cs" });
  fireEvent.change(screen.getByLabelText("File list scope"), {
    target: { value: "working" },
  });
  fireEvent.change(screen.getByLabelText("File list scope"), {
    target: { value: "comparison" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "File Root.cs" }));
  expect(open).toHaveBeenCalledWith(p("Root.cs"), "Empty", {
    Commit: { oid: "root" },
  });
});

it("selecting another commit changes the list while retaining open code; activating code restores its pair", async () => {
  const { w, tab, desktop } = fixture();
  desktop.mockImplementation(
    async (request: any) =>
      ({
        kind: "CommitDetails",
        oid: request.oid,
        base_oid: request.base ?? "parent",
        paths: [p(request.oid + ".cs")],
      }) as any,
  );
  const ui = render(<FileNavigator workspace={w} stagingMode="work" />);
  await screen.findByRole("button", { name: "File b.cs" });
  w.selectCommit("next", "custom");
  ui.rerender(<FileNavigator workspace={w} stagingMode="work" />);
  await screen.findByRole("button", { name: "File next.cs" });
  expect(w.active()).toBe(tab);
  expect(desktop).toHaveBeenCalledWith(
    expect.objectContaining({ oid: "next", base: "custom" }),
  );
  const open = vi.spyOn(w, "openFile").mockResolvedValue();
  fireEvent.click(screen.getByRole("button", { name: "File next.cs" }));
  expect(open).toHaveBeenCalledWith(
    p("next.cs"),
    { Commit: { oid: "custom" } },
    { Commit: { oid: "next" } },
  );
  w.activate(tab.id);
  ui.rerender(<FileNavigator workspace={w} stagingMode="work" />);
  await screen.findByRole("button", { name: "File b.cs" });
});
