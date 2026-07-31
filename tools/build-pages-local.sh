#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-}"

if [[ -z "$OUT" ]]; then
  printf 'Usage: %s OUTPUT_DIRECTORY\n' "$0" >&2
  exit 2
fi

if [[ -d "$OUT" ]] && [[ -n "$(find "$OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  printf 'Output directory must be empty: %s\n' "$OUT" >&2
  exit 2
fi

mkdir -p "$OUT/assets"
cp -R "$ROOT/site/." "$OUT/"
cp "$ROOT/icon.png" "$OUT/assets/icon.png"
cp "$ROOT/webview-ui/public/Screenshot.jpg" "$OUT/assets/screenshot.jpg"
cp "$ROOT/webview-ui/public/office.png" "$OUT/assets/office.png"
cp "$ROOT/webview-ui/public/characters.png" "$OUT/assets/characters.png"
cp "$ROOT/webview-ui/public/banner.png" "$OUT/assets/banner.png"
cp "$ROOT/webview-ui/public/fonts/FSPixelSansUnicode-Regular.ttf" "$OUT/assets/pixel-agents.ttf"
: > "$OUT/.nojekyll"

printf 'Built static guide at %s\n' "$OUT"
