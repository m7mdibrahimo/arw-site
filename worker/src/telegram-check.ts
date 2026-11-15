// A Telegram send whose answer never came back (network error, 5xx) is saved as «uncertain» and
// never retried, so the same story can't go out twice. Most of the time it DID go out: the GCW
// Massacre in Missoula results and a Nia Jax story were on the channel, and the watchdog still said
// «منزلش على تيليجرام» for hours (INCIDENTS #1330). The channel's public page (t.me/s/<name>) shows the
// latest posts with their links; a story whose link is there is marked sent — nothing is re-posted.

export const UNCERTAIN = 8640000000000000;

/** Public channel name: TELEGRAM_CHAT_ID when it is an @name, else the site's own channel. */
export function publicChannelName(chatId?: string): string {
  const id = String(chatId || "").trim();
  return /^@[A-Za-z0-9_]{4,}$/.test(id) ? id.slice(1) : "arab_wrestling";
}

function pathOf(u: string): string {
  let p = u;
  try { p = new URL(u, "https://arab-wrestling.com").pathname; } catch { /* keep as is */ }
  try { p = decodeURIComponent(p); } catch { /* keep encoded */ }
  return p.replace(/\/+$/, "").toLowerCase();
}

/** Does the channel page's HTML link to this site path? */
export function channelHasPost(html: string, url: string): boolean {
  const want = pathOf(url);
  if (!want || want === "") return false;
  for (const m of String(html || "").matchAll(/href="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (!/arab-wrestling\.com/i.test(href)) continue;
    if (pathOf(href.split("?")[0]) === want) return true;
  }
  return false;
}
