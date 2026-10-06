// «الأكثر مشاهدة» on the home page (INCIDENTS #180). The most viewed shows and stories, from the
// site's own Cloudflare analytics (the same connection the panel's statistics use), for today and
// for the week. Each page's title and picture are read from the page itself (its og: tags) rather
// than from the 2 MB search index, so the Worker stays well inside its CPU budget. The list is kept
// in KV for 30 minutes; the home page reads it from /top10 and hides the section when it is empty.

interface Top10Env { PUSH_KV?: KVNamespace; SITE_ORIGIN: string }
export interface Top10Item { url: string; title: string; image: string; kind: "show" | "recap" | "nostalgia"; views: number }

const CONFIG_KEY = "studio:analytics:config";
const CACHE_KEY = (range: string) => `top10:v5:${range}`; // v5: small card pictures (#279) // the home page asks for the week only (#183) // v2: watch pages only, decoded titles (#181)
const CACHE_MS = 30 * 60_000;

/**
 * Paths that are a single show, recap or nostalgia episode — what people watch. News stays out: long
 * headlines and mixed pictures don't suit the poster row (the owner, INCIDENTS #181). Not a list,
 * a tag or a page number.
 */
export function contentKind(path: string): Top10Item["kind"] | null {
  const m = String(path || "").match(/^\/(shows|recaps|nostalgia)\/([^/?#]+)\/?$/);
  if (!m || /^\d+$/.test(m[2])) return null;
  return m[1] === "shows" ? "show" : m[1] === "recaps" ? "recap" : "nostalgia";
}

/** og: values come with HTML entities still in them («I&#39;m»): turn them back into text. */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return named[e.toLowerCase()] ?? m;
  });
}

/** Sum views per page (the same page can come back as /x and /x/), keep content pages, best first. */
export function rankPages(rows: { path: string; views: number }[], limit = 10): { path: string; views: number; kind: Top10Item["kind"] }[] {
  const sum = new Map<string, number>();
  for (const r of rows) {
    let p = String(r.path || "").split(/[?#]/)[0];
    try { p = decodeURI(p); } catch { /* keep as is */ }
    if (!p.endsWith("/")) p += "/";
    if (!contentKind(p)) continue;
    sum.set(p, (sum.get(p) || 0) + (Number(r.views) || 0));
  }
  return [...sum].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([path, views]) => ({ path, views, kind: contentKind(path)! }));
}

async function topPaths(token: string, zone: string, hours: number): Promise<{ path: string; views: number }[]> {
  const until = new Date(), since = new Date(until.getTime() - hours * 3600_000);
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($zone: String!, $s: Time!, $u: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
        pages: httpRequestsAdaptiveGroups(limit: 400, filter: { datetime_geq: $s, datetime_lt: $u, requestSource: "eyeball", edgeResponseContentTypeName: "html", edgeResponseStatus: 200 }, orderBy: [count_DESC]) {
          count dimensions { clientRequestPath } } } } }`,
      variables: { zone, s: since.toISOString(), u: until.toISOString() },
    }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.errors?.length) throw new Error(d.errors?.[0]?.message || `HTTP ${r.status}`);
  return (d?.data?.viewer?.zones?.[0]?.pages || []).map((x: any) => ({ path: x.dimensions.clientRequestPath, views: x.count }));
}

/** The page's own title and picture, from its og: tags (streamed, never parsed whole). */
async function pageCard(origin: string, path: string): Promise<{ title: string; image: string } | null> {
  const res = await fetch(origin + encodeURI(path), { headers: { "User-Agent": "ARW-Top10/1.0" } }).catch(() => null);
  if (!res || !res.ok) return null;
  let title = "", image = "", thumb = "";
  await new HTMLRewriter()
    .on('meta[property="og:title"]', { element(e) { title = title || e.getAttribute("content") || ""; } })
    .on('meta[property="og:image"]', { element(e) { image = image || e.getAttribute("content") || ""; } })
    // the page's small card picture (480px WebP) instead of the full upload (INCIDENTS #279)
    .on('meta[name="arw-thumb"]', { element(e) { thumb = thumb || e.getAttribute("content") || ""; } })
    .transform(res).arrayBuffer();
  if (thumb) image = thumb;
  title = decodeEntities(title).replace(/\s*[|–-]\s*عرب راسلنج.*$/, "").trim();
  return title ? { title, image: decodeEntities(image) } : null;
}

export async function buildTop10(env: Top10Env, range: "day" | "week"): Promise<Top10Item[]> {
  const cfg = env.PUSH_KV ? ((await env.PUSH_KV.get(CONFIG_KEY, "json")) as { token: string; zoneId: string } | null) : null;
  if (!cfg) return [];
  let rows: { path: string; views: number }[] = [];
  try { rows = await topPaths(cfg.token, cfg.zoneId, range === "week" ? 24 * 7 : 24); }
  catch { if (range === "week") rows = await topPaths(cfg.token, cfg.zoneId, 24).catch(() => []); } // plans that only keep a day
  const ranked = rankPages(rows, 14);
  const cards = await Promise.all(ranked.map(r => pageCard(env.SITE_ORIGIN, r.path)));
  const out: Top10Item[] = [];
  ranked.forEach((r, i) => { const c = cards[i]; if (c && out.length < 10) out.push({ url: r.path, title: c.title, image: c.image, kind: r.kind, views: r.views }); });
  return out;
}

/** GET /top10?range=day|week — cached list, rebuilt at most every 30 minutes. */
export async function top10Response(env: Top10Env, range: string): Promise<Response> {
  const r: "day" | "week" = range === "week" ? "week" : "day";
  const headers = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  let cached: { at: number; items: Top10Item[] } | null = null;
  try { cached = env.PUSH_KV ? ((await env.PUSH_KV.get(CACHE_KEY(r), "json")) as any) : null; } catch { cached = null; }
  if (cached && Date.now() - cached.at < CACHE_MS) return new Response(JSON.stringify({ range: r, items: cached.items }), { headers });
  try {
    const items = await buildTop10(env, r);
    if (items.length && env.PUSH_KV) await env.PUSH_KV.put(CACHE_KEY(r), JSON.stringify({ at: Date.now(), items }), { expirationTtl: 6 * 3600 });
    return new Response(JSON.stringify({ range: r, items: items.length ? items : cached?.items || [] }), { headers });
  } catch {
    return new Response(JSON.stringify({ range: r, items: cached?.items || [] }), { headers });
  }
}
