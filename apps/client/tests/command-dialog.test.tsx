import React from "react";
import { it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dialog } from "../src/features/commands/CommandUI";
afterEach(cleanup);
it("wraps focus over visible controls, excluding hidden fields", () => {
  render(
    <Dialog title="Fixture" onClose={vi.fn()}>
      <button>Visible action</button>
      <fieldset hidden>
        <button>Hidden action</button>
      </fieldset>
    </Dialog>,
  );
  const close = screen.getByRole("button", { name: "Close Fixture" }),
    last = screen.getByRole("button", { name: "Visible action" });
  close.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  last.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(close);
});
