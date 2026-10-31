import { expect, it } from "vitest";
import {
  fontScaleShortcut,
  readFontScale,
} from "../src/features/appearance/fontScale";
it("handles Ctrl and Cmd sizing, reset, limits and ordinary typing", () => {
  const key = (value: string, modifiers = {}) =>
    new KeyboardEvent("keydown", { key: value, ...modifiers });
  expect(fontScaleShortcut(key("+", { ctrlKey: true }), 100)).toBe(110);
  expect(fontScaleShortcut(key("=", { metaKey: true }), 100)).toBe(110);
  expect(fontScaleShortcut(key("-", { ctrlKey: true }), 100)).toBe(90);
  expect(fontScaleShortcut(key("0", { metaKey: true }), 150)).toBe(100);
  expect(fontScaleShortcut(key("-", { ctrlKey: true }), 80)).toBe(80);
  expect(fontScaleShortcut(key("+", { ctrlKey: true }), 200)).toBe(200);
  expect(fontScaleShortcut(key("+"), 100)).toBeNull();
  expect(
    fontScaleShortcut(key("-", { ctrlKey: true, altKey: true }), 100),
  ).toBeNull();
});
it("loads only supported persisted sizes and tolerates inaccessible storage", () => {
  expect(readFontScale({ getItem: () => "90" })).toBe(90);
  expect(readFontScale({ getItem: () => "NaN" })).toBe(100);
  expect(
    readFontScale({
      getItem: () => {
        throw Error("blocked");
      },
    }),
  ).toBe(100);
});
