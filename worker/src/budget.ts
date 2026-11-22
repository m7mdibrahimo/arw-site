// The 5-dollar ceiling (INCIDENTS #1477). Owner 2026-11-22: «خلي الموقع علي الخطة 5 دولار وخلاص بس ميستهلكش اكتر من كدا
// مهما يحصل». Cloudflare has no spending cap, so the site keeps its own: every hour this reads the account's usage since the
// billing period began (the 22nd of each month) and compares it with what Workers Paid (and R2's free tier) include.
//   • brake: near the CPU allowance, arw-media stops resizing pictures it hasn't stored yet (R2 status/budget.json)
//   • alert: /health raises «budget_high» (Telegram) when anything is near its allowance or on course to pass it
//   • Cloudflare build minutes are watched like the rest: the builds are on GitHub now (INCIDENTS #1476), so any rise
//     means a Workers Builds trigger came back

export interface BudgetEnv { PUSH_KV: KVNamespace; MEDIA?: R2Bucket; CF_USAGE_TOKEN?: string; CF_ACCOUNT_ID?: string }

export const BUDGET_KEY = "budget:status";
const ACCOUNT = "c6e90e83557c9ac6cb996a9f6c21a016";

/** What the 5-dollar plan includes each billing month (Workers Paid + R2's free tier). */
export const INCLUDED = {
  requests: 10_000_000,
  cpuMs: 30_000_000,
  buildMinutes: 6_000,
  kvReads: 10_000_000,
  kvWrites: 1_000_000,
  kvDeletes: 1_000_000,
  kvLists: 1_000_000,
  d1RowsRead: 25_000_000_000,
  d1RowsWritten: 50_000_000,
  doRequests: 1_000_000,
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  r2StorageBytes: 10_000_000_000,
} as const;
export type Metric = keyof typeof INCLUDED;

export const NAMES: Record<Metric, string> = {
  requests: "طلبات السيرفرات", cpuMs: "وقت المعالجة", buildMinutes: "دقايق البناء على كلاودفلير",
  kvReads: "قراءات التخزين السريع", kvWrites: "كتابات التخزين السريع", kvDeletes: "مسح التخزين السريع", kvLists: "قوايم التخزين السريع",
  d1RowsRead: "قراءات قاعدة البيانات", d1RowsWritten: "كتابات قاعدة البيانات", doRequests: "طلبات غرف المجتمع",
  r2ClassA: "كتابات مخزن الصور", r2ClassB: "قراءات مخزن الصور", r2StorageBytes: "مساحة مخزن الصور",
};

// R2's operation classes (https://developers.cloudflare.com/r2/pricing/): deletes are free, the rest is A or B
const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
const R2_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
export function r2Class(action: string): "A" | "B" | null {
  if (R2_FREE.has(action)) return null;
  return R2_B.has(action) ? "B" : "A";
}

/** The billing period this moment is in: from the 22nd 00:00 UTC to the next 22nd. */
export function periodOf(now: number): { start: number; end: number } {
  const d = new Date(now);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (d.getUTCDate() < 22) m -= 1;
  const start = Date.UTC(y, m, 22);
  const end = Date.UTC(y, m + 1, 22);
  return { start, end };
}

export interface MetricState { key: Metric; used: number; included: number; pct: number; projectedPct: number }
export interface BudgetStatus { at: number; start: number; end: number; metrics: MetricState[]; brakeCpu: boolean; warn: Metric[] }

/** The verdict from the raw usage: a metric warns at 60% used, or when it is on course to pass 90% by the period's end
 *  (judged only after a day, so the first hours' noise can't alarm); the CPU brake holds at 75% used or 95% projected. */
export function judge(used: Partial<Record<Metric, number>>, now: number, period = periodOf(now)): BudgetStatus {
  const elapsed = Math.max(1, now - period.start), span = period.end - period.start;
  const metrics: MetricState[] = (Object.keys(INCLUDED) as Metric[]).map((key) => {
    const u = Number(used[key]) || 0, inc = INCLUDED[key];
    const pct = (u / inc) * 100;
    // storage isn't a running total: it is what is kept now
    const projectedPct = key === "r2StorageBytes" ? pct : pct * (span / elapsed);
    return { key, used: u, included: inc, pct: Math.round(pct * 10) / 10, projectedPct: Math.round(projectedPct * 10) / 10 };
  });
  const settled = elapsed >= 86_400_000;
  const warn = metrics.filter((m) => m.pct >= 60 || (settled && m.projectedPct >= 90)).map((m) => m.key);
  const cpu = metrics.find((m) => m.key === "cpuMs")!;
  const brakeCpu = cpu.pct >= 75 || (settled && cpu.projectedPct >= 95);
  return { at: now, start: period.start, end: period.end, metrics, brakeCpu, warn };
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** One GraphQL call for everything (one subrequest). Dates are whole UTC days from the period's first day. */
export async function readUsage(token: string, account: string, start: number, now: number, fetcher: typeof fetch = fetch): Promise<Partial<Record<Metric, number>>> {
  const f = `{date_geq:"${day(start)}",date_leq:"${day(now)}"}`;
  const query = `{viewer{accounts(filter:{accountTag:"${account}"}){
    w:workersInvocationsAdaptive(limit:10000,filter:${f}){sum{requests cpuTimeUs}}
    b:workersBuildsBuildMinutesAdaptiveGroups(limit:1000,filter:${f}){sum{buildMinutes}}
    k:kvOperationsAdaptiveGroups(limit:1000,filter:${f}){sum{requests}dimensions{actionType}}
    d:d1AnalyticsAdaptiveGroups(limit:1000,filter:${f}){sum{rowsRead rowsWritten}}
    o:durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:${f}){sum{requests}}
    r:r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:"${new Date(start).toISOString()}",datetime_leq:"${new Date(now).toISOString()}"}){sum{requests}dimensions{actionType}}
    s:r2StorageAdaptiveGroups(limit:100,filter:{date_geq:"${day(now - 2 * 86_400_000)}"},orderBy:[date_DESC]){max{payloadSize metadataSize}dimensions{bucketName date}}
  }}}`;
  const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  const j: any = await r.json();
  const a = j?.data?.viewer?.accounts?.[0];
  if (!a) throw new Error(`usage: ${JSON.stringify(j?.errors || j).slice(0, 300)}`);
  const sum = (rows: any[], f: (x: any) => number) => (rows || []).reduce((n, x) => n + (Number(f(x)) || 0), 0);
  const kv = (t: string) => sum((a.k || []).filter((x: any) => x?.dimensions?.actionType === t), (x) => x.sum.requests);
  const r2 = (c: "A" | "B") => sum((a.r || []).filter((x: any) => r2Class(String(x?.dimensions?.actionType)) === c), (x) => x.sum.requests);
  // storage: each bucket's newest day
  const latest = new Map<string, number>();
  for (const x of a.s || []) { const b = String(x?.dimensions?.bucketName); if (!latest.has(b)) latest.set(b, (Number(x?.max?.payloadSize) || 0) + (Number(x?.max?.metadataSize) || 0)); }
  return {
    requests: sum(a.w, (x) => x.sum.requests),
    cpuMs: sum(a.w, (x) => x.sum.cpuTimeUs) / 1000,
    buildMinutes: sum(a.b, (x) => x.sum.buildMinutes),
    kvReads: kv("read"), kvWrites: kv("write"), kvDeletes: kv("delete"), kvLists: kv("list"),
    d1RowsRead: sum(a.d, (x) => x.sum.rowsRead), d1RowsWritten: sum(a.d, (x) => x.sum.rowsWritten),
    doRequests: sum(a.o, (x) => x.sum.requests),
    r2ClassA: r2("A"), r2ClassB: r2("B"),
    r2StorageBytes: [...latest.values()].reduce((n, v) => n + v, 0),
  };
}

/** Hourly (minute 5): read, judge, keep the verdict in KV for /health and the brake in R2 for arw-media. */
export async function runBudgetCheck(env: BudgetEnv, now = Date.now(), fetcher: typeof fetch = fetch): Promise<BudgetStatus | null> {
  if (!env.CF_USAGE_TOKEN) return null;
  const period = periodOf(now);
  const status = judge(await readUsage(env.CF_USAGE_TOKEN, env.CF_ACCOUNT_ID || ACCOUNT, period.start, now, fetcher), now, period);
  await env.PUSH_KV.put(BUDGET_KEY, JSON.stringify(status));
  if (env.MEDIA) await env.MEDIA.put("status/budget.json", JSON.stringify({ at: now, brakeCpu: status.brakeCpu }), { httpMetadata: { contentType: "application/json" } });
  return status;
}

/** The /health problem for the verdict (none when nothing warns, or the verdict is over 3 hours old). */
export function budgetProblems(status: BudgetStatus | null, now: number): { key: string; code: string; title: string; detail: string }[] {
  if (!status || now - status.at > 3 * 3600_000 || !status.warn.length) return [];
  const lines = status.metrics.filter((m) => status.warn.includes(m.key)).map((m) => `${NAMES[m.key]}: ${m.pct}% مستخدم، ومتوقع ${m.projectedPct}% آخر الشهر`);
  return [{ key: "budget", code: "budget_high", title: "الاستهلاك قرب من حد خطة الـ٥ دولار" + (status.brakeCpu ? " — تصغير الصور الجديدة واقف" : ""), detail: lines.join(" · ") }];
}
