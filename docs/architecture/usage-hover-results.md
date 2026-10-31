# Usage previews and explanation links — 2026-10-31

The code toolbar shows a compact count of external references to symbols declared in the current file. This is not a count of textual filename mentions. Declaration lenses and verified symbol occurrences show a hover preview with caller file, line, reference kind and snippet. Clicking a location uses the existing snapshot-pinned navigation and Back path. Previews use the cached semantic report and make no service request on hover.

Explanation summaries, behavior and rationale link uniquely named symbols from the active report. Ambiguous names remain plain text. Source marks require matching snapshot, reported coordinates and exact symbol text. Old diff sides are not given target-side links. Hover draws at most eight faint curves between currently visible occurrences in the same native window; separate macOS windows do not have cross-window curves. Partial reports remain visibly partial, and previews show at most forty locations (with a truncation note and full symbol-relations action).

The generic explanation heading, selected path/range, snapshot/comparison IDs and coverage are now below the explanation cards in collapsed Source details. Author-provided prose and provenance are retained. Narrow code toolbars wrap rather than overlapping their buttons.

## Verification

New model/popup tests cover source-coordinate validation, duplicate references, cached navigation without service requests, ambiguous/stale reports and transient pointer crossings. UI 116 passed; TypeScript checked in the successful macOS bundle build. Backend/native source and protocol are unchanged, so their prior regression was not repeated.

Initial full browser regression passed 16 functional scenarios and failed the two new semantic hover/navigation scenarios; the optional 100k benchmark was skipped. A popup could reopen from the click event after React replaced the navigation target. The listener now reads the target during capture, and a 220ms hover delay avoids incidental pointer crossings. After that fix, all six focused scenarios passed: C#/TypeScript hover, lines, pinned navigation and Back; 1280/1024/390 layouts; font controls. All 18 functional scenarios therefore passed across full/focused runs, not one completely green full run. The new popup screenshot was visually inspected and confirmed the toolbar overlap was resolved.

Native EFT acceptance: the recorded StanceSimulationState report showed 27 external locations (partial); selecting CharacterStanceSimulationTests.cs:72 opened the pinned source location and Back restored State. Source details was collapsed beneath the explanation. No EFT source, index or refs were changed. Final rebuilt bundle launches on macOS. Logs: `.superpowers/hover-{ui-final,e2e,focused,build-final}.log`. T8 remains deferred; local commit only.
