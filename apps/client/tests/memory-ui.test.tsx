import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryDialog } from "../src/features/memory/MemoryDialog";
import { Workspace } from "../src/workspace";
afterEach(cleanup);
function setup() {
  const desktop = vi.fn(async (r: any): Promise<any> => ({
    kind: "MemoryResult",
    data:
      r.kind === "MemorySearch"
        ? {
            items: [
              {
                id: "d",
                kind: "decision",
                external: true,
                data: {
                  summary: "Keep it local",
                  rationale: "Offline",
                  actor: "Alice",
                  status: "accepted",
                  task_id: "task",
                },
              },
            ],
            next_offset: null,
            history_path: "/project.history",
          }
        : r.kind === "MemoryCatalog"
          ? {
              records: [
                {
                  id: "d",
                  kind: "decision",
                  data: { summary: "Keep it local" },
                  external: false,
                },
              ],
              snapshots: [{ id: "s", label: "Saved code", file_count: 1 }],
            }
          : r.kind === "BundlePreview"
            ? {
                hash: "hash",
                preview: {
                  record_count: 1,
                  snapshot_count: 0,
                  file_count: 0,
                  exclusions: ["credentials"],
                  records: [],
                  snapshots: [],
                },
              }
            : r.kind === "BundleInspect"
              ? {
                  hash: "import-hash",
                  preview: { source_repo_id: "source" },
                  record_count: 1,
                  snapshot_count: 0,
                }
              : { output_path: "/tmp/context.zip" },
  }));
  const workspace = new Workspace({ read: vi.fn(), desktop });
  workspace.state.repo = { repo_id: "repo", worktree_id: "work" } as any;
  workspace.state.root = "/project";
  render(<MemoryDialog workspace={workspace} onClose={() => {}} />);
  return { desktop, workspace };
}
it("shows external provenance separately and requires preview with explicit snapshot selection", async () => {
  const { desktop } = setup();
  await screen.findAllByText("Keep it local");
  expect(screen.getByText(/External source material/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  const snapshot = await screen.findByLabelText("Snapshot Saved code");
  expect((snapshot as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText("Record Keep it local"));
  fireEvent.change(screen.getByLabelText("Output ZIP path"), {
    target: { value: "/tmp/context.zip" },
  });
  expect(
    (screen.getByRole("button", { name: "Export ZIP" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
  await screen.findByText(/credentials/);
  fireEvent.click(screen.getByRole("button", { name: "Export ZIP" }));
  await waitFor(() =>
    expect(desktop).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BundleExport",
        expected_hash: "hash",
        record_ids: ["d"],
        snapshot_ids: [],
      }),
    ),
  );
});
it("requires inspected import and mapping confirmation, invalidates inspection on path edit", async () => {
  const { desktop } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  fireEvent.change(screen.getByLabelText("Input ZIP path"), {
    target: { value: "/tmp/in.zip" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Inspect ZIP" }));
  const mapping = await screen.findByLabelText(/Map this bundle/);
  fireEvent.click(mapping);
  fireEvent.click(screen.getByRole("button", { name: "Import ZIP" }));
  await waitFor(() =>
    expect(desktop).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BundleImport",
        expected_hash: "import-hash",
        confirm_mapping: true,
      }),
    ),
  );
  fireEvent.change(screen.getByLabelText("Input ZIP path"), {
    target: { value: "/tmp/other.zip" },
  });
  expect(screen.queryByLabelText(/Map this bundle/)).toBeNull();
});
it("requires exact typed whole-scope erasure confirmation", async () => {
  const { desktop } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  expect(
    (
      screen.getByRole("button", {
        name: "Erase stored context",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Erase confirmation"), {
    target: { value: "ERASE STORED CONTEXT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Erase stored context" }));
  await waitFor(() =>
    expect(desktop).toHaveBeenCalledWith({
      kind: "MemoryErase",
      scope: { repo_id: "repo", worktree_id: "work" },
      confirmation: "ERASE STORED CONTEXT",
    }),
  );
});
it("ignores a pending response after repository scope changes and renders imported HTML as text", async () => {
  let finish: (r: any) => void = () => {};
  const desktop = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      kind: "MemoryResult",
      data: {
        items: [
          {
            id: "imported",
            kind: "imported_decision",
            external: true,
            data: {
              source: {
                summary: "<img src=x onerror=alert(1)>",
                rationale: "Imported rationale",
              },
              provenance: { source_id: "original" },
            },
          },
        ],
        next_offset: null,
      },
    });
  const workspace = new Workspace({ read: vi.fn(), desktop });
  workspace.state.repo = { repo_id: "a", worktree_id: "a" } as any;
  const view = render(
    <MemoryDialog workspace={workspace} onClose={() => {}} />,
  );
  workspace.state = {
    ...workspace.state,
    repo: { repo_id: "b", worktree_id: "b" } as any,
  };
  view.rerender(<MemoryDialog workspace={workspace} onClose={() => {}} />);
  await screen.findAllByText("<img src=x onerror=alert(1)>");
  expect(view.container.querySelector("img")).toBeNull();
  finish({
    kind: "MemoryResult",
    data: {
      items: [
        {
          id: "stale",
          kind: "decision",
          external: false,
          data: { summary: "Wrong repository" },
        },
      ],
      next_offset: null,
    },
  });
  await waitFor(() =>
    expect(screen.queryByText("Wrong repository")).toBeNull(),
  );
  expect(screen.getByText("Imported rationale")).toBeTruthy();
});
it("keeps pagination bound to submitted filters and wraps focus inside the dialog", async () => {
  const { desktop } = setup();
  await screen.findAllByText("Keep it local");
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: { items: [], next_offset: 30 },
  });
  fireEvent.change(screen.getByLabelText("Actor"), {
    target: { value: "Alice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search memory" }));
  await screen.findByRole("button", { name: "Load more" });
  fireEvent.change(screen.getByLabelText("Actor"), {
    target: { value: "Bob" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() =>
    expect(desktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "MemorySearch",
        actor: "Alice",
        offset: 30,
      }),
    ),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Rebuild search index",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  const last = screen.getByRole("button", { name: "Rebuild search index" });
  last.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close Project memory" }),
  );
});
it("clears erased workspace views even when the dialog closes during erasure", async () => {
  let finish: (r: any) => void = () => {};
  const desktop = vi.fn(async (r: any): Promise<any> =>
    r.kind === "MemoryErase"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { kind: "MemoryResult", data: { items: [], next_offset: null } },
  );
  const workspace = new Workspace({ read: vi.fn(), desktop });
  workspace.state.repo = { repo_id: "a", worktree_id: "a" } as any;
  const onErased = vi.fn();
  const view = render(
    <MemoryDialog
      workspace={workspace}
      onClose={() => {}}
      onErased={onErased}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  fireEvent.change(screen.getByLabelText("Erase confirmation"), {
    target: { value: "ERASE STORED CONTEXT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Erase stored context" }));
  view.unmount();
  finish({ kind: "MemoryResult", data: {} });
  await waitFor(() => expect(onErased).toHaveBeenCalledOnce());
});
it("presents readable bundle records, files and exclusions without byte arrays", async () => {
  const { desktop } = setup();
  await screen.findAllByText("Keep it local");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByLabelText("Record Keep it local");
  fireEvent.click(screen.getByLabelText("Record Keep it local"));
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: {
      hash: "h",
      preview: {
        record_count: 1,
        snapshot_count: 1,
        file_count: 1,
        records: [
          {
            id: "d",
            kind: "decision",
            external: false,
            data: {
              summary: "Readable decision",
              rationale: "Readable reason",
            },
          },
        ],
        snapshots: [
          {
            id: "s",
            files: [
              {
                path: { display: "src/code.ts" },
                bytes: [
                  ...new TextEncoder().encode("const readable = true;"),
                  ...Array(9000).fill(32),
                ],
              },
            ],
          },
        ],
        exclusions: [{ item: ".env", reason: "Sensitive file" }],
      },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
  await screen.findByText("1 records · 1 snapshots · 1 files");
  expect(screen.getAllByText(/Readable decision/).length).toBeGreaterThan(0);
  expect(screen.getByText(/src\/code.ts/)).toBeTruthy();
  expect(screen.getByText(/Sensitive file/)).toBeTruthy();
  fireEvent.click(screen.getByText(/src\/code.ts/));
  expect(await screen.findByText(/const readable = true;/)).toBeTruthy();
  expect(screen.getByText(/Truncated/)).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Export preview" }).textContent,
  ).not.toContain('"bytes"');
});
it("shows source mapping counts, concise import receipt and erasure limitations", async () => {
  const { desktop } = setup();
  await screen.findAllByText("Keep it local");
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  fireEvent.change(screen.getByLabelText("Input ZIP path"), {
    target: { value: "/tmp/a.zip" },
  });
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: {
      hash: "h",
      manifest: { source_id: "source-repo", exclusions: [] },
      record_count: 2,
      snapshot_count: 1,
      preview: { exact_files: 3, unmatched_files: 2 },
      records: [],
      snapshots: [],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Inspect ZIP" }));
  await screen.findByText(/Source: source-repo/);
  expect(screen.getByText(/3 matched files · 2 unmatched files/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Map this bundle/));
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: { document_ids: ["a", "b"], snapshot_ids: ["s"] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Import ZIP" }));
  await screen.findByText(
    "Imported 2 records and 1 snapshots as external context.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: { limitations: ["Exported copies remain.", "OS backups remain."] },
  });
  fireEvent.change(screen.getByLabelText("Erase confirmation"), {
    target: { value: "ERASE STORED CONTEXT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Erase stored context" }));
  await screen.findByText("OS backups remain.");
  expect(screen.getByText("Exported copies remain.")).toBeTruthy();
});
it("locks navigation during erasure and clears cached selection even when erase fails", async () => {
  let rejectErase: (e: unknown) => void = () => {};
  const { desktop, workspace } = setup();
  const cleared = vi.fn();
  cleanup();
  render(
    <MemoryDialog
      workspace={workspace}
      onClose={() => {}}
      onErased={cleared}
    />,
  );
  await screen.findAllByText("Keep it local");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByLabelText("Record Keep it local");
  fireEvent.click(screen.getByLabelText("Record Keep it local"));
  fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
  await screen.findByRole("region", { name: "Export preview" });
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  desktop.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectErase = reject;
      }),
  );
  fireEvent.change(screen.getByLabelText("Erase confirmation"), {
    target: { value: "ERASE STORED CONTEXT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Erase stored context" }));
  expect(
    (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  rejectErase({ code: "BACKUP_REDACTION_FAILED" });
  await screen.findByText(/BACKUP_REDACTION_FAILED/);
  expect(cleared).toHaveBeenCalledOnce();
  desktop.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(screen.queryByRole("region", { name: "Export preview" })).toBeNull();
  expect(screen.queryByLabelText("Record Keep it local")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Preview export",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("clears workspace caches after erase failure even after dialog unmount", async () => {
  let rejectErase: (e: unknown) => void = () => {};
  const desktop = vi.fn(async (r: any): Promise<any> =>
    r.kind === "MemoryErase"
      ? new Promise((_, reject) => {
          rejectErase = reject;
        })
      : { kind: "MemoryResult", data: { items: [], next_offset: null } },
  );
  const workspace = new Workspace({ read: vi.fn(), desktop });
  workspace.state.repo = { repo_id: "r", worktree_id: "w" } as any;
  const cleared = vi.fn();
  const view = render(
    <MemoryDialog
      workspace={workspace}
      onClose={() => {}}
      onErased={cleared}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  fireEvent.change(screen.getByLabelText("Erase confirmation"), {
    target: { value: "ERASE STORED CONTEXT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Erase stored context" }));
  view.unmount();
  rejectErase(new Error("cleanup failed"));
  await waitFor(() => expect(cleared).toHaveBeenCalledOnce());
});
it("labels limited catalogs and explains oversized preview errors", async () => {
  const { desktop } = setup();
  await screen.findAllByText("Keep it local");
  desktop.mockResolvedValueOnce({
    kind: "MemoryResult",
    data: {
      records: [
        {
          id: "d",
          kind: "decision",
          data: { summary: "One item" },
          external: false,
        },
      ],
      snapshots: [],
      truncated: true,
      total_records: 1500,
      total_snapshots: 0,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByText(/Showing a limited catalog from 1500 records/);
  fireEvent.click(screen.getByLabelText("Record One item"));
  desktop.mockRejectedValueOnce({ code: "MEMORY_RESPONSE_TOO_LARGE" });
  fireEvent.click(screen.getByRole("button", { name: "Preview export" }));
  await screen.findByText(
    "Selection is too large to preview. Choose fewer records or snapshots.",
  );
});

it("reveals sibling history location on demand and explains history erasure", async () => {
  setup();
  const summary = await screen.findByText("Local Git history");
  expect(summary.closest("details")?.open).toBe(false);
  fireEvent.click(summary);
  expect(screen.getByText("/project.history")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Erase" }));
  expect(
    screen.getByText(
      /All commits in the sibling history repository will be permanently removed/,
    ),
  ).toBeTruthy();
});
