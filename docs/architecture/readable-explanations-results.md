# Readable explanations and useful diagrams — 2026-11-01

The stored EFT prose already had paragraph breaks and ordered checks. The client collapsed them inside a paragraph and applied code-card typography. Explanation prose now preserves paragraphs and line breaks and supports short headings, ordered/bullet lists, emphasis, inline code and fenced code. React escapes content; embedded HTML is never executed. Existing symbol hover/navigation remains available in prose and inline code. This is a deliberately bounded format, not a full Markdown engine.

The reading card contains the current summary, behavior and rationale. Anchor resolution, snapshot mismatch, original-version navigation, provenance and review controls now live in the existing collapsed Source details below the prose. The redundant Details and checks disclosure is gone. Superseded prose is retained in Source details instead of appearing beside its replacement without a revision marker. No saved narrative or review was deleted or rewritten.

The shared MCP/copied-request policy now requires readable paragraphs and lists and explicitly evaluates diagram usefulness. Ordered guards, meaningful branches and cross-method pipelines normally receive a diagram; trivial code does not. This is guidance delivered to agents, not a guarantee that every model will comply or an automated semantic quality judge.

A diagram may now supplement a closed session on an existing snapshot owned by that same session and grant. The host still validates ownership, node locations and edges, preserves idempotency and leaves the closed session unchanged. The artifact records post_session=true. Other new writes remain blocked except the previously supported source-preserving decision revision.

Explanation offers View diagram for a loaded diagram associated with its recorded target snapshot, including when the current editor comparison differs. Multiple matching diagrams open the existing picker. Association is snapshot-level; there is no new decision-to-diagram schema field.

## Validation

- Red/green tests covered lost prose structure, closed-session diagram rejection and superseded text in the main reading area. Renderer tests include escaped HTML, headings, code and list items.
- Full workspace regression: 150 Rust test invocations, four editor probes; final client suite: 121 tests. TypeScript, Rust formatting and protocol consistency passed.
- Seven browser scenarios passed for layouts, real MCP explanation/review, trace/diagram and TypeScript/C# symbol navigation. After the final prose/history adjustments, both real MCP explanation and trace/diagram scenarios passed again. The explanation seed now contains formatted paragraphs and an ordered list; assertions verify it renders and source-mismatch controls stay hidden until expanded.
- An earlier browser attempt overlapped source edits/HMR and reset the workspace during semantic navigation. The stable rerun passed. This is not evidence of a semantic-adapter regression.
- Rebuilt the macOS app with release host/MCP sidecars. Native EFT acceptance verified readable saved bullets/ordered checks, collapsed source details, the diagram picker, source-line navigation and the explanation-to-diagram shortcut.

The real EFT supplement uses the existing explicit Middle preference and saved snapshot 009d00c9-688c-4665-9dd4-4e00d01179c4. Artifact 6b856b28-6861-4c18-a82c-d7300316de4e depicts six CanStart checks, six rejection exits and the successful result, with source locations and educational-model assumptions. It was recorded through MCP in closed session 594e3ec9-b5c1-4676-90a5-3cb9ce1bfedd. A first request with non-UUID request identifiers failed schema validation; the corrected UUID request succeeded. No EFT code, Git refs, credentials or previous explanation text were changed.

Local evidence: .superpowers/prose-regression.log, prose-ui-final.log, prose-final-browser.log, prose-e2e-final.log, prose-types-final.log, prose-build-final.log and readable-explanation.png. T8 remains deferred; no push.
