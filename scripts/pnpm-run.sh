#!/usr/bin/env bash
# PATH-agnostic pnpm runner for git hooks (lefthook) and other tooling.
#
# Repo declares `packageManager: pnpm@11.7.0`. n-managed node installs
# leave `pnpm` off the active PATH and corepack's shim isn't always on
# it, which made the pre-push `typecheck` job fail with `pnpm: command
# not found`. Try PATH first (zero-cost when it works), then fall back
# to corepack (resolves the version from packageManager field, reuses
# corepack's cache), then to npm's resolver. If none works, fail loud
# so the hook surfaces the missing tool rather than silently passing.
#
# Usage: pnpm-run.sh <npm-script> [args...]
set -euo pipefail

script_name="${1:?usage: pnpm-run.sh <npm-script> [args...]}"
shift || true

# Non-TTY runs (CI, git hooks, this script under lefthook) need pnpm to skip
# the interactive `confirmModulesPurge` prompt when the store is stale.
if [ ! -t 1 ] && [ -z "${CI:-}" ]; then
  export CI=true
fi

pnpm_version=""
if [ -f package.json ]; then
  pnpm_version="$(grep -oE '"packageManager":[[:space:]]*"pnpm@[0-9.]+"' package.json | head -1 | grep -oE '[0-9.]+' || true)"
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm run "$script_name" "$@"
fi

if command -v corepack >/dev/null 2>&1 && [ -n "$pnpm_version" ]; then
  exec corepack pnpm@"$pnpm_version" run "$script_name" "$@"
fi

if command -v npm >/dev/null 2>&1 && [ -n "$pnpm_version" ]; then
  exec npm exec --no -- pnpm@"$pnpm_version" run "$script_name" "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm exec --no -- pnpm run "$script_name" "$@"
fi

echo "pnpm-run.sh: cannot find pnpm, corepack, or npm; install Node.js with one of them" >&2
exit 127