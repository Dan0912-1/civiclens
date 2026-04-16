#!/usr/bin/env bash
# Claude Code WorktreeCreate hook: symlink .env from the main repo into the
# new worktree so `npm run dev` finds it.
#
# Why this exists: .env is gitignored, so a fresh worktree starts without it.
# The dev script's `node --env-file=.env api/server.js` then exits code 9, the
# Vite proxy hits whatever stale backend (or nothing) is on port 3001, and the
# Results page silently shows 0 bills. We hit this on 2026-04-16 — see the
# diagnosis in the never-empty fallback work.
#
# Reads stdin JSON from the hook payload, finds the worktree path, resolves
# the main repo via `git rev-parse --git-common-dir`, and creates a symlink
# only if the source exists and the target doesn't already exist.

set -euo pipefail

# Pull worktree path from the hook payload. Try common field names defensively
# — exact stdin shape isn't documented and may evolve.
PAYLOAD="$(cat 2>/dev/null || true)"
WT=""
if command -v jq >/dev/null 2>&1 && [ -n "$PAYLOAD" ]; then
  WT="$(printf '%s' "$PAYLOAD" | jq -r '
    .tool_input.path
    // .tool_input.worktreePath
    // .worktree_path
    // .worktreePath
    // .path
    // empty
  ' 2>/dev/null || true)"
fi
# Fall back to current working directory — Claude runs hooks from the new
# worktree's cwd in the common case.
[ -z "$WT" ] && WT="$PWD"
[ -d "$WT" ] || exit 0

# Resolve main repo root via git's view of the worktree. This survives
# arbitrary nesting depth and works whether worktrees live under .claude/ or
# elsewhere.
MAIN_GIT_DIR="$(git -C "$WT" rev-parse --git-common-dir 2>/dev/null || true)"
[ -n "$MAIN_GIT_DIR" ] || exit 0
# git-common-dir may be relative — resolve relative to the worktree.
case "$MAIN_GIT_DIR" in
  /*) ABS_GIT_DIR="$MAIN_GIT_DIR" ;;
  *)  ABS_GIT_DIR="$WT/$MAIN_GIT_DIR" ;;
esac
MAIN_REPO="$(cd "$ABS_GIT_DIR/.." && pwd)"

SRC="$MAIN_REPO/.env"
DEST="$WT/.env"

# Don't overwrite an existing .env (could be intentional per-worktree config).
# `-e` is true for files, dirs, AND symlinks — including broken ones.
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  exit 0
fi
[ -f "$SRC" ] || exit 0

# Same repo? Skip — main repo doesn't need to symlink to itself.
[ "$WT" = "$MAIN_REPO" ] && exit 0

ln -s "$SRC" "$DEST"
echo "{\"systemMessage\": \"Symlinked .env into new worktree: $WT/.env -> $SRC\"}"
