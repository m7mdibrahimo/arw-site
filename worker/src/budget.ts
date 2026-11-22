// The 5-dollar ceiling (INCIDENTS #1477). Owner 2026-11-22: «خلي الموقع علي الخطة 5 دولار وخلاص بس ميستهلكش اكتر من كدا
// مهما يحصل». Cloudflare has no spending cap, so the site keeps its own: every hour this reads the account's usage since the
// billing period began (the 22nd of each month) and compares it with what Workers Paid (and R2's free tier) include.
//   • brake: near the CPU allowance, arw-media stops resizing pictures it hasn't stored yet (R2 status/budget.json)
//   • alert: /health raises «budget_high» (Telegram) when anything is near its allowance or on course to pass it
//   • Cloudflare build minutes are watched like the rest: the builds are on GitHub now (INCIDENTS #1476), so any rise
//     means a Workers Builds trigger came back
//   • hard stop (INCIDENTS #1478, owner: «مش عايزه يسحب ابدا اكتر من كدا مهما يحصل»): once anything reaches 90% of what the
//     plan includes, everything that costs stops until the next period begins on the 22nd — a zone firewall rule blocks
//     the pictures and videos before any Worker runs, the bot's workers.dev address (the site's comments, members, chat,
//     statistics) is switched off, and the bot's minute job does nothing but this check. The pages themselves stay up:
//     static files cost nothing. Checked every 15 minutes.

export interface BudgetEnv { PUSH_KV: KVNamespace; MEDIA?: R2Bucket; CF_USAGE_TOKEN?: string; CF_GUARD_TOKEN?: string; CF_ACCOUNT_ID?: string; TELEGRAM_BOT_TOKEN?: string; ADMIN_TELEGRAM_CHAT_ID?: string }

export const BUDGET_KEY = "budget:status";
export const HARD_KEY = "budget:hard";
const ACCOUNT = "c6e90e83557c9ac6cb996a9f6c21a016";
const ZONE = "3b71ea65441dd354d82e877d737835b3";
const BOT = "arw-site-bot";
/** The minutes of each hour the check runs (the bot's cron runs every minute). */
export const CHECK_MINUTES = [5, 20, 35, 50];
/** The share of an allowance that stops everything that costs. */
export const HARD_PCT = 90;

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
export interface BudgetStatus { at: number; start: number; end: number; metrics: MetricState[]; brakeCpu: boolean; hardStop: boolean; hard: Metric[]; warn: Metric[] }

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
  // build minutes can't be stopped by blocking visitors (they come from a build trigger), so they only alert
  const hard = metrics.filter((m) => m.key !== "buildMinutes" && m.pct >= HARD_PCT).map((m) => m.key);
  const hardStop = hard.length > 0;
  const brakeCpu = hardStop || cpu.pct >= 75 || (settled && cpu.projectedPct >= 95);
  return { at: now, start: period.start, end: period.end, metrics, brakeCpu, hardStop, hard, warn };
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

/** The zone firewall rule of the hard stop: pictures, resized pictures and videos (arw-media's routes) blocked at the edge,
 *  so arw-media isn't run at all. Kept in the zone's custom rules, enabled only during a hard stop. */
export const STOP_RULE = {
  ref: "arw-five-dollar-stop",
  description: "خطة الـ5 دولار: الصور والفيديو واقفين لحد بداية الشهر الجديد يوم 22 (INCIDENTS #1478)",
  expression: '(http.host in {"arab-wrestling.com" "www.arab-wrestling.com"} and (starts_with(http.request.uri.path, "/content/images/") or starts_with(http.request.uri.path, "/videos/") or starts_with(http.request.uri.path, "/img/")))',
  action: "block",
};
type Rule = { ref: string; description: string; expression: string; action: string };

async function cf(fetcher: typeof fetch, token: string, method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 404 && method === "GET") return null;
  if (!r.ok || j?.success === false) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j?.errors || j).slice(0, 300)}`);
  return j.result;
}

/** Puts the firewall rule in the state wanted (adds it the first time). Returns whether anything changed. */
export async function setStopRule(on: boolean, token: string, fetcher: typeof fetch = fetch, rule: Rule = STOP_RULE, zone = ZONE): Promise<boolean> {
  const base = `/zones/${zone}/rulesets`;
  const rs = await cf(fetcher, token, "GET", `${base}/phases/http_request_firewall_custom/entrypoint`);
  if (!rs) {
    if (!on) return false;
    await cf(fetcher, token, "PUT", `${base}/phases/http_request_firewall_custom/entrypoint`, { rules: [{ ...rule, enabled: true }] });
    return true;
  }
  const mine = (rs.rules || []).find((x: any) => x.ref === rule.ref);
  if (!mine) {
    if (!on) return false;
    await cf(fetcher, token, "POST", `${base}/${rs.id}/rules`, { ...rule, enabled: true });
    return true;
  }
  if (!!mine.enabled === on && mine.expression === rule.expression) return false;
  await cf(fetcher, token, "PATCH", `${base}/${rs.id}/rules/${mine.id}`, { ...rule, enabled: on });
  return true;
}

/** Switches the bot's workers.dev address (the site's only way to it) off or on. Returns whether anything changed. */
export async function setBotAddress(on: boolean, token: string, fetcher: typeof fetch = fetch, account = ACCOUNT, script = BOT): Promise<boolean> {
  const path = `/accounts/${account}/workers/scripts/${script}/subdomain`;
  const cur = await cf(fetcher, token, "GET", path);
  if (cur && !!cur.enabled === on) return false;
  await cf(fetcher, token, "POST", path, { enabled: on, previews_enabled: cur ? !!cur.previews_enabled : true });
  return true;
}

/** Applies the verdict: stops on the way up, and undoes only what it stopped itself (KV «budget:hard») on the way down. */
export async function applyHardStop(env: BudgetEnv, status: BudgetStatus, fetcher: typeof fetch = fetch): Promise<"stopped" | "released" | "holding" | "none"> {
  const token = env.CF_GUARD_TOKEN;
  const was = await env.PUSH_KV.get(HARD_KEY);
  if (status.hardStop) {
    if (!token) return "none";
    // re-asserted on every check, in case anything was switched back by hand or a call failed half way
    await setStopRule(true, token, fetcher);
    await setBotAddress(false, token, fetcher);
    if (!was) { await env.PUSH_KV.put(HARD_KEY, JSON.stringify({ at: status.at, hard: status.hard })); return "stopped"; }
    return "holding";
  }
  if (!was || !token) return "none";
  await setStopRule(false, token, fetcher);
  await setBotAddress(true, token, fetcher);
  await env.PUSH_KV.delete(HARD_KEY);
  return "released";
}

/** Whether the bot's minute job should skip everything but the check (read once a minute, so one KV read). */
export async function hardStopped(env: { PUSH_KV: KVNamespace }): Promise<boolean> {
  return !!(await env.PUSH_KV.get(HARD_KEY).catch(() => null));
}

/** Every 15 minutes: read, judge, keep the verdict in KV for /health and the brake in R2 for arw-media, apply the hard stop. */
export async function runBudgetCheck(env: BudgetEnv, now = Date.now(), fetcher: typeof fetch = fetch): Promise<BudgetStatus | null> {
  if (!env.CF_USAGE_TOKEN) return null;
  const period = periodOf(now);
  const status = judge(await readUsage(env.CF_USAGE_TOKEN, env.CF_ACCOUNT_ID || ACCOUNT, period.start, now, fetcher), now, period);
  await env.PUSH_KV.put(BUDGET_KEY, JSON.stringify(status));
  if (env.MEDIA) await env.MEDIA.put("status/budget.json", JSON.stringify({ at: now, brakeCpu: status.brakeCpu, hardStop: status.hardStop }), { httpMetadata: { contentType: "application/json" } });
  const done = await applyHardStop(env, status, fetcher);
  if (done === "stopped" || done === "released") {
    console.log(`[budget] hard stop ${done}: ${status.hard.join(", ") || "-"}`);
    // the minute job (and so /health) is quiet during a hard stop, so the owner is told here, once each way
    const text = done === "stopped"
      ? `⛔ ${budgetProblems(status, now)[0]?.title}\n${budgetProblems(status, now)[0]?.detail}\nمفيش أي فلوس زيادة هتتسحب. كل حاجة بترجع لوحدها يوم ٢٢.`
      : "✅ بدأ شهر جديد في خطة الـ٥ دولار — الصور والتعليقات والأعضاء والإشعارات رجعت تشتغل.";
    if (env.TELEGRAM_BOT_TOKEN && env.ADMIN_TELEGRAM_CHAT_ID) await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.ADMIN_TELEGRAM_CHAT_ID, text }),
    }).catch(() => {});
  }
  return status;
}

/** The /health problem for the verdict (none when nothing warns, or the verdict is over 3 hours old). */
export function budgetProblems(status: BudgetStatus | null, now: number): { key: string; code: string; title: string; detail: string }[] {
  if (!status || now - status.at > 3 * 3600_000 || (!status.warn.length && !status.hardStop)) return [];
  const keys = new Set([...(status.warn || []), ...(status.hard || [])]);
  const lines = status.metrics.filter((m) => keys.has(m.key)).map((m) => `${NAMES[m.key]}: ${m.pct}% مستخدم، ومتوقع ${m.projectedPct}% آخر الشهر`);
  const title = status.hardStop
    ? "وصلنا ٩٠٪ من حد خطة الـ٥ دولار — الصور والتعليقات والأعضاء والإشعارات واقفين لحد يوم ٢٢، والصفحات شغالة"
    : "الاستهلاك قرب من حد خطة الـ٥ دولار" + (status.brakeCpu ? " — تصغير الصور الجديدة واقف" : "");
  return [{ key: "budget", code: "budget_high", title, detail: lines.join(" · ") }];
}
