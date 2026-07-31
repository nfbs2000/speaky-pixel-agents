#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mktemp -d)"
INDEX_DIR="$(mktemp -d)"
INDEX_FILE="$INDEX_DIR/index"
trap 'rm -rf "$OUT" "$INDEX_DIR"' EXIT

"$ROOT/tools/build-pages-local.sh" "$OUT"

source_sha="$(git -C "$ROOT" rev-parse HEAD)"
printf '{\n  "sourceCommit": "%s",\n  "deploymentMethod": "local-gh-pages"\n}\n' \
  "$source_sha" > "$OUT/deployment.json"

export GIT_INDEX_FILE="$INDEX_FILE"
git --git-dir="$ROOT/.git" --work-tree="$OUT" read-tree --empty
git --git-dir="$ROOT/.git" --work-tree="$OUT" add -A
tree="$(git --git-dir="$ROOT/.git" write-tree)"

remote_head="$(git -C "$ROOT" ls-remote --heads origin refs/heads/gh-pages | cut -f1)"
if [[ -n "$remote_head" ]]; then
  git -C "$ROOT" fetch origin gh-pages
  parent="$(git -C "$ROOT" rev-parse FETCH_HEAD)"
  commit="$(printf 'Deploy %s\n' "$source_sha" | git -C "$ROOT" commit-tree "$tree" -p "$parent")"
else
  commit="$(printf 'Deploy %s\n' "$source_sha" | git -C "$ROOT" commit-tree "$tree")"
fi

git -C "$ROOT" push origin "$commit:refs/heads/gh-pages"
printf 'Published %s from source %s\n' "$commit" "$source_sha"
