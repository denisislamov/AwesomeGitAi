# T4 execution supplement: explanations and IDE workspace

User-authorized 2026-10-30: complete native Quit check, implement T4 on macOS with tests and commits, and add movable/resizable panels including separate macOS windows. The existing MVP T4 and design remain authoritative.

1. Close T3 native acceptance by opening a real repo, Cmd+Q, and verifying owned host termination. Passed.
2. Implement durable scoped agent sessions, dirty baseline attribution, snapshot capture and comparisons, decisions/revisions/evidence/events, bounded context, human review bound to exact snapshot pair. Tests first: retry/conflict, forged provenance, stale scope, mixed authorship, supersede and partial sessions.
3. Implement official SDK stdio and authenticated loopback Streamable HTTP gateways; tools-only guide, resource/prompt, self-contained schema export. Gateways forward typed allowed agent operations to the existing host; no DB access or Git writes. Real end-to-end parity/discovery/auth/schema/retry tests.
4. Replace placeholder explanation UI with snapshot/range-linked decisions, summary/detail/alternatives/evidence/history, copy request, explicit missing/stale coverage and human review. Explain agent-reported evidence honestly.
5. Add movable/resizable/detachable Files, Code, Explanation and Git panels. Main window owns workspace state; detached native windows mirror relevant state and route actions back. Persist layout, redock, keyboard fallback, reset, validate saved geometry/state. Tests cover reducer, UI, native permissions and lifecycle.
6. Integrate all changes, full existing regression plus new tests, build macOS app, verify real agent→snapshot→explanation and native docking/Quit. Record actual harnesses and limits; do not claim Rider/Cursor integration unless actually exercised.
7. Commit tested logical steps and perform one independent final review; fix important findings with regression tests. Do not push/merge without request.

Choices: keep code-centered default; user can rearrange it. Standalone native panels are real windows, not browser popups. T6 trace/diagram tools remain unadvertised until implemented. Windows/Android/iOS remain outside current acceptance.
