import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { App } from "../src/app";
afterEach(cleanup);
it("keeps global actions in menus, with repository controls on demand", () => {
  render(<App api={{ read: vi.fn(), desktop: vi.fn() }} />);
  expect(
    screen.queryByText("Git actions · staging, branches, sync"),
  ).toBeNull();
  expect(
    screen.queryByText("Drag a title to the edge of another panel"),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Choose repository" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "File menu" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Git menu" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View menu" }));
  expect(screen.getByRole("button", { name: "Panels…" })).toBeTruthy();
});
it("native commands replace the open Panels dialog", () => {
  render(<App api={{ read: vi.fn(), desktop: vi.fn() }} />);
  fireEvent(window, new CustomEvent("agai-command", { detail: "panels" }));
  expect(screen.getByRole("dialog", { name: "Panels" })).toBeTruthy();
  fireEvent(window, new CustomEvent("agai-command", { detail: "git-commit" }));
  expect(screen.queryByRole("dialog", { name: "Panels" })).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
