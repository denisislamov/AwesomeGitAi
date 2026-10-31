#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ -x "$ROOT/.superpowers/toolchain/cargo/bin/cargo" ]; then
 export CARGO_HOME="$ROOT/.superpowers/toolchain/cargo"
 export RUSTUP_HOME="$ROOT/.superpowers/toolchain/rustup"
 export PATH="$CARGO_HOME/bin:$PATH"
fi
HOST_TARGET=debug
if [ "${1:-dev}" = build ]; then
 cargo build --release -p agai-host -p agai-mcp
 HOST_TARGET=release
else
 cargo build -p agai-host -p agai-mcp
fi
mkdir -p apps/client/src-tauri/binaries
cp "target/$HOST_TARGET/agai-host" apps/client/src-tauri/binaries/agai-host
cp "target/$HOST_TARGET/agai-mcp" apps/client/src-tauri/binaries/agai-mcp
scripts/build-relations.sh
case "${1:-dev}" in
 build) pnpm --filter @agai/client exec tauri build --debug --bundles app ;;
 dev) pnpm --filter @agai/client exec tauri dev ;;
 *) echo 'Usage: scripts/desktop.sh [dev|build]' >&2; exit 2 ;;
esac
