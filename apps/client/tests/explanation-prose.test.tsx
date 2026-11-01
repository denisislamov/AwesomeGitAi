import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ExplanationProse } from "../src/features/explanation/ExplanationProse";
import { Workspace } from "../src/workspace";
afterEach(cleanup);
const workspace = new Workspace({ read: vi.fn(), desktop: vi.fn() });
it("renders stored paragraphs and real numbered/bullet lists without collapsing them", () => {
  const { container } = render(
    <ExplanationProse
      workspace={workspace}
      text={
        "Входы и результат.\n\nПорядок:\n1. Нет опоры → Airborne.\n2. Dash активен → DashActive.\n\n• state не меняется\n• context только читается"
      }
    />,
  );
  expect(container.querySelectorAll("p")).toHaveLength(2);
  expect(container.querySelectorAll("ol li")).toHaveLength(2);
  expect(container.querySelectorAll("ul li")).toHaveLength(2);
});
it("supports headings, emphasis and code while treating HTML as plain text", () => {
  const { container } = render(
    <ExplanationProse
      workspace={workspace}
      text={
        "### Пример\n**Результат:** `false`\n\n```cs\nrejection = Airborne;\nreturn false;\n```\n\n<img src=x onerror=alert(1)>"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Пример" })).toBeTruthy();
  expect(container.querySelector("strong")?.textContent).toBe("Результат:");
  expect(container.querySelector("pre code")?.textContent).toContain(
    "return false;",
  );
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
});
