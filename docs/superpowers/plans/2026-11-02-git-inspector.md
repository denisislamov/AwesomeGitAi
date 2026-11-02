# Compact resizable Git inspector

User scope: approximate Rider's right Git pane; movable graph/log/inspector separators and author/date/hash/message widths, independently adjustable message height; publish current work to GitHub.

Reference: https://www.jetbrains.com/help/rider/Log_Tab.html — Changed Files above Commit Details.

Implemented: directory tree above scrollable commit message, percentage height split; sticky compact Graph/Message/Author/Date/Hash headers with bounded persisted pixel widths; one horizontally scrolling table aligns headers and virtualized rows. Existing branch/detail widths remain configurable; narrow Git windows expose branch height instead. Pointer and keyboard controls preserve compact one-pixel chrome and larger hit areas. No Git mutation/backend change.

Checks: unit tests for column persistence, file tree/raw path navigation, pane order and vertical split; browser pointer drags, reload persistence, narrow layouts, saved explanations and historical file navigation; native macOS build/visual acceptance. Publish feature branch after local commit; do not merge main or force push.
