// New show, recap and nostalgia pages go to the search engines as soon as they are live (owner, 2026-10-06):
//   1. a page new in the live sitemap, or one whose lastmod changed (servers added, a library page with a new
//      show) → IndexNow (Bing, Yandex, Seznam, Naver…) and the sitemap resubmitted in Search Console, so Google
//      crawls it now instead of on its next visit
//   2. from 6 hours on, until Google has it → URL Inspection; still not indexed after 72 hours → a problem
//   3. once indexed → its clicks, impressions and position from the daily report, and a problem when it is
//      still below the first results after five days
// Only search engines see any of this — nothing on the page changes (the owner's rule).
//   npx tsx scripts/seo-new-shows.ts      (GSC_SERVICE_ACCOUNT for steps 1–2 on Google; IndexNow needs nothing)
// Writes seo/new-shows.json (state) and seo/new-shows.md (what to fix), read by the monitoring rounds.
import fs from "fs";
import path from "path";
import { accessToken, api } from "./search-console-report";

const ORIGIN = "https://arab-wrestling.com";
const HOST = "arab-wrestling.com";
export const INDEXNOW_KEY = "59b53f56b275106f1db31d7a0407d4b9"; // served at /<key>.txt (pages/indexnow-key.njk)
const OUT = path.join(process.cwd(), "seo");
const STATE = path.join(OUT, "new-shows.json");
const WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const H = 3600_000;
const INSPECT_PER_RUN = 40;

interface Page { firstSeen: string; lastmod: string; pinged?: string; inspected?: string; verdict?: string; coverage?: string; indexedAt?: string }
interface State { pages: Record<string, Page>; sitemapPinged?: string }

/** Watch pages: one show, recap or nostalgia episode, and a program's library page. */
export function isWatchUrl(u: string): boolean {
  const p = u.replace(ORIGIN, "");
  return /^\/(shows|recaps|nostalgia|library)\/[^/]+\/$/.test(p);
}

/** <loc> and <lastmod> of every URL in a sitemap. */
export function parseSitemap(xml: string): { loc: string; lastmod: string }[] {
  const out: { loc: string; lastmod: string }[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1];
    const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || "";
    if (loc) out.push({ loc, lastmod });
  }
  return out;
}

/** Pages to send now: new ones, and known ones whose lastmod moved. The first run only sends the last 3 days. */
export function pagesToSend(entries: { loc: string; lastmod: string }[], state: State, now = Date.now()): string[] {
  const first = !Object.keys(state.pages).length;
  const out: string[] = [];
  for (const e of entries) {
    if (!isWatchUrl(e.loc)) continue;
    const known = state.pages[e.loc];
    if (known && known.lastmod === e.lastmod) continue;
    if (first && (!e.lastmod || now - Date.parse(e.lastmod) > 3 * 24 * H)) {
      state.pages[e.loc] = { firstSeen: new Date(now).toISOString(), lastmod: e.lastmod, pinged: "before tracking" };
      continue;
    }
    out.push(e.loc);
  }
  return out;
}

async function live(url: string): Promise<boolean> {
  const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30000) }).catch(() => null);
  return !!r && r.status === 200;
}

async function indexNow(urls: string[]): Promise<string> {
  if (!urls.length) return "nothing";
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10000) }),
    signal: AbortSignal.timeout(30000),
  }).catch((e: Error) => ({ status: 0, statusText: e.message } as any));
  return `${r.status} ${r.statusText || ""}`.trim();
}

const path_ = (u: string) => { try { return decodeURI(u.replace(ORIGIN, "")); } catch { return u.replace(ORIGIN, ""); } };

async function main() {
  const now = Date.now();
  let state: State = { pages: {} };
  try { state = JSON.parse(fs.readFileSync(STATE, "utf-8")); } catch {}
  state.pages = state.pages || {};

  const xml = await (await fetch(`${ORIGIN}/sitemap.xml`, { signal: AbortSignal.timeout(60000) })).text();
  const entries = parseSitemap(xml);
  if (!entries.length) throw new Error("the live sitemap has no URLs");
  const lastmodOf = new Map(entries.map(e => [e.loc, e.lastmod]));

  // 1. send new and changed pages
  const candidates = pagesToSend(entries, state, now);
  const ready: string[] = [];
  for (const u of candidates) if (await live(u)) ready.push(u);
  const inRes = await indexNow(ready);
  if (ready.length) console.log(`[SEO] IndexNow ${ready.length} page(s): ${inRes}`);

  const raw = process.env.GSC_SERVICE_ACCOUNT;
  let site = "", readToken = "", writeToken = "";
  if (raw) {
    const sa = JSON.parse(raw);
    readToken = await accessToken(sa, READ_SCOPE);
    const sites: any[] = (await api(readToken, "https://www.googleapis.com/webmasters/v3/sites")).siteEntry || [];
    site = process.env.GSC_SITE || sites.find(s => s.siteUrl === "sc-domain:arab-wrestling.com")?.siteUrl || sites.find(s => /arab-wrestling\.com/.test(s.siteUrl))?.siteUrl || "";
    if (ready.length && site) {
      writeToken = await accessToken(sa, WRITE_SCOPE);
      await api(writeToken, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(`${ORIGIN}/sitemap.xml`)}`, undefined, "PUT");
      state.sitemapPinged = new Date(now).toISOString();
      console.log("[SEO] sitemap resubmitted to Google");
    }
  } else console.log("[SEO] GSC_SERVICE_ACCOUNT is not set — Google steps skipped");

  for (const u of ready) {
    const p = state.pages[u];
    state.pages[u] = { ...(p || { firstSeen: new Date(now).toISOString() }), lastmod: lastmodOf.get(u) || "", pinged: new Date(now).toISOString() };
  }

  // 2. ask Google about pages it may not have yet
  if (site && readToken) {
    const due = Object.entries(state.pages)
      .filter(([u, p]) => p.pinged && p.pinged !== "before tracking" && !p.indexedAt && lastmodOf.has(u)
        && now - Date.parse(p.firstSeen) >= 6 * H && now - Date.parse(p.firstSeen) <= 10 * 24 * H
        && (!p.inspected || now - Date.parse(p.inspected) >= 6 * H))
      .sort((a, b) => Date.parse(a[1].firstSeen) - Date.parse(b[1].firstSeen))
      .slice(0, INSPECT_PER_RUN);
    for (const [u, p] of due) {
      try {
        const d = await api(readToken, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: u, siteUrl: site, languageCode: "ar" });
        const r = d.inspectionResult?.indexStatusResult || {};
        p.inspected = new Date(now).toISOString();
        p.verdict = r.verdict || "";
        p.coverage = r.coverageState || "";
        if (r.verdict === "PASS") p.indexedAt = p.indexedAt || new Date(now).toISOString();
      } catch (e: any) { console.log(`[SEO] inspect ${path_(u)}: ${e.message}`); }
    }
  }

  // 3. report
  let perf: Record<string, { clicks: number; impressions: number; position: number }> = {};
  try {
    const rep = JSON.parse(fs.readFileSync(path.join(OUT, "search-console.json"), "utf-8"));
    for (const r of rep.pages || []) perf[r.keys[0]] = { clicks: r.clicks, impressions: r.impressions, position: r.position };
  } catch {}
  const recent = Object.entries(state.pages)
    .filter(([, p]) => p.pinged && p.pinged !== "before tracking" && now - Date.parse(p.firstSeen) <= 14 * 24 * H)
    .sort((a, b) => Date.parse(b[1].firstSeen) - Date.parse(a[1].firstSeen));
  const problems: string[] = [];
  for (const [u, p] of recent) {
    const age = (now - Date.parse(p.firstSeen)) / H;
    if (!p.indexedAt && age >= 72 && p.inspected) problems.push(`- مش متفهرسة بعد ${Math.round(age)} ساعة: ${path_(u)} — ${p.coverage || p.verdict || "؟"}`);
    const pf = perf[u];
    if (p.indexedAt && age >= 5 * 24 && pf && pf.impressions >= 30 && pf.position > 3) problems.push(`- متفهرسة بس ترتيبها ${pf.position.toFixed(1)} (${pf.impressions} ظهور): ${path_(u)} — حسّن العنوان والوصف والبيانات المنظمة`);
  }
  const lines = [
    `# الصفحات الجديدة في البحث`,
    ``,
    `آخر تحديث: ${new Date(now).toISOString()} · آخر إرسال لخريطة الموقع لجوجل: ${state.sitemapPinged || "—"}`,
    ``,
    `## مشاكل لازم تتصلح`,
    problems.length ? problems.join("\n") : "- مفيش",
    ``,
    `## آخر ١٤ يوم`,
    `| الصفحة | ظهرت | اتبعتت | جوجل | نقرات | ظهور | الترتيب |`,
    `|---|---|---|---|---|---|---|`,
    ...recent.slice(0, 80).map(([u, p]) => {
      const pf = perf[u];
      return `| ${path_(u)} | ${p.firstSeen.slice(0, 16).replace("T", " ")} | ${(p.pinged || "").slice(0, 16).replace("T", " ")} | ${p.indexedAt ? "متفهرسة" : p.coverage || (p.inspected ? p.verdict : "لسه")} | ${pf ? pf.clicks : "—"} | ${pf ? pf.impressions : "—"} | ${pf ? pf.position.toFixed(1) : "—"} |`;
    }),
    ``,
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT, "new-shows.md"), lines.join("\n"));
  console.log(`[SEO] sent ${ready.length}, tracking ${recent.length}, problems ${problems.length}`);
}

if (require.main === module) main().catch(e => { console.error("[SEO]", String(e.message).replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[key]")); process.exit(1); });
