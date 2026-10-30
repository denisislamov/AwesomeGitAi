#!/bin/bash
# Build trusted adapters only. Never build or execute an analyzed repository.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/relations"
OUT="$ROOT/apps/client/src-tauri/binaries/relations"
mkdir -p "$OUT"
unavailable() { printf '#!/bin/sh\nprintf '\''%%s\\n'\'' '\''{"adapter":"%s","status":"Unavailable","message":"%s","symbols":[]}'\''\n' "$1" "$2" > "$OUT/$1"; chmod +x "$OUT/$1"; }
for name in csharp typescript python; do unavailable "$name" 'Adapter runtime was not packaged. Run scripts/build-relations.sh with dependencies installed.'; done
if command -v dotnet >/dev/null; then
  arch="$(uname -m)"; [ "$arch" = arm64 ] && rid=osx-arm64 || rid=osx-x64
  if dotnet publish "$SRC/csharp/Relations.csproj" -c Release -r "$rid" --self-contained true -o "$OUT/roslyn" >&2; then
    cat > "$OUT/csharp" <<'LAUNCH'
#!/bin/sh
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$DIR/roslyn/Relations"
LAUNCH
  fi
fi
if command -v node >/dev/null && [ -d "$SRC/node_modules/typescript" ]; then
  mkdir -p "$OUT/ts/node_modules"
  cp "$(command -v node)" "$OUT/ts/node.new"
  mv -f "$OUT/ts/node.new" "$OUT/ts/node"
  python3 "$SRC/bundle-node.py" "$OUT/ts/node" "$(command -v node)"
  cp "$SRC/typescript.mjs" "$OUT/ts/adapter.mjs"
  cp -RL "$SRC/node_modules/typescript" "$OUT/ts/node_modules/"
  cat > "$OUT/typescript" <<'LAUNCH'
#!/bin/sh
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! "$DIR/ts/node" --version >/dev/null 2>&1; then
  printf '%s\n' '{"adapter":"TypeScript","status":"Unavailable","message":"Bundled Node runtime cannot run on this Mac.","symbols":[]}'
  exit 0
fi
exec "$DIR/ts/node" "$DIR/ts/adapter.mjs"
LAUNCH
fi
PYTHON="${RELATIONS_PYTHON:-$SRC/.venv/bin/python}"
if [ -x "$PYTHON" ] && "$PYTHON" -c 'import jedi,parso; assert jedi.__version__ == "0.20.1" and parso.__version__ == "0.8.7"' 2>/dev/null; then
  mkdir -p "$OUT/py/lib"
  cp "$SRC/python.py" "$OUT/py/adapter.py"
  "$PYTHON" -c 'import jedi,parso,shutil,sys; from pathlib import Path; [shutil.copytree(Path(m.__file__).parent,Path(sys.argv[1])/m.__name__,dirs_exist_ok=True) for m in (jedi,parso)]' "$OUT/py/lib"
  # Python framework is machine-provided: check exact runtime and fail explicitly.
  RUNTIME="$("$PYTHON" -c 'import sys; print(sys._base_executable)')"
  printf '#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nRUNTIME="%s"\n' "$RUNTIME" > "$OUT/python"
  cat >> "$OUT/python" <<'LAUNCH'
if [ ! -x "$RUNTIME" ]; then
  printf '%s\n' '{"adapter":"Jedi","status":"Unavailable","message":"The packaged Jedi adapter requires its Python framework runtime on this Mac.","symbols":[]}'
  exit 0
fi
exec "$RUNTIME" -I -c 'import sys,runpy; sys.path.insert(0,sys.argv[1]); runpy.run_path(sys.argv[2],run_name="__main__")' "$DIR/py/lib" "$DIR/py/adapter.py"
LAUNCH
fi
chmod +x "$OUT/csharp" "$OUT/typescript" "$OUT/python"
