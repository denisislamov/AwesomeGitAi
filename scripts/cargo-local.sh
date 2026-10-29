#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -x "$ROOT/.superpowers/toolchain/cargo/bin/cargo" ]; then
 export CARGO_HOME="$ROOT/.superpowers/toolchain/cargo"
 export RUSTUP_HOME="$ROOT/.superpowers/toolchain/rustup"
 export PATH="$CARGO_HOME/bin:$PATH"
fi
exec cargo "$@"
