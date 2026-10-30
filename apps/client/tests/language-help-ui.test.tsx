import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConstructDialog } from "../src/features/code/ConstructDialog";
import { resolveConstruct } from "../src/features/code/language-help";
it("shows context and unknown intent, with examples only on demand", () => {
  const close = vi.fn();
  render(
    <ConstructDialog
      help={resolveConstruct("a.cs", "sealed class A {}", 0)}
      location="a.cs · New · snapshot abc"
      onClose={close}
    />,
  );
  expect(screen.getByText(/Unknown — language syntax/)).toBeTruthy();
  expect(screen.queryByText(/SpecialWallet/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Example" }));
  expect(screen.getByText(/SpecialWallet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalled();
  cleanup();
});
