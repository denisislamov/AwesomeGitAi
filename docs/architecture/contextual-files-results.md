# Contextual files and supporting-panel hierarchy — 2026-10-31

## Behavior

Files follows the comparison opened in Code, independently of the commit merely selected in Git. A compact selector provides Comparison files, Working changes and All files. Commit lists use the actual base/target endpoints and include historical deletions. Recorded snapshot lists use stored file states/hashes; if a review has no differences they show its captured files with an explicit label. Opening a file retains the historical pair. Working changes remains an explicit live mode; selecting it alone does not replace open code.

Git details separate title, metadata, optional full message, and changed files. File basenames are primary; the last two parent folders are secondary and ellipsized. Full paths remain in tooltips and accessible names. Context has a subtly tinted reading surface and system-font prose, with Monaco retained for code and values, including detached panels. Popovers remain opaque.

## Review and verification

Fresh review identified explicit All files resetting on live navigation, a transparent popover override, and late detached historical lookups stealing newer navigation. Navigation findings are covered by failing tests before fixes. Browser regression also exposed an enabled scope selector before repository loading had finished; it is disabled until a valid scope exists.

Automated validation: Rust144, native shell8, UI103, TypeScript and contract consistency passed. Browser final full run passed 16 functional scenarios, with the new historical-file transition exceeding its 5-second expectation once; the scenario passed twice in focused runs (7.2s/6.6s total), using a 15-second bound on the asynchronous file load. All 17 functional scenarios passed across those runs; optional 100k benchmark skipped. No blanket single-run green claim. Full-path tooltips/accessibility names and wide/narrow layouts remain covered. Popover opacity is checked in the existing browser regression.

Native macOS bundle built successfully. Manual native acceptance is pending: CUA reported the Mac locked and automatic unlock unavailable; user asked to unlock. Browser screenshots were visually inspected. No EFT writes or push; T8 remains deferred.
