#!/usr/bin/env bash
# Prints " [CF-Pages-Skip]" when the commits about to be pushed (HEAD vs the given remote ref,
# default origin/main) only touch the news bots' own bookkeeping — state files, source feeds for
# admin/watcher.html, images not used by any article yet. Nothing a visitor sees changes, so
# Cloudflare shouldn't rebuild the whole site: those builds used to keep the build queue full all
# day, and a real article or an edit from the panel had to wait behind them.
# The next real build still carries these files. Only Cloudflare reads this marker; GitHub
# Actions keep running as before.
set -u
BASE="${1:-origin/main}"
BOOKKEEPING='^(watcher-state\.json|watcher-feed(-[a-z]+)?\.json|ringsidenews-state\.json|wrestlinginc-state\.json|live-results-state\.json|_data/duplicate-skips\.json|editorial/.*|content/images/[^/]+)$'
files=$(git diff --name-only "$BASE" HEAD 2>/dev/null) || exit 0
[ -n "$files" ] || exit 0
grep -qvE "$BOOKKEEPING" <<<"$files" && exit 0

# Never skip while an earlier visible change isn't live yet: Cloudflare drops a queued build when
# a newer push arrives, so skipping this one could leave that change waiting for the next article.
last=$(git log -1 --format=%ct "$BASE" -- . \
  ':(exclude)_data/publish-state.json' ':(exclude)worker' ':(exclude)editorial' \
  ':(exclude)watcher-state.json' ':(exclude,glob)watcher-feed*.json' ':(exclude)ringsidenews-state.json' \
  ':(exclude)wrestlinginc-state.json' ':(exclude)live-results-state.json' ':(exclude)_data/duplicate-skips.json' \
  ':(exclude,glob)content/images/*' 2>/dev/null)
live=$(curl -fsS --max-time 8 "${CF_LIVE_BUILD_URL:-https://arab-wrestling.com/build.json}" 2>/dev/null \
  | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("commitTime") or 0))' 2>/dev/null)
[ -n "${last:-}" ] && [ -n "${live:-}" ] && [ "$live" -ge "$last" ] || exit 0
printf ' [CF-Pages-Skip]'
