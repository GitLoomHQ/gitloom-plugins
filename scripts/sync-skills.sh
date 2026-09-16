#!/usr/bin/env bash
# The two harnesses read the same skills/<name>/SKILL.md and hooks/hooks.json
# layouts but cannot share a directory: every path in a plugin manifest must
# stay under its own root. So skills/ and hooks/ are the source and each plugin
# gets a copy. --check is the CI gate.
set -euo pipefail

cd "$(dirname "$0")/.."
targets=(plugins/claude-code plugins/codex)
shared=(skills hooks)

if [ "${1:-}" = "--check" ]; then
  status=0
  for t in "${targets[@]}"; do
    for d in "${shared[@]}"; do
      if ! diff -ru "$d" "$t/$d"; then
        echo "::error::$t/$d differs from $d/ — run scripts/sync-skills.sh" >&2
        status=1
      fi
    done
  done
  exit $status
fi

for t in "${targets[@]}"; do
  for d in "${shared[@]}"; do
    rm -rf "${t:?}/$d"
    cp -r "$d" "$t/$d"
  done
  echo "synced skills + hooks -> $t"
done
