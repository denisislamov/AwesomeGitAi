# T3a language-analysis probes

These fixture-only probes begin T3a. They are **not shipped adapters or product usage hints**. They do not open/build the user's solution, execute source, enable compiler plugins or load a project configuration.

## Reproduce

From the repository root (macOS):

```sh
DOTNET_CLI_HOME="$PWD/.superpowers/dotnet-home" dotnet run --project spikes/code-relations/csharp
npm --prefix spikes/code-relations ci --ignore-scripts
npm --prefix spikes/code-relations test
python3 -m venv .superpowers/relations-python
.superpowers/relations-python/bin/pip install -r spikes/code-relations/requirements.txt
.superpowers/relations-python/bin/python spikes/code-relations/python_test.py
```

Observed on 2026-10-30: .NET SDK10.0.302 / Roslyn5.6.0.0, TypeScript6.0.3, Python3.13 / Jedi0.20.1 / parso0.8.7. Each probe first failed because its adapter was absent, then passed.

| Candidate | Verified in this probe | Not yet established |
|---|---|---|
| Roslyn semantic model | int/string overloads resolve separately; virtual override and interface implementation; direct field read/write | Cross-file solution loading, generics, extension methods, compound access, project references, packaging/runtime isolation |
| TypeScript language service6.0.3 | Field declaration + read/write references from in-memory source | Cross-file imports, overload/interface navigation, completeness, packaging |
| Jedi0.20.1 | File references distinguish a shadowed local; definition vs use | Definition is not a universal read/write classifier; dynamic dispatch, cross-file imports, packaging |

The application's installed TypeScript7.0.2 does not expose the former stable `lib/typescript.js` service API. The independent probe pins6.0.3 and leaves the application compiler unchanged. Do not assume service6 exactly models new TS7-only syntax.

Python results must remain partial: Jedi explicitly permits stopping a complex reference search. An empty list cannot mean “no usages” without a verified scope/completeness guarantee. These probes do not yet meet A30 or close T3a.

## Next implementation gates

1. Snapshot-bound symbol/reference DTO with adapter version, source, index status, completeness, indexed scope and explicit unknown state. Unknown/indexing/unsupported must yield no numeric count, not zero.
2. Reproduce cross-file overload/interface/override/read/write cases in each adapter; document supported constructs individually. Do not run MSBuild or user plugins automatically to discover a project.
3. Isolated, bounded analysis of immutable captured files; stale results cannot be shown as current. Pin and package runtime dependencies for macOS.
4. At most three code lenses (usages, implementations, related changes). Accessible grouped results with snippets and return navigation preserving source revision/selection. Real host + detached-window regression and A30 native check.

Sources: [Roslyn semantic model](https://learn.microsoft.com/en-us/dotnet/api/microsoft.codeanalysis.semanticmodel?view=roslyn-dotnet-4.14.0), [TypeScript language service](https://github.com/microsoft/typescript/wiki/using-the-language-service-api), [Jedi references API](https://jedi.readthedocs.io/en/latest/docs/api.html#jedi.Script.get_references).
