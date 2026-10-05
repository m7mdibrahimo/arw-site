// Daily Search Console report for arab-wrestling.com, read by the monitoring rounds (access granted 2026-10-06).
// Auth: a Google service account (JSON key in GSC_SERVICE_ACCOUNT) that the owner added
// as a user of the Search Console property. Read-only scope — this script never changes
// anything in Search Console.
//   npx tsx scripts/search-console-report.ts
// Writes seo/search-console.json (full data) and seo/search-console.md (what to fix).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";

const OUT_DIR = path.join(process.cwd(), "seo");
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// Write scope is used for one thing only: keeping the submitted sitemaps equal to the ones
// robots.txt declares (the owner gave the account «كامل» on 2026-10-06 for this).
const WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const ORIGIN = "https://arab-wrestling.com";
const INSPECT_LIMIT = 60; // URL Inspection API allows 2,000/day per property; stay far below

interface ServiceAccount { client_email: string; private_key: string }

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken(sa: ServiceAccount, scope = SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` }),
  });
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`token: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

async function api(token: string, url: string, body?: unknown, method?: string): Promise<any> {
  const res = await fetch(url, {
    method: method || (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}: ${JSON.stringify(data.error?.message || data).slice(0, 300)}`);
  return data;
}

const day = (offset: number) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);

/** The site's newest article URLs (permalink, or the title slug the build uses). */
function newestUrls(limit: number): { url: string; published: number }[] {
  const { arabicSlug } = require(path.join(process.cwd(), "lib", "slug.cjs"));
  const dir = path.join(process.cwd(), "content", "news");
  return fs.readdirSync(dir).filter(f => /^\d{14}-.*\.md$/.test(f)).sort().reverse().slice(0, limit).map(f => {
    const d = matter(fs.readFileSync(path.join(dir, f), "utf-8")).data;
    const p = d.permalink ? String(d.permalink).replace(/index\.html$/, "") : `/news/${arabicSlug(String(d.title || ""))}/`;
    return { url: ORIGIN + encodeURI(p), published: new Date(d.published_at || d.date).getTime() };
  });
}

/** Turn the raw data into a short list of problems worth acting on. */
export function findProblems(r: any): string[] {
  const out: string[] = [];
  for (const s of r.sitemaps || []) {
    if (Number(s.errors) > 0) out.push(`خريطة الموقع ${s.path} فيها ${s.errors} خطأ`);
    if (Number(s.warnings) > 0) out.push(`خريطة الموقع ${s.path} فيها ${s.warnings} تحذير`);
  }
  const now = Date.parse(r.generatedAt || "") || Date.now();
  for (const i of r.inspections || []) {
    const v = i.result?.indexStatusResult;
    if (!v) { if (i.error) out.push(`فحص الرابط فشل: ${decodeURI(i.url)} — ${i.error}`); continue; }
    // A story from the last 3 days that Google hasn't met yet is just new, not a problem
    const fresh = i.published && now - i.published < 3 * 86400_000;
    if (fresh && (!v.coverageState || /unknown|لم يتعرّف|لم يتعرف/i.test(v.coverageState))) continue;
    if (v.verdict !== "PASS") out.push(`مش متفهرس (${v.coverageState || v.verdict}): ${decodeURI(i.url)}`);
    if (v.googleCanonical && v.userCanonical && v.googleCanonical !== v.userCanonical) out.push(`جوجل اختار صفحة أساسية تانية: ${decodeURI(i.url)} ← ${decodeURI(v.googleCanonical)}`);
    if (v.pageFetchState && v.pageFetchState !== "SUCCESSFUL") out.push(`جوجل مقدرش يجيب الصفحة (${v.pageFetchState}): ${decodeURI(i.url)}`);
    const mob = i.result?.mobileUsabilityResult;
    if (mob && mob.verdict === "FAIL") out.push(`مشكلة في عرض الموبايل: ${decodeURI(i.url)}`);
    const rich = i.result?.richResultsResult;
    if (rich && rich.verdict === "FAIL") out.push(`مشكلة في البيانات المنظمة: ${decodeURI(i.url)}`);
  }
  // Pages that show up a lot but almost nobody clicks: the title/description needs work.
  for (const d of r.deadPages || []) out.push(`صفحة جوجل لسه بيبعت لها ناس ورابطها واقع (${d.impressions} ظهور): ${decodeURI(d.url)}`);
  // Only articles and show pages: listings and /about/ at position 1–2 are sitelinks under the
  // brand result, where few clicks is normal.
  for (const p of r.pages || []) {
    const path = decodeURI(new URL(p.keys[0]).pathname);
    const article = /^\/(?:news|shows|nostalgia)\/[^/]*[^\d/][^/]*\/?$/.test(path);
    if (article && p.impressions >= 300 && p.ctr < 0.01 && p.position >= 3 && p.position <= 15) out.push(`ظهور كتير ونقرات قليلة (${p.impressions} ظهور، ${(p.ctr * 100).toFixed(1)}٪، ترتيب ${p.position.toFixed(1)}): ${decodeURI(p.keys[0])}`);
  }
  return out;
}

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT;
  if (!raw) { console.log("[GSC] GSC_SERVICE_ACCOUNT is not set — nothing to do."); return; }
  const sa: ServiceAccount = JSON.parse(raw);
  const token = await accessToken(sa);

  const sites: any[] = (await api(token, "https://www.googleapis.com/webmasters/v3/sites")).siteEntry || [];
  const site = process.env.GSC_SITE
    || sites.find(s => s.siteUrl === "sc-domain:arab-wrestling.com")?.siteUrl
    || sites.find(s => /arab-wrestling\.com/.test(s.siteUrl))?.siteUrl;
  if (!site) throw new Error(`the service account has no access to arab-wrestling.com (sees: ${sites.map(s => s.siteUrl).join(", ") || "nothing"})`);
  const S = encodeURIComponent(site);
  console.log(`[GSC] Property: ${site}`);

  // Search data lags ~2 days.
  const range = { startDate: day(30), endDate: day(2) };
  const prev = { startDate: day(58), endDate: day(31) };
  const query = (dims: string[], r = range, rowLimit = 250) => api(token, `https://searchconsole.googleapis.com/webmasters/v3/sites/${S}/searchAnalytics/query`, { ...r, dimensions: dims, rowLimit, dataState: "all" }).then(d => d.rows || []);

  const [totals, totalsPrev, queries, pages, countries, devices, sitemaps] = await Promise.all([
    query([], range, 1), query([], prev, 1), query(["query"], range, 1000), query(["page"], range, 500), query(["country"], range, 15), query(["device"], range, 5),
    api(token, `https://www.googleapis.com/webmasters/v3/sites/${S}/sitemaps`).then(d => d.sitemap || []),
  ]);

  const inspections: any[] = [];
  for (const { url, published } of [{ url: ORIGIN + "/", published: 0 }, ...newestUrls(INSPECT_LIMIT)]) {
    try {
      const d = await api(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: site, languageCode: "ar" });
      inspections.push({ url, published, result: d.inspectionResult });
    } catch (e: any) { inspections.push({ url, published, error: String(e.message).slice(0, 200) }); }
  }

  // Which page answers each of the top searches — what to strengthen to reach #1.
  const queryPages = await query(["query", "page"], range, 2000);
  const topQueries = new Set(queries.slice(0, 40).map((q: any) => q.keys[0]));
  const bestPage: Record<string, any> = {};
  for (const row of queryPages) if (topQueries.has(row.keys[0]) && (!bestPage[row.keys[0]] || row.clicks > bestPage[row.keys[0]].clicks)) bestPage[row.keys[0]] = row;

  // Keep the submitted sitemaps equal to what robots.txt declares: drop one the site no longer
  // serves (video-sitemap.xml, removed 2026-10-05, kept 500 warnings — INCIDENTS #273) and
  // submit a declared one that is missing.
  const actions: string[] = [];
  try {
    const robots = await (await fetch(`${ORIGIN}/robots.txt`, { signal: AbortSignal.timeout(20000) })).text();
    const declared = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map(m => m[1]);
    const writeToken = await accessToken(sa, WRITE_SCOPE);
    for (const sm of sitemaps) {
      const res = await fetch(sm.path, { method: "GET", signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (res && (res.status === 404 || res.status === 410) && !declared.includes(sm.path)) {
        await api(writeToken, `https://www.googleapis.com/webmasters/v3/sites/${S}/sitemaps/${encodeURIComponent(sm.path)}`, undefined, "DELETE");
        actions.push(`اتشالت خريطة مش موجودة على الموقع: ${sm.path}`);
      }
    }
    for (const d of declared) if (!sitemaps.some((sm: any) => sm.path === d)) {
      await api(writeToken, `https://www.googleapis.com/webmasters/v3/sites/${S}/sitemaps/${encodeURIComponent(d)}`, undefined, "PUT");
      actions.push(`اتسجلت خريطة جديدة: ${d}`);
    }
  } catch (e: any) { actions.push(`ماقدرتش أظبط الخرائط: ${String(e.message).slice(0, 200)}`); }

  // Pages Google still sends people to that no longer answer: each one is lost traffic (INCIDENTS #274)
  const deadPages: any[] = [];
  for (const p of pages) {
    const res = await fetch(p.keys[0], { method: "GET", redirect: "follow", signal: AbortSignal.timeout(25000) }).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) deadPages.push({ url: p.keys[0], clicks: p.clicks, impressions: p.impressions });
  }

  // Searches where the site shows up but is not #1 yet — the work list for reaching #1 (INCIDENTS #275)
  const allBest: Record<string, any> = {};
  for (const row of queryPages) if (!allBest[row.keys[0]] || row.impressions > allBest[row.keys[0]].impressions) allBest[row.keys[0]] = row;
  const opportunities = queries
    .filter((q: any) => q.impressions >= 40 && q.position > 1.4)
    .map((q: any) => ({ query: q.keys[0], impressions: q.impressions, clicks: q.clicks, position: q.position, page: allBest[q.keys[0]]?.keys[1] || "", score: q.impressions * (q.position - 1) }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 40);

  // Daily history, to see whether a change moved a search up or down.
  const histFile = path.join(OUT_DIR, "search-history.json");
  let history: any[] = [];
  try { history = JSON.parse(fs.readFileSync(histFile, "utf-8")); } catch {}
  const today = new Date().toISOString().slice(0, 10);
  history = history.filter(h => h.date !== today);
  history.push({ date: today, clicks: totals[0]?.clicks ?? 0, impressions: totals[0]?.impressions ?? 0, position: totals[0]?.position ?? null, queries: Object.fromEntries(queries.slice(0, 60).map((q: any) => [q.keys[0], Number(q.position.toFixed(1))])) });
  history = history.slice(-180);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(histFile, JSON.stringify(history, null, 1) + "\n");
  const prevDay = history.length > 1 ? history[history.length - 2] : null;

  const report = { generatedAt: new Date().toISOString(), site, range, deadPages, opportunities, totals: totals[0] || null, totalsPrev: totalsPrev[0] || null, queries, pages, countries, devices, sitemaps, inspections, bestPage, actions };
  const problems = findProblems(report);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(path.join(OUT_DIR, "search-console-error.txt"), { force: true });
  fs.writeFileSync(path.join(OUT_DIR, "search-console.json"), JSON.stringify({ ...report, problems }, null, 1) + "\n");

  const t = report.totals, tp = report.totalsPrev;
  const pct = (a?: number, b?: number) => (a != null && b ? `${(((a - b) / b) * 100).toFixed(0)}٪` : "—");
  const md = [
    `# تقرير أدوات جوجل للمواقع — ${report.generatedAt.slice(0, 10)}`,
    "",
    `آخر ٢٨ يوم (${range.startDate} ← ${range.endDate}):`,
    `- النقرات: ${t?.clicks ?? 0} (التغيير عن الفترة اللي قبلها: ${pct(t?.clicks, tp?.clicks)})`,
    `- مرات الظهور: ${t?.impressions ?? 0} (${pct(t?.impressions, tp?.impressions)})`,
    `- نسبة النقر: ${t ? (t.ctr * 100).toFixed(2) : 0}٪ — متوسط الترتيب: ${t ? t.position.toFixed(1) : "—"}`,
    "",
    "## أكتر عمليات بحث",
    ...queries.slice(0, 20).map((q: any) => `- ${q.keys[0]} — ${q.clicks} نقرة، ${q.impressions} ظهور، ترتيب ${q.position.toFixed(1)}${bestPage[q.keys[0]] ? ` ← ${decodeURI(bestPage[q.keys[0]].keys[1]).replace(ORIGIN, "")}` : ""}`),
    "",
    `## اللي اتعمل تلقائي (${actions.length})`,
    ...(actions.length ? actions.map(a => `- ${a}`) : ["- مفيش"]),
    "",
    `## فرص للوصول للمركز الأول (${opportunities.length})`,
    "عمليات بحث الموقع بيظهر فيها بس مش الأول. الأهم فوق. الهدف تقوية الصفحة اللي جنبها (العنوان، الوصف، الروابط الداخلية، المحتوى) أو عمل صفحة مخصوصة لو مفيش.",
    ...opportunities.map((o: any) => {
      const was = prevDay?.queries?.[o.query];
      const move = was != null ? ` (كان ${was})` : "";
      return `- ${o.query} — ترتيب ${o.position.toFixed(1)}${move}، ${o.impressions} ظهور، ${o.clicks} نقرة${o.page ? ` ← ${decodeURI(o.page).replace(ORIGIN, "")}` : ""}`;
    }),
    "",
    `## مشاكل لازم تتصلح (${problems.length})`,
    ...(problems.length ? problems.map(p => `- ${p}`) : ["- مفيش"]),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "search-console.md"), md);
  console.log(`[GSC] ✅ ${queries.length} queries, ${pages.length} pages, ${inspections.length} URLs inspected, ${problems.length} problems.`);
}

if (require.main === module) {
  main().catch(e => {
    console.error("[GSC] ❌", e.message);
    // The run log needs a login to read; leave the reason where the monitoring rounds look.
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "search-console-error.txt"), `${new Date().toISOString()}\n${String(e.message).replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[key]").slice(0, 1000)}\n`);
    process.exit(1);
  });
}
