# T6a — optional language construct reference

2026-10-30. macOS scope. Native acceptance pending final bundle check.

## Behavior

Select a supported keyword or place the caret inside it, then use Code actions → Explain language construct, the reader context menu, or Cmd+Shift+K. The existing dialog shows meaning and local consequences; examples and version/source details expand only on request. No hover popup or permanent panel is added. English UI; local offline catalog `2026-10-30.1`.

Initial catalog: C# sealed class and sealed override, TypeScript interface, Python synchronous yield and yield from. Entries cite Microsoft, TypeScript Handbook and Python Language Reference. Project language version is explicitly unknown; the card supplies the supported language baseline, not inferred compiler settings. The reader resolves syntax context, not compiler validity. Unsupported language/token/context is explicit.

Help is pinned to the originating side, line and snapshot and closes on comparison/tab changes. Main and detached Code use the same local component. It does not write decisions, accept explanations, run source code or change AI checks. Author intent remains unknown; users can separately inspect existing recorded explanations.

## Limits and implementation decisions

The catalog is intentionally bounded. Async Python generators are unsupported rather than receiving synchronous-generator advice. C# sources containing raw string delimiters are conservatively unsupported: the bundled reader tokenizes some raw-string content as declarations. This also disables help for valid keywords elsewhere in such a file. No automatic project-version detection is claimed. Sources are displayed as selectable URLs; opening them directly in the external browser is a deferred minor improvement. No mobile or physical touch-device acceptance is claimed.

## Verification

Resolver and dialog tests observed RED→GREEN. Fresh independent read-only review found two important issues: focusing a diff side without moving its caret could retain the other side, and C# raw strings could produce false keyword matches. Both reproduced in tests and were fixed; focus tracks the active editor, dialog closure restores its source side, and raw-string sources fail closed.

Final regression: 103 Rust test invocations, four editor probes, eight native tests; contracts/typecheck pass. Final client suite: 78 tests. Browser: 13 functional scenarios pass, including real MCP explanations/trace, semantic relations, both diff sides and focus-only navigation; the 100k-history benchmark was skipped in this run (already passed at T3a). macOS bundle builds, 382.10 MiB. Final native manual help acceptance awaits unlock; the Mac relocked after the completed T3a check. Local evidence under `.superpowers/t6a-*`; no push or merge.
