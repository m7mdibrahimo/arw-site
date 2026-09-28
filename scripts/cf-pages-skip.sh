#!/usr/bin/env bash
# Prints " [CF-Pages-Skip]" when the commits about to be pushed (HEAD vs the given remote ref,
# default origin/main) only touch the news bots' own bookkeeping — state files, source feeds for
# admin/watcher.html, images not used by any article yet. Nothing a visitor sees changes, so
# Cloudflare shouldn't rebuild the whole site (~4 min): those builds used to keep the build queue
# full all day, and a real article or an edit from the panel had to wait behind them.
# The next real build still carries these files. Only Cloudflare reads this marker; GitHub
# Actions keep running as before.
set -u
BOOKKEEPING='^(watcher-state\.json|watcher-feed(-[a-z]+)?\.json|ringsidenews-state\.json|wrestlinginc-state\.json|live-results-state\.json|_data/duplicate-skips\.json|editorial/.*|content/images/[^/]+)$'
files=$(git diff --name-only "${1:-origin/main}" HEAD 2>/dev/null) || exit 0
[ -n "$files" ] || exit 0
if ! grep -qvE "$BOOKKEEPING" <<<"$files"; then printf ' [CF-Pages-Skip]'; fi
