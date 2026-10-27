#!/usr/bin/env bash
#
# Build a packaged macOS ZCode.app from source.
#
# Usage:
#   ./scripts/build-macos-app.sh            # Apple Silicon (arm64, default)
#   ./scripts/build-macos-app.sh x64        # Intel
#
# Prerequisites: Node.js 24.14.0 and pnpm 10.33.2 (see mise.toml).
#
set -euo pipefail

ARCH="${1:-arm64}"
case "$ARCH" in
  arm64|x64) ;;
  *) echo "error: arch must be 'arm64' or 'x64' (got '$ARCH')" >&2; exit 2 ;;
esac

# Resolve repo root (this script lives in scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# IMPORTANT: without ZCODE_ENV=production the packaged app builds as a separate
# "ZCode Preview" (appId dev.zcode.app.preview) with its own user-data dir.
export ZCODE_ENV=production

echo "==> [1/2] pnpm bootstrap (install deps + build workspace)"
pnpm bootstrap

echo "==> [2/2] bundle desktop app (macOS / $ARCH)"
pnpm bundle:desktop --skip-build --skip-prepare --os mac --arch "$ARCH"

echo
echo "==> Done. The packaged ZCode.app path is printed above"
echo "    (look under packages/desktop/dist-*/mac-$ARCH/)."
echo
echo "    To run it locally you may need an ad-hoc signature:"
echo "      codesign --force --deep --sign - /path/to/ZCode.app"
