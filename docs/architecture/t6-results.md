# T6 — explained trace playback and linked diagrams

Implementation is delivered for the macOS development build. Final manual T6 GUI acceptance is still pending: the Mac relocked after the successful T5 cancellation check; two CUA attempts reported it locked. An unlock request was sent. This is not a claim of completed native keyboard/window acceptance.

## Delivered

- Real MCP `trace_record` and `diagram_record`: session/grant ownership, immutable snapshot binding, bounded schema, line/stack/transition validation, durable idempotent storage. No code or watch-expression execution.
- Existing explanation dock gains Steps and Diagram tabs. Typed supplied values, before-line semantics, old → new deltas (including backward navigation), selected stack frames, step into/over/out, explicit return point, final values and empty completed stack. Educational provenance remains visible.
- Validated React Flow/ELK diagram, labelled inferred/unknown relationships, text alternative and navigation to exact saved source. Detached panels route actions through the main window.
- Built-in UI is English; user/agent text remains unchanged. Compact Monaco/Gruvbox layout retained. Escape dismisses a popup; toolbars scroll instead of consuming the editor height.
- Git job controls wait for repository generation refresh before enabling the next operation.

## Evidence

Final `pnpm test`: 95 Rust test invocations (including the durability test's child invocation), 45 client tests, 4 editor-probe tests. Native Rust suite: 8 tests. Typecheck, generated contracts and macOS app build pass.

All 11 Playwright scenarios pass, including real MCP → two-file TryDash/TrySpend → caller frame selection without advancing → return → original code after worktree changes → diagram navigation, plus Git partial stage/commit and real panel drag. The 100k graph fixture startup samples were 2367/1838/2345/2350/1864 ms; hot history 1449/1971/1466/1430/1490 ms. Cached 1900-line file switch: 15.9 ms. These are local fixture timings, not broad hardware guarantees.

Reference scenario matches A25–A27: input (1,1), grounded=true, isDashing=false, cost20, resource30→10 success; resource10→10 failure without movement changes. Direction is approximately (0.70710677,0.70710677), ticks10, active=true on success. ResourceWallet.cs line10 is before subtraction; line11 is after it. TrySpend returns at Dash.cs line11 before the caller handles the condition.

One independent final review found missing delta values and a mismatched initial reference fixture. Both reproduced in failing tests and fixed. Its terminal-step asynchronous highlight race was also reproduced and fixed. No second review. Earlier regression failures for popup overlap, toolbar height and stale Git generation were fixed before the final green run.

Packaged host/MCP smoke passed using the rebuilt `.app`: success/failure traces, final values and diagram round trip in a disposable profile. The first attempt exceeded the macOS Unix socket path limit; using a short `/tmp` profile fixed the smoke harness.

Run `python3 scripts/learning-smoke.py` after `scripts/desktop.sh build` to verify the bundled host/MCP in a disposable profile. This complements, but cannot replace, the pending manual GUI check. Physical second monitor, actual IDE products, mobile platforms and real debugger execution remain outside this acceptance.

Native follow-up after unlock: restarted the English bundle; actual bundled MCP populated the two-file disposable repository. Verified TryDash → TrySpend opens ResourceWallet.cs, selecting the caller opens Dash.cs without advancing step3, pre-line10 resource30 / pre-line11 resource10, forward/backward deltas, and separate Return point at caller line11. Detaching Explanation preserved step6/variables in a separate native window. Final keyboard/diagram/completion/redock acceptance remains pending; user shifted focus to simplifying the UI during this check.

This check found Step out incorrectly enabled at root stack depth. Added a failing root-frame transition test, then guarded both the transition and button for depth<2. Client46 tests and typecheck pass. This follow-up fix has not yet been rebuilt/rechecked in the native bundle.
