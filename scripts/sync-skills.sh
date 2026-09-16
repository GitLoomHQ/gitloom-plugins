#!/usr/bin/env bash
# The two harnesses read the same skills/<name>/SKILL.md layout but cannot share
# a directory: every path in a plugin manifest must stay under its own root. So
# skills/ is the source and each plugin gets a copy. --check is the CI gate.
set -euo pipefail

cd "$(dirname "$0")/.."
targets=(plugins/claude-code plugins/codex)

if [ "${1:-}" = "--check" ]; then
  status=0
  for t in "${targets[@]}"; do
    if ! diff -ru skills "$t/skills"; then
      echo "::error::$t/skills differs from skills/ — run scripts/sync-skills.sh" >&2
      status=1
    fi
  done
  exit $status
fi

for t in "${targets[@]}"; do
  rm -rf "$t/skills"
  cp -r skills "$t/skills"
  echo "synced -> $t/skills"
done
