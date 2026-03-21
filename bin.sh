#!/usr/bin/env bash
# Pixel Office CLI entry point
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")")" && pwd)"

# When installed via npm, the actual package is one level up from .bin
if [ -f "$SCRIPT_DIR/../bin.ts" ]; then
  PKG_DIR="$SCRIPT_DIR/.."
elif [ -f "$SCRIPT_DIR/bin.ts" ]; then
  PKG_DIR="$SCRIPT_DIR"
else
  # npm link / global install: resolve from the symlink
  REAL_PATH="$(readlink -f "$0" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$0'))" 2>/dev/null)"
  PKG_DIR="$(dirname "$REAL_PATH")/.."
fi

exec npx tsx "$PKG_DIR/bin.ts" "$@"
