# Captured-source relation adapters

These adapters accept one JSON object on stdin and emit one JSON object on stdout, as specified in `docs/superpowers/plans/2026-10-30-t3a-relations.md`. Every successful analysis is **Partial**: captured files are not a full configured project. Unresolved symbols must not be presented as zero usages.

## Build and verify on macOS

```sh
npm ci --prefix packages/relations --ignore-scripts
python3 -m venv packages/relations/.venv
packages/relations/.venv/bin/pip install -r packages/relations/requirements.txt
scripts/build-relations.sh
node --test packages/relations/test.mjs
```

Build prerequisites: .NET 10 SDK, Node, Python 3 with pinned Jedi 0.20.1 / Parso 0.8.7, and Xcode command line tools. `RELATIONS_PYTHON` can select an alternative prepared interpreter. Build writes three launchers to `apps/client/src-tauri/binaries/relations/`: `csharp`, `typescript`, `python`. Missing prerequisites generate an explicit `Unavailable` launcher, not a textual fallback analyzer. Build does not install dependencies automatically.

- **C#** uses Roslyn semantic symbols across captured syntax trees. Runtime references come only from the packaged trusted .NET runtime. Overloads, inheritance, implemented interface methods, overrides, reads, assignments, increments and calls are supported. Project references, generators and conditional compilation settings are absent. Roslyn is taken from the build SDK, and publish bundles the matching .NET runtime for the build Mac architecture.
- **TypeScript/JavaScript** uses pinned TypeScript 6.0.3 language service and an in-memory filesystem containing only captured files. No tsconfig, plugins, user package metadata or disk source resolution. Relative imports, overload calls, inheritance, interface implementation and base member relationships are supported. Type libraries and external dependencies are absent. Node and its transitive Homebrew libraries are copied, relocated and ad-hoc signed. Final application distribution still requires the application's normal signing process.
- **Python** uses pinned Jedi on a private temporary copy of captured files, with only that directory on the analysis project search path. The directory is deleted after analysis. Captured code is never imported or executed. Cross-file imports, references, calls and class inheritance are supported; dynamic dispatch, overrides and interface implementations remain unknown. Python dependencies are bundled; **the Python framework interpreter selected at build time is a machine prerequisite**. The launcher returns `Unavailable` when that interpreter is absent. This is not a portable bundled Python runtime.

Paths in results are the exact captured relative strings; line and column positions are 1-based UTF-16. IDs identify declaration positions inside the immutable input, not durable symbols across revisions. Snippets are trimmed captured source lines, capped at 240 characters. The host owns input size, process timeout, output size and source-scope validation. Adapters read no repository settings and never build user projects.

Tests run the actual packaged launchers, covering cross-file semantics, shadowing, overloads, interfaces, inheritance, access kinds and Unicode columns. Build output and runtime dependencies are ignored artifacts, not checked-in source.
