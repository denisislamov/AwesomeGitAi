import { describe, it, expect } from "vitest";
import { resolveConstruct } from "../src/features/code/language-help";
const at = (path: string, source: string, word: string) =>
  resolveConstruct(path, source, source.indexOf(word));
describe("curated language help", () => {
  it("distinguishes sealed class from sealed override", () => {
    expect(at("a.cs", "public sealed class A {}", "sealed").entry?.id).toBe(
      "cs.sealed-class",
    );
    expect(
      at("a.cs", "class A { public sealed override void Run() {} }", "sealed")
        .entry?.id,
    ).toBe("cs.sealed-override");
  });
  it("rejects strings, comments, identifiers and unknown syntax", () => {
    for (const text of [
      "// sealed class A {}",
      'class A { string s = "sealed class X"; }',
      "class A { int @sealed; }",
      "sealed record A;",
    ])
      expect(at("a.cs", text, "sealed").entry).toBeUndefined();
    expect(at("a.txt", "sealed class A {}", "sealed").entry).toBeUndefined();
  });
  it("supports TS interface and Python delegation without guessing author intent", () => {
    expect(at("a.ts", "interface A { x: number }", "interface").entry?.id).toBe(
      "ts.interface",
    );
    expect(
      at("a.py", "def values():\n    yield from other()", "yield").entry?.id,
    ).toBe("py.yield-from");
    expect(at("a.py", "def values():\n    yield 1", "yield").entry?.id).toBe(
      "py.yield",
    );
    expect(at("a.cs", "sealed class A {}", "sealed").authorIntent).toBe(
      "Unknown — language syntax does not record why the author chose it.",
    );
  });
});
it("handles reordered modifiers and rejects async-generator semantics it does not describe", () => {
  expect(
    at("a.cs", "class A { public override sealed int Cost { get; } }", "sealed")
      .entry?.id,
  ).toBe("cs.sealed-override");
  expect(
    at("a.py", "async def values():\n    yield 1", "yield").entry,
  ).toBeUndefined();
});
it("does not interpret C# raw strings as declarations", () => {
  for (const prefix of ["", "$$"]) {
    const source =
      "class A { string s = " + prefix + '"""\nsealed class X\n"""; }';
    expect(at("a.cs", source, "sealed").entry).toBeUndefined();
  }
});
