// The site's own statistics, people only (owner 2026-10-12: «كل التحاليل دي تكون حقيقة 100٪ لان دي ال بقيم بيها الموقع»,
// INCIDENTS #457). Cloudflare's zone numbers count requests, not people: crawlers (Bing, Amazon, Perplexity, Google), the
// site's own bots and builds — «أكثر الدول» read «الولايات المتحدة 52%» while its people were under 3% of the visits.
// Every page sends one view from a real browser (assets/v.js); this records it in the D1 database «arw-analytics»:
//   page_daily / page_total / page_hourly — views per page (by day, for ever, by hour)
//   day_views / hour_views / country_daily  — views per day, per hour, per country and day
//   visitor_daily / visitor_hourly          — one row per visitor and day (or hour): an anonymous hash of the
//                                              address, browser and day, never stored as is (no cookie)
// Days and hours are Cairo time, the owner's. Nothing before the counter started (2026-10-12 18:49 Cairo) is shown:
// Cloudflare's records can't tell a page a person saw from one the browser fetched ahead in case it is clicked
// (prefetch/prerender) — with every bot left out they still read 5–6 times the real views (one visitor «opened» the
// same show 15 times in 15 minutes). A day the counter didn't see shows «—», never a number that wasn't measured.

export interface AnalyticsEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace }

const SITE_HOST = /^(?:www\.)?arab-wrestling\.com$/;
/** Crawlers, previews, tools and the site's own bots — never a view. */
export const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|externalhit|python|curl|wget|scrapy|go-http|okhttp|axios|node-fetch|^node$|phantom|puppeteer|playwright|selenium|^mozilla\/5\.0 \(compatible\)$/i;

const CAIRO = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
/** «2026-10-12» and «2026-10-12T21» in Cairo time. */
export function cairo(ms: number): { day: string; hour: string } {
  const p: Record<string, string> = {};
  for (const x of CAIRO.formatToParts(new Date(ms))) p[x.type] = x.value;
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, hour: `${day}T${p.hour}` };
}

/** A page's address as the site writes it: decoded, no query, «/x/» — or null for anything that isn't a page. */
export function pagePath(raw: unknown): string | null {
  let p = String(raw || "").split(/[?#]/)[0];
  if (!p.startsWith("/") || p.length > 600) return null;
  try { p = decodeURIComponent(p); } catch { /* keep as sent */ }
  p = p.normalize("NFC").replace(/\/index\.html$/, "/").replace(/\/{2,}/g, "/");
  if (/^\/(?:admin|studio|api|assets|img|content|videos)(?:\/|$)/.test(p)) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return null; // a file, not a page
  return p.endsWith("/") ? p : `${p}/`;
}

async function salt(env: AnalyticsEnv): Promise<string> {
  let s = await env.PUSH_KV.get("analytics:salt");
  if (!s) { s = crypto.randomUUID(); await env.PUSH_KV.put("analytics:salt", s); }
  return s;
}
async function visitorHash(env: AnalyticsEnv, day: string, ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${await salt(env)}|${day}|${ip}|${ua}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h.slice(0, 10), b => b.toString(16).padStart(2, "0")).join("");
}

const CORS = { "Access-Control-Allow-Origin": "https://arab-wrestling.com", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** True when the request comes from a page of the site (Origin, or Referer when a browser sends no Origin). */
export function fromSite(origin: string | null, referer: string | null): boolean {
  for (const u of [origin, referer]) {
    if (!u) continue;
    try { if (SITE_HOST.test(new URL(u).hostname)) return true; } catch { /* not a URL */ }
  }
  return false;
}

/** POST /v {p: "/shows/x/"} — one view. Always answers 204: a refused view shows nothing to anyone. */
export async function recordView(request: Request, env: AnalyticsEnv, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const done = new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST" || !env.ANALYTICS) return done;
  const ua = request.headers.get("User-Agent") || "";
  if (!ua || BOT_UA.test(ua)) return done;
  if (!fromSite(request.headers.get("Origin"), request.headers.get("Referer"))) return done;
  let body: any = null;
  try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch { return done; }
  const path = pagePath(body?.p);
  if (!path) return done;
  const country = String((request as any).cf?.country || "XX").slice(0, 2).toUpperCase();
  const { day, hour } = cairo(now);
  const vh = await visitorHash(env, day, request.headers.get("CF-Connecting-IP") || "", ua);
  const db = env.ANALYTICS;
  await db.batch([
    db.prepare("INSERT INTO page_daily (day, path, views) VALUES (?1, ?2, 1) ON CONFLICT (day, path) DO UPDATE SET views = views + 1").bind(day, path),
    db.prepare("INSERT INTO page_total (path, views) VALUES (?1, 1) ON CONFLICT (path) DO UPDATE SET views = views + 1").bind(path),
    db.prepare("INSERT INTO page_hourly (hour, path, views) VALUES (?1, ?2, 1) ON CONFLICT (hour, path) DO UPDATE SET views = views + 1").bind(hour, path),
    db.prepare("INSERT INTO day_views (day, views) VALUES (?1, 1) ON CONFLICT (day) DO UPDATE SET views = views + 1").bind(day),
    db.prepare("INSERT INTO hour_views (hour, views) VALUES (?1, 1) ON CONFLICT (hour) DO UPDATE SET views = views + 1").bind(hour),
    db.prepare("INSERT INTO country_daily (day, country, views) VALUES (?1, ?2, 1) ON CONFLICT (day, country) DO UPDATE SET views = views + 1").bind(day, country),
    db.prepare("INSERT INTO visitor_daily (day, vhash, country) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING").bind(day, vh, country),
    db.prepare("INSERT INTO visitor_hourly (hour, vhash) VALUES (?1, ?2) ON CONFLICT DO NOTHING").bind(hour, vh),
  ]).catch(() => null);
  return done;
}

const daysBack = (now: number, n: number) => cairo(now - n * 86400_000).day;

/** The panel's statistics: the same shape the Cloudflare version had, now people only. */
export async function siteAnalytics(env: AnalyticsEnv, days = 30, now = Date.now()) {
  const db = env.ANALYTICS!;
  const from = daysBack(now, days - 1), from7 = daysBack(now, 6);
  const h24 = cairo(now - 23 * 3600_000).hour;
  const [views, people, hViews, hPeople, countries, pages, start] = await db.batch([
    db.prepare("SELECT day, views FROM day_views WHERE day >= ?1 ORDER BY day").bind(from),
    db.prepare("SELECT day, COUNT(*) AS n FROM visitor_daily WHERE day >= ?1 GROUP BY day").bind(from),
    db.prepare("SELECT hour, views FROM hour_views WHERE hour >= ?1 ORDER BY hour").bind(h24),
    db.prepare("SELECT hour, COUNT(*) AS n FROM visitor_hourly WHERE hour >= ?1 GROUP BY hour").bind(h24),
    db.prepare("SELECT country, SUM(views) AS v FROM country_daily WHERE day >= ?1 GROUP BY country ORDER BY v DESC LIMIT 8").bind(from7),
    db.prepare("SELECT path, SUM(views) AS v FROM page_hourly WHERE hour >= ?1 GROUP BY path ORDER BY v DESC LIMIT 12").bind(h24),
    db.prepare("SELECT MIN(day) AS d FROM day_views"),
  ]) as any[];
  const vByDay = new Map<string, number>((views.results || []).map((r: any) => [r.day, r.views]));
  const pByDay = new Map<string, number>((people.results || []).map((r: any) => [r.day, r.n]));
  const since: string | null = start.results?.[0]?.d || null;
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = daysBack(now, i);
    // before the counter started nothing was measured: no number rather than a wrong one
    const seen = !!since && day >= since;
    daily.push({ date: day, views: seen ? vByDay.get(day) || 0 : null, visitors: seen ? pByDay.get(day) || 0 : null });
  }
  const hvByHour = new Map<string, number>((hViews.results || []).map((r: any) => [r.hour, r.views]));
  const hpByHour = new Map<string, number>((hPeople.results || []).map((r: any) => [r.hour, r.n]));
  const hourly = [];
  for (let i = 23; i >= 0; i--) {
    const hour = cairo(now - i * 3600_000).hour;
    const seen = !!since && hour.slice(0, 10) >= since;
    hourly.push({ at: hour, views: seen ? hvByHour.get(hour) || 0 : null, visitors: seen ? hpByHour.get(hour) || 0 : null });
  }
  return {
    daily, hourly, visitorsSince: since, since,
    topCountries: (countries.results || []).map((r: any) => ({ code: r.country, requests: r.v })),
    topPages: (pages.results || []).map((r: any) => ({ path: r.path, views: r.v })),
    source: "site", updatedAt: now,
  };
}

/** Every page's views since the counter has records (for the panel's lists). */
export async function pageTotals(env: AnalyticsEnv): Promise<{ since: string | null; views: Record<string, number> }> {
  const db = env.ANALYTICS!;
  const [rows, since] = await db.batch([
    db.prepare("SELECT path, views FROM page_total"),
    db.prepare("SELECT MIN(day) AS d FROM day_views"),
  ]) as any[];
  const views: Record<string, number> = {};
  for (const r of rows.results || []) views[r.path] = r.views;
  return { since: since.results?.[0]?.d || null, views };
}

/** The most viewed show/recap/nostalgia pages of the last `days` days (the home page's «الأكثر مشاهدة»). */
export async function topWatchPages(env: AnalyticsEnv, days: number, now = Date.now()): Promise<{ path: string; views: number }[]> {
  const r: any = await env.ANALYTICS!.prepare(
    "SELECT path, SUM(views) AS v FROM page_daily WHERE day >= ?1 AND (path LIKE '/shows/%' OR path LIKE '/recaps/%' OR path LIKE '/nostalgia/%') GROUP BY path ORDER BY v DESC LIMIT 40",
  ).bind(daysBack(now, days - 1)).all();
  return (r.results || []).map((x: any) => ({ path: x.path, views: x.v }));
}

/** Once a day: hourly rows live 3 days, visitor rows 45 (the panel shows 30). Daily views and totals are kept. */
export async function pruneAnalytics(env: AnalyticsEnv, now = Date.now()) {
  if (!env.ANALYTICS) return;
  const db = env.ANALYTICS;
  const h = cairo(now - 3 * 86400_000).hour, d = daysBack(now, 45);
  await db.batch([
    db.prepare("DELETE FROM page_hourly WHERE hour < ?1").bind(h),
    db.prepare("DELETE FROM hour_views WHERE hour < ?1").bind(h),
    db.prepare("DELETE FROM visitor_hourly WHERE hour < ?1").bind(h),
    db.prepare("DELETE FROM visitor_daily WHERE day < ?1").bind(d),
  ]).catch(() => null);
}
