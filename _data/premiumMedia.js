// Which shows have premium servers or downloads, and how many: {"shows/<file>": [servers, downloads]} — counts only,
// never a link (the links stay in the worker, worker/src/premium.ts). Each show page is built with its premium line
// (or a premium member's rows) already in it, so it shows with the page instead of popping in after the page asked
// the worker (owner 2026-10-16: «عايز … تكون ظاهرة علطول لانها بتاخد وقت علي ما بتظهر»). Unreachable → {} and the
// page does what it always did: assets/post-player.js asks the worker and adds them.
module.exports = async function() {
  if (process.env.ARW_OFFLINE) return {};
  try {
    const r = await fetch("https://arw-site-bot.m7mdibrahimpc.workers.dev/premium/summary", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const d = await r.json();
    return d && d.ok && d.media && typeof d.media === "object" ? d.media : {};
  } catch {
    return {};
  }
};
