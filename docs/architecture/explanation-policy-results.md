# Explanation quality and audience choice — 2026-10-31

The former MCP guide specified storage workflow, provenance and anchors but did not describe adequate teaching detail. The new single source of writing guidance is `docs/integrations/explanation-quality.md`, embedded in the host's `integration_guide` response and imported into the client's copied explanation request. MCP initialization and decision tool descriptions direct agents to it. Input schemas and stored decisions are unchanged.

Before explaining, the agent asks Junior / Middle / Senior in the user's language, unless already explicitly chosen for this task or a broader preference was established. It waits for a choice or explicit delegation, while independently authorized implementation may continue. The level is retained in the session task/summary. This is agent guidance, not a new UI preference or a server-enforced acknowledgement gate.

Guidance separates a short purpose from concrete behavior, reasons, examples and verified relationships. It requires branch ordering and example outputs where helpful, distinguishes permission checks from mutations, and prohibits fabricated historical motives or alternatives. A CanStart example calibrates the expected detail. Source metadata stays out of narrative prose. Junior/Middle/Senior changes depth without relaxing factual grounding.

Existing recorded explanations are preserved. Rewriting them is separate work, subject to the existing grant/session ownership and supersede rules. Neither successful storage nor automated delivery tests certify human clarity; no automated semantic quality judge or extra model service was added.

## Validation

New tests failed first because the policy was absent from both the direct guide response and copied request. Integration coverage also checks delivery through the real host over stdio and loopback HTTP. TypeScript and protocol consistency checks passed. The macOS bundle was rebuilt with optimized host/MCP sidecars, restarted, and the live EFT `integration_guide` response was verified to contain the audience question and wait-for-choice rule. The previously open recorded CanStart view was restored.

Initial regression overlapped analyzer repackaging and failed because its runtime was temporarily unavailable; the sequential rerun passed that check. A subsequent sandboxed child-host startup failed with IO_ERROR; rerun with local socket permissions enabled. Final results are recorded in the implementation progress log. No EFT source changes or explanation rewrites; T8 remains deferred.
