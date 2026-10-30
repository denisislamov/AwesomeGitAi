import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const run = (adapter, files) => {
  const r = spawnSync(`apps/client/src-tauri/binaries/relations/${adapter}`, {
    input: JSON.stringify({ files }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return JSON.parse(r.stdout);
};
for (const lang of ["typescript", "csharp"])
  test(`${lang} resolves cross-file calls, shadowed locals and access kinds`, () => {
    const files =
      lang === "typescript"
        ? [
            {
              path: "a.ts",
              text: "export class A { value = 0; run(n: number): void {} }",
            },
            {
              path: "b.ts",
              text: 'import { A } from "./a";\nconst a = new A();\na.value = 1;\na.value += 2;\nconst x = a.value;\na.run(1);\nfunction f() { let value = 0; value++; }',
            },
          ]
        : [
            {
              path: "a.cs",
              text: "public class A { public int value; public void Run(int n) {} public void Run(string n) {} }",
            },
            {
              path: "b.cs",
              text: 'class B { void F(A a) { a.value = 1; a.value += 2; int x = a.value; a.Run(1); a.Run("x"); int value = 0; value++; } }',
            },
          ];
    const r = run(lang, files);
    assert.equal(r.status, "Partial");
    const field = r.symbols.find(
      (s) => s.name === "value" && s.path === files[0].path,
    );
    assert.ok(field);
    assert.deepEqual(field.references.map((r) => r.kind).sort(), [
      "Read",
      "ReadWrite",
      "Write",
    ]);
    const calls = r.symbols.filter(
      (s) => s.name === (lang === "typescript" ? "run" : "Run"),
    );
    assert.equal(calls.length, lang === "typescript" ? 1 : 2);
    for (const c of calls)
      assert.equal(c.references.filter((r) => r.kind === "Call").length, 1);
  });
for (const lang of ["typescript", "csharp"])
  test(`${lang} tracks inheritance and interface implementation`, () => {
    const text =
      lang === "typescript"
        ? "interface I { run(): void }\nclass Base { run(): void {} }\nclass Child extends Base implements I { override run(): void {} }"
        : "interface I { void Run(); }\nclass Base { public virtual void Run() {} }\nclass Child : Base, I { public override void Run() {} }";
    const r = run(lang, [
      { path: lang === "typescript" ? "a.ts" : "a.cs", text },
    ]);
    assert.ok(
      r.symbols
        .find((s) => s.name === "Base")
        .references.some((r) => r.kind === "Inheritance"),
    );
    assert.ok(
      r.symbols
        .find((s) => s.name === "I")
        .references.some((r) => r.kind === "Implementation"),
    );
    assert.ok(
      r.symbols
        .find(
          (s) =>
            s.name === (lang === "typescript" ? "run" : "Run") && s.line === 2,
        )
        .references.some((r) => r.kind === "Override"),
    );
  });
test("python Jedi separates shadowed references and access kinds", () => {
  const r = run("python", [
    {
      path: "a.py",
      text: "value = 0\nvalue += 1\nx = value\ndef f():\n    value = 3\n    return value\n",
    },
  ]);
  assert.equal(r.status, "Partial");
  const s = r.symbols.find((s) => s.name === "value" && s.line === 1);
  assert.ok(s);
  assert.deepEqual(s.references.map((r) => r.kind).sort(), [
    "Read",
    "ReadWrite",
  ]);
});
test("python resolves captured imports and inheritance across files", () => {
  const r = run("python", [
    {
      path: "base.py",
      text: "class Base:\n    def run(self):\n        return 1\n",
    },
    {
      path: "client.py",
      text: "from base import Base\nclass Child(Base):\n    pass\nx = Base()\nx.run()\n",
    },
  ]);
  assert.equal(r.status, "Partial");
  const s = r.symbols.find((s) => s.name === "Base" && s.path === "base.py");
  assert.ok(
    s.references.some(
      (x) => x.path === "client.py" && x.kind === "Inheritance",
    ),
  );
  assert.ok(
    r.symbols
      .find((s) => s.name === "run")
      .references.some((x) => x.path === "client.py" && x.kind === "Call"),
  );
});
test("typescript overload calls remain distinct", () => {
  const r = run("typescript", [
    {
      path: "a.ts",
      text: 'function run(n: number): void;\nfunction run(n: string): void;\nfunction run(n: number | string) {}\nrun(1);\nrun("x");',
    },
  ]);
  const a = r.symbols.find((s) => s.name === "run" && s.line === 1),
    b = r.symbols.find((s) => s.name === "run" && s.line === 2);
  assert.deepEqual(
    a.references.filter((r) => r.kind === "Call").map((r) => r.line),
    [4],
  );
  assert.deepEqual(
    b.references.filter((r) => r.kind === "Call").map((r) => r.line),
    [5],
  );
});
for (const lang of ["typescript", "csharp", "python"])
  test(`${lang} returns UTF-16 columns and preserves Unicode paths`, () => {
    const text =
      lang === "typescript"
        ? 'const emoji = "😀"; const target = 1; target;'
        : lang === "csharp"
          ? 'class A { void F() { string emoji = "😀"; int target = 1; target++; } }'
          : 'emoji = "😀"; target = 1; target += 1';
    const path =
      "папка/a." + { typescript: "ts", csharp: "cs", python: "py" }[lang];
    const r = run(lang, [{ path, text }]);
    const s = r.symbols.find((s) => s.name === "target");
    assert.ok(s, r.message);
    assert.equal(s.path, path);
    assert.equal(s.column, text.indexOf("target") + 1);
    assert.equal(s.references[0].column, text.lastIndexOf("target") + 1);
  });
test("python import order does not replace the true declaration with the import", () => {
  const r = run("python", [
    { path: "a_client.py", text: "from z_base import Base\nx = Base()" },
    { path: "z_base.py", text: "class Base:\n    pass" },
  ]);
  const s = r.symbols.find((s) => s.name === "Base" && s.path === "z_base.py");
  assert.ok(s);
  assert.ok(
    s.references.some((x) => x.path === "a_client.py" && x.kind === "Call"),
  );
});
for (const initializer of [
  "(x: number) => x * 2",
  "function (x: number) { return x * 2; }",
  "function calculate(x: number) { return x * 2; }",
]) {
  test(`typescript tracks cross-file function value calls: ${initializer}`, () => {
    const r = run("typescript", [
      {
        path: "math.ts",
        text: `export const twice = ${initializer};\nconst local = twice(2);`,
      },
      {
        path: "client.ts",
        text: 'import { twice } from "./math";\nconst answer = twice(4);',
      },
    ]);
    const symbol = r.symbols.find(
      (s) => s.name === "twice" && s.path === "math.ts",
    );
    assert.ok(symbol);
    assert.deepEqual(
      symbol.references
        .filter((r) => r.kind === "Call")
        .map((r) => [r.path, r.line]),
      [
        ["math.ts", 2],
        ["client.ts", 2],
      ],
    );
  });
}
test("csharp retains generic inheritance and explicit/inferred generic calls without merging overloads", () => {
  const r = run("csharp", [
    {
      path: "generic.cs",
      text: 'class Base<T> {}\nclass Child : Base<int> {\n static T Echo<T>(T x) => x;\n static string Echo(string x) => x;\n void Run() {\n  var a = Echo<int>(1);\n  var b = Echo(2);\n  var c = Echo("hello");\n }\n}',
    },
  ]);
  assert.deepEqual(
    r.symbols
      .find((s) => s.name === "Base")
      .references.filter((r) => r.kind === "Inheritance")
      .map((r) => r.line),
    [2],
  );
  assert.deepEqual(
    r.symbols
      .find((s) => s.name === "Echo" && s.line === 3)
      .references.filter((r) => r.kind === "Call")
      .map((r) => r.line),
    [6, 7],
  );
  assert.deepEqual(
    r.symbols
      .find((s) => s.name === "Echo" && s.line === 4)
      .references.filter((r) => r.kind === "Call")
      .map((r) => r.line),
    [8],
  );
});
test('C# report identifies the Roslyn analyzer version',()=>{
  assert.match(run('csharp',[{path:'a.cs',text:'class A {}'}]).adapter,/^Roslyn \d+\.\d+/);
});
