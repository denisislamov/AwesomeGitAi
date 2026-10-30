import { csharp } from "@replit/codemirror-lang-csharp";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";

export const catalogVersion = "2026-10-30.1";
export type ConstructEntry = {
  id: string;
  title: string;
  language: string;
  since: string;
  meaning: string;
  consequence: string;
  example: string;
  source: string;
};
const sealedSource =
  "https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed";
const entries: Record<string, ConstructEntry> = {
  "cs.sealed-class": {
    id: "cs.sealed-class",
    title: "sealed class",
    language: "C#",
    since: "1.0",
    meaning: "Other classes cannot inherit from this class.",
    consequence:
      "In this declaration, sealed closes the class to inheritance. It does not make its objects immutable or prevent creating instances.",
    example:
      "sealed class Wallet { }\n// class SpecialWallet : Wallet { } // Not allowed",
    source: sealedSource,
  },
  "cs.sealed-override": {
    id: "cs.sealed-override",
    title: "sealed override",
    language: "C#",
    since: "1.0",
    meaning:
      "This member overrides inherited behavior and prevents further overrides of that member.",
    consequence:
      "A derived class can still inherit from the containing class unless that class is sealed. The restriction applies to this overridden member.",
    example:
      "class Wallet { public virtual void Spend() { } }\nclass LimitedWallet : Wallet {\n    public sealed override void Spend() { }\n}",
    source: sealedSource,
  },
  "ts.interface": {
    id: "ts.interface",
    title: "interface declaration",
    language: "TypeScript",
    since: "1.0",
    meaning: "Describes the shape a value must satisfy during type checking.",
    consequence:
      "The interface itself creates no JavaScript object and performs no runtime validation. Values still need to be created, and external data may need runtime checks.",
    example:
      "interface Wallet { balance: number }\nconst wallet: Wallet = { balance: 30 };",
    source: "https://www.typescriptlang.org/docs/handbook/2/objects.html",
  },
  "py.yield": {
    id: "py.yield",
    title: "yield",
    language: "Python",
    since: "3.0",
    meaning: "Produces a value and pauses this generator until it is resumed.",
    consequence:
      "Calling this generator function returns a generator; its body progresses when the generator is consumed. Local state is retained between yields.",
    example:
      "def values():\n    yield 1\n    yield 2\n\nlist(values())  # [1, 2]",
    source:
      "https://docs.python.org/3/reference/expressions.html#yield-expressions",
  },
  "py.yield-from": {
    id: "py.yield-from",
    title: "yield from",
    language: "Python",
    since: "3.3",
    meaning: "Delegates yielding to another iterable or generator.",
    consequence:
      "Values from the delegated iterable are passed to the caller. With a subgenerator, delegation also forwards generator interactions such as send and throw.",
    example: "def values():\n    yield from [1, 2]\n\nlist(values())  # [1, 2]",
    source:
      "https://docs.python.org/3/reference/expressions.html#yield-expressions",
  },
};
export type ConstructHelp = {
  entry?: ConstructEntry;
  reason?: string;
  authorIntent: string;
  line: number;
  token: string;
};
export function resolveConstruct(
  path: string,
  source: string,
  position: number,
): ConstructHelp {
  const pos = Math.max(0, Math.min(source.length, position));
  const result: ConstructHelp = {
    authorIntent:
      "Unknown — language syntax does not record why the author chose it.",
    line: source.slice(0, pos).split("\n").length,
    token: "",
  };
  const lang = path.endsWith(".cs")
    ? csharp()
    : /\.[cm]?tsx?$/.test(path)
      ? javascript({ typescript: true, jsx: path.endsWith("tsx") })
      : path.endsWith(".py")
        ? python()
        : undefined;
  const unsupported = (reason: string) => ({ ...result, reason });
  if (!lang)
    return unsupported("Language not supported by this reference catalog.");
  // The bundled C# reader mis-tokenizes raw-string contents as declarations.
  // Fail closed for this source until a raw-string-aware parser is available.
  if (path.endsWith(".cs") && source.includes('"""'))
    return unsupported(
      "C# source containing raw string delimiters is not supported by this reference reader.",
    );
  const tree = lang.language.parser.parse(source);
  let node = tree.resolveInner(pos, 1);
  if (node.from === node.to || node.from > pos || node.to <= pos)
    node = tree.resolveInner(pos, -1);
  const word = source.slice(node.from, node.to);
  result.token = word;
  let id: string | undefined;
  if (path.endsWith(".cs") && word === "sealed" && node.name === "Keyword") {
    // The C# reader exposes lexical siblings, not semantic declarations. Only
    // recognize an unbroken modifier sequence; never search the enclosing class.
    const words = [word];
    for (let p = node.prevSibling; p?.name === "Keyword"; p = p.prevSibling)
      words.unshift(source.slice(p.from, p.to));
    for (let p = node.nextSibling; p?.name === "Keyword"; p = p.nextSibling)
      words.push(source.slice(p.from, p.to));
    if (
      words.includes("class") &&
      !words.includes("record") &&
      !words.includes("override")
    )
      id = "cs.sealed-class";
    else if (
      words.includes("override") &&
      !words.includes("class") &&
      node.parent?.name === "Delim"
    )
      id = "cs.sealed-override";
  } else if (
    word === "interface" &&
    node.parent?.name === "InterfaceDeclaration"
  )
    id = "ts.interface";
  else if (
    path.endsWith(".py") &&
    word === "yield" &&
    /Yield/.test(node.parent?.name ?? "")
  ) {
    let scope = node.parent;
    while (scope && scope.name !== "FunctionDefinition") scope = scope.parent;
    if (scope && !/^async\b/.test(source.slice(scope.from, scope.to)))
      id = node.nextSibling?.name === "from" ? "py.yield-from" : "py.yield";
  }
  return id
    ? { ...result, entry: entries[id] }
    : unsupported(
        "No reference entry for this token and context. Select a supported keyword, such as sealed, interface or yield.",
      );
}
