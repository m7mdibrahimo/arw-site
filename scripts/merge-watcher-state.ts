// Merges a watcher state file after `git pull --rebase -X ours` resolved a
// conflict in favour of the remote copy. All three news watchers write
// watcher-state.json (processPost → queryGemini bumps its API counter), so a
// concurrent run's remote copy used to silently replace this run's copy — and
// the IDs of articles this run had just published were lost. The next run then
// found those articles "unprocessed", rewrote them under a new title/URL and
// reset their social state, re-posting them to Telegram/Facebook (2026-09-24).
//   npx tsx scripts/merge-watcher-state.ts <saved-local-copy> <state-file>
import fs from "fs";

export function mergeStates(local: any, remote: any): any {
  const ids: number[] = [...(remote.processedIds || [])];
  const seen = new Set(ids);
  for (const id of local.processedIds || []) if (!seen.has(id)) { ids.push(id); seen.add(id); }
  const merged: any = { ...remote, ...local, processedIds: ids.slice(-1000) };
  merged.lastChecked = [local.lastChecked, remote.lastChecked].filter(Boolean).sort().pop();
  if ("apiCallsToday" in local || "apiCallsToday" in remote) {
    merged.apiCallsToday = local.apiCallDate === remote.apiCallDate
      ? Math.max(Number(local.apiCallsToday) || 0, Number(remote.apiCallsToday) || 0)
      : (local.apiCallDate > remote.apiCallDate ? local.apiCallsToday : remote.apiCallsToday);
    merged.apiCallDate = [local.apiCallDate, remote.apiCallDate].filter(Boolean).sort().pop();
  }
  return merged;
}

if (require.main === module) {
  const [savedLocal, target] = process.argv.slice(2);
  if (!fs.existsSync(savedLocal) || !fs.existsSync(target)) process.exit(0);
  try {
    const merged = mergeStates(JSON.parse(fs.readFileSync(savedLocal, "utf-8")), JSON.parse(fs.readFileSync(target, "utf-8")));
    fs.writeFileSync(target, JSON.stringify(merged, null, 2), "utf-8");
  } catch (e) { console.error("state merge skipped:", e); }
}
