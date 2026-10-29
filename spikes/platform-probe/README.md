# Platform probe (throwaway)

Technical experiment for T0, not the production client. Demonstration files only; no repository mutation and no MCP server. Read-only CodeMirror with C#/TypeScript/Python, unified/split diff, optional explanation and large-file guard. `hello` tests native IPC and reports whether the packaged process can find Git.

Prerequisites: Node 24, pnpm 9.15.4, Rust 1.99.1, macOS Xcode. Exact JS/Rust dependencies are in the adjacent lockfiles. Install Rust through the official rustup installer; do not commit toolchains.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm tauri build --debug --bundles app
```

Android: configure JAVA_HOME, ANDROID_HOME, NDK_HOME for your installed SDK, then `pnpm tauri android init --ci` and `pnpm tauri android build --debug --target aarch64`. Physical-device testing is a separate acceptance step. Generated local.properties and signing credentials are ignored.

From repository root, `node scripts/bench-fixtures.ts` creates a new disposable benchmark repository in the system temporary directory. It verifies 10,000 tracked files, 100,000 commits and 1,000 changed files plus a file over 2 MiB. Its Git CLI timings do not measure GUI rendering or controlled cold-cache performance.

Unimplemented T0 checks: secure-store, remote HTTPS/SSE lifecycle/reconnect, graph performance, full keyboard/screen-reader and physical Android checks. The probe does not establish T0 go/no-go by itself.
