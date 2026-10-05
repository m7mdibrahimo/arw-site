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
const ORIGIN = "https://arab-wrestling.com";
const INSPECT_LIMIT = 60; // URL Inspection API allows 2,000/day per property; stay far below

interface ServiceAccount { client_email: string; private_key: string }

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
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

async function api(token: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
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
function newestUrls(limit: number): string[] {
  const { arabicSlug } = require(path.join(process.cwd(), "lib", "slug.cjs"));
  const dir = path.join(process.cwd(), "content", "news");
  return fs.readdirSync(dir).filter(f => /^\d{14}-.*\.md$/.test(f)).sort().reverse().slice(0, limit).map(f => {
    const d = matter(fs.readFileSync(path.join(dir, f), "utf-8")).data;
    const p = d.permalink ? String(d.permalink).replace(/index\.html$/, "") : `/news/${arabicSlug(String(d.title || ""))}/`;
    return ORIGIN + encodeURI(p);
  });
}

/** Turn the raw data into a short list of problems worth acting on. */
export function findProblems(r: any): string[] {
  const out: string[] = [];
  for (const s of r.sitemaps || []) {
    if (Number(s.errors) > 0) out.push(`خريطة الموقع ${s.path} فيها ${s.errors} خطأ`);
    if (Number(s.warnings) > 0) out.push(`خريطة الموقع ${s.path} فيها ${s.warnings} تحذير`);
  }
  for (const i of r.inspections || []) {
    const v = i.result?.indexStatusResult;
    if (!v) { if (i.error) out.push(`فحص الرابط فشل: ${decodeURI(i.url)} — ${i.error}`); continue; }
    if (v.verdict !== "PASS") out.push(`مش متفهرس (${v.coverageState || v.verdict}): ${decodeURI(i.url)}`);
    if (v.googleCanonical && v.userCanonical && v.googleCanonical !== v.userCanonical) out.push(`جوجل اختار صفحة أساسية تانية: ${decodeURI(i.url)} ← ${decodeURI(v.googleCanonical)}`);
    if (v.pageFetchState && v.pageFetchState !== "SUCCESSFUL") out.push(`جوجل مقدرش يجيب الصفحة (${v.pageFetchState}): ${decodeURI(i.url)}`);
    const mob = i.result?.mobileUsabilityResult;
    if (mob && mob.verdict === "FAIL") out.push(`مشكلة في عرض الموبايل: ${decodeURI(i.url)}`);
    const rich = i.result?.richResultsResult;
    if (rich && rich.verdict === "FAIL") out.push(`مشكلة في البيانات المنظمة: ${decodeURI(i.url)}`);
  }
  // Pages that show up a lot but almost nobody clicks: the title/description needs work.
  for (const p of r.pages || []) {
    if (p.impressions >= 300 && p.ctr < 0.01 && p.position <= 15) out.push(`ظهور كتير ونقرات قليلة (${p.impressions} ظهور، ${(p.ctr * 100).toFixed(1)}٪، ترتيب ${p.position.toFixed(1)}): ${decodeURI(p.keys[0])}`);
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
    query([], range, 1), query([], prev, 1), query(["query"]), query(["page"]), query(["country"], range, 15), query(["device"], range, 5),
    api(token, `https://www.googleapis.com/webmasters/v3/sites/${S}/sitemaps`).then(d => d.sitemap || []),
  ]);

  const inspections: any[] = [];
  for (const url of [ORIGIN + "/", ...newestUrls(INSPECT_LIMIT)]) {
    try {
      const d = await api(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: site, languageCode: "ar" });
      inspections.push({ url, result: d.inspectionResult });
    } catch (e: any) { inspections.push({ url, error: String(e.message).slice(0, 200) }); }
  }

  const report = { generatedAt: new Date().toISOString(), site, range, totals: totals[0] || null, totalsPrev: totalsPrev[0] || null, queries, pages, countries, devices, sitemaps, inspections };
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
    ...queries.slice(0, 20).map((q: any) => `- ${q.keys[0]} — ${q.clicks} نقرة، ${q.impressions} ظهور، ترتيب ${q.position.toFixed(1)}`),
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
