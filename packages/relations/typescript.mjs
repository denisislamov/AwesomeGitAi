import ts from "typescript";
import fs from "node:fs";
const adapter = `TypeScript ${ts.version}`;
try {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const files = new Map(input.files.map((f) => ["/" + f.path, f.text]));
  const host = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (n) =>
      files.has(n) ? ts.ScriptSnapshot.fromString(files.get(n)) : undefined,
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({
      noLib: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      checkJs: true,
    }),
    getDefaultLibFileName: () => "",
    fileExists: (n) => files.has(n),
    readFile: (n) => files.get(n),
    directoryExists: () => true,
    readDirectory: () => [],
  };
  const service = ts.createLanguageService(host),
    program = service.getProgram(),
    checker = program.getTypeChecker();
  const symbols = [],
    byDecl = new Map();
  const visit = (n, fn) => {
    fn(n);
    ts.forEachChild(n, (c) => visit(c, fn));
  };
  const position = (n) => {
    const sf = n.getSourceFile(),
      p = sf.getLineAndCharacterOfPosition(n.getStart());
    return {
      path: sf.fileName.slice(1),
      line: p.line + 1,
      column: p.character + 1,
    };
  };
  const ref = (s, n, kind) => {
    if (!s) return;
    const p = position(n);
    if (s.path === p.path && s.line === p.line && s.column === p.column) return;
    const r = {
      ...p,
      kind,
      snippet: n
        .getSourceFile()
        .text.split(/\r?\n/)
        [p.line - 1].trim()
        .slice(0, 240),
    };
    if (
      !s.references.some(
        (x) =>
          x.path === r.path &&
          x.line === r.line &&
          x.column === r.column &&
          x.kind === kind,
      )
    )
      s.references.push(r);
  };
  for (const sf of program.getSourceFiles())
    visit(sf, (n) => {
      if (
        n.name &&
        ts.isIdentifier(n.name) &&
        !ts.isImportSpecifier(n) &&
        !ts.isImportClause(n) &&
        !ts.isImportEqualsDeclaration(n) &&
        !ts.isPropertyAccessExpression(n) &&
        checker.getSymbolAtLocation(n.name)?.declarations?.includes(n)
      ) {
        const p = position(n.name),
          s = {
            id: `${p.path}:${p.line}:${p.column}`,
            name: n.name.text,
            kind: ts.SyntaxKind[n.kind],
            ...p,
            references: [],
          };
        symbols.push(s);
        byDecl.set(n, s);
      }
    });
  const resolve = (n) => {
    let s = checker.getSymbolAtLocation(n);
    if (s?.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    return s?.declarations?.map((d) => byDecl.get(d)).filter(Boolean) ?? [];
  };
  for (const sf of program.getSourceFiles())
    visit(sf, (n) => {
      if (ts.isIdentifier(n)) {
        if (byDecl.has(n.parent) && n.parent.name === n) return;
        let e = n;
        if (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
          e = n.parent;
        const p = e.parent;
        let kind = "Read";
        if (ts.isCallExpression(p) && p.expression === e) {
          const d = checker.getResolvedSignature(p)?.declaration;
          // Function values belong to the referenced variable/property; a named
          // function expression also has a separate name visible inside its body.
          if (byDecl.has(d) && !ts.isFunctionExpression(d)) {
            ref(byDecl.get(d), n, "Call");
            return;
          }
          kind = "Call";
        } else if (
          ts.isBinaryExpression(p) &&
          p.left === e &&
          p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        )
          kind =
            p.operatorToken.kind === ts.SyntaxKind.EqualsToken
              ? "Write"
              : "ReadWrite";
        else if (
          (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
          (p.operator === ts.SyntaxKind.PlusPlusToken ||
            p.operator === ts.SyntaxKind.MinusMinusToken)
        )
          kind = "ReadWrite";
        else if (ts.isTypeReferenceNode(p) || ts.isNewExpression(p))
          kind = "Type";
        else if (
          ts.isExpressionWithTypeArguments(p) &&
          ts.isHeritageClause(p.parent)
        )
          kind =
            p.parent.token === ts.SyntaxKind.ImplementsKeyword
              ? "Implementation"
              : "Inheritance";
        for (const s of resolve(n)) ref(s, n, kind);
      }
      if (
        (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)) &&
        n.heritageClauses
      ) {
        for (const h of n.heritageClauses)
          for (const t of h.types) {
            const base = checker.getTypeAtLocation(t);
            for (const member of n.members) {
              if (!member.name || !ts.isIdentifier(member.name)) continue;
              const bs = base.getProperty(member.name.text);
              for (const d of bs?.declarations ?? [])
                ref(
                  byDecl.get(d),
                  member.name,
                  h.token === ts.SyntaxKind.ImplementsKeyword
                    ? "Implementation"
                    : "Override",
                );
            }
          }
      }
    });
  service.dispose();
  console.log(
    JSON.stringify({
      adapter,
      status: "Partial",
      message:
        "Captured files only; no project configuration, libraries or external dependencies. Unresolved references are unknown.",
      symbols,
    }),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      adapter,
      status: "Unavailable",
      message: `Analysis failed: ${e.message}`,
      symbols: [],
    }),
  );
}
