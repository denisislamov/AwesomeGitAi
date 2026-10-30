import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const native = vi.hoisted(() => ({
  openPanel: vi.fn(),
  closePanel: vi.fn(),
  listPanels: vi.fn(),
  nativePanelsAvailable: () => false,
}));
vi.mock("../src/features/layout/native", () => native);
import { DockLayout } from "../src/features/layout/DockLayout";
const panels = {
  files: <div>file content</div>,
  code: <div>code content</div>,
  explanation: <div>explanation content</div>,
  git: <div>git content</div>,
};
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  native.listPanels.mockResolvedValue([]);
});
afterEach(cleanup);
describe("Dock UI", () => {
  it("resizes via keyboard and survives remount", () => {
    const a = render(<DockLayout panels={panels} />);
    const divider = screen
      .getAllByRole("separator")
      .find((x) => x.getAttribute("aria-orientation") === "horizontal")!;
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(divider.getAttribute("aria-valuenow")).toBe("73");
    a.unmount();
    render(<DockLayout panels={panels} />);
    expect(
      screen
        .getAllByRole("separator")
        .some((x) => x.getAttribute("aria-valuenow") === "73"),
    ).toBe(true);
  });
  it("closes and shows a panel", () => {
    render(<DockLayout panels={panels} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Code" }));
    expect(screen.queryByText("code content")).toBeNull();
    fireEvent.click(screen.getByText("Panels"));
    fireEvent.click(screen.getByRole("button", { name: "Code", exact: true }));
    expect(screen.getByText("code content")).toBeTruthy();
  });
  it("keeps panel docked until native creation succeeds and retains it on failure", async () => {
    let reject!: (error: Error) => void;
    native.openPanel.mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    render(<DockLayout panels={panels} native />);
    fireEvent.click(screen.getByLabelText("Place Code"));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Code" })).getByRole("button", {
        name: "Detach window",
      }),
    );
    expect(screen.getByText("code content")).toBeTruthy();
    reject(new Error("blocked"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("blocked"),
    );
    expect(screen.getByText("code content")).toBeTruthy();
  });
  it("redocks after a detached native window closes", async () => {
    native.openPanel.mockResolvedValue(undefined);
    native.listPanels.mockResolvedValue([]);
    render(<DockLayout panels={panels} native />);
    fireEvent.click(screen.getByLabelText("Place Code"));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Code" })).getByRole("button", {
        name: "Detach window",
      }),
    );
    await waitFor(() => expect(screen.queryByText("code content")).toBeNull());
    await waitFor(() => expect(screen.getByText("code content")).toBeTruthy(), {
      timeout: 1600,
    });
  });
});
