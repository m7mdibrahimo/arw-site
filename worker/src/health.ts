// The site's own watchdog (INCIDENTS #158). The owner wants everything checked every minute,
// around the clock, forever. An AI round takes minutes and uses the plan's allowance, so the
// minute-by-minute part lives here, in the Worker that already wakes every minute, at no cost:
// it notices; the AI rounds (every half hour) and the owner read what it found and fix the cause.
//
// Every minute: the home page, the news list, the newest story and the sitemap answer 200 with
// a real page. Every five minutes: GitHub runs that failed, how long since the last story, and
// stories that went up on the site but not on every platform. Findings live in KV
// («site_health»), show in the panel's bell, are served (titles only) at /health, and a new
// problem sends the owner one Telegram message when ADMIN_TELEGRAM_CHAT_ID is set.

export interface HealthProblem { key: string; code: string; title: string; detail: string; since: number }
export interface HealthState { checkedAt: number; problems: HealthProblem[]; pages?: Record<string, { status: number; ms: number }>; told?: string[] }

interface HealthEnv {
  SITE_ORIGIN: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_CHAT_ID?: string;
  PUSH_KV?: KVNamespace;
}

export const HEALTH_KEY = "site_health";

/** A page counts as up when it answers 200 with an HTML document of real size, within 15 seconds. */
export async function checkPage(url: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: number; ms: number }> {
  const t = Date.now();
  try {
    const r = await fetcher(url, { headers: { "Cache-Control": "no-cache", "User-Agent": "ARW-Health/1.0" }, signal: AbortSignal.timeout(15_000) });
    const body = r.ok ? await r.text() : "";
    return { ok: r.ok && /<html/i.test(body) && body.length > 1000, status: r.status, ms: Date.now() - t };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t };
  }
}

/** Workflows whose latest finished run failed (one line per workflow). */
export function failedWorkflows(runs: any[]): { name: string; at: number; url: string }[] {
  const latest = new Map<string, any>();
  for (const r of runs) if (r?.status === "completed" && !latest.has(r.name)) latest.set(r.name, r);
  return [...latest.values()].filter(r => r.conclusion === "failure" || r.conclusion === "timed_out")
    .map(r => ({ name: String(r.name), at: Date.parse(r.updated_at || r.created_at) || 0, url: String(r.html_url || "") }));
}

const PLATFORMS = ["telegram", "facebook", "instagram"] as const;
const PLATFORM_AR: Record<string, string> = { telegram: "تيليجرام", facebook: "فيسبوك", instagram: "إنستغرام" };

/**
 * Stories that some platform still lacks an hour after they could go out, not held. «Could go out»
 * is the later of publishing and the release from a hold: seven NXT stories the owner released
 * together were called stuck on Instagram eight minutes later (INCIDENTS #158).
 */
export function stuckOnSocial(items: any[], state: any, keyOf: (it: any) => string, now = Date.now(), igAllows: (priority: unknown) => boolean = () => true): { title: string; missing: string[] }[] {
  const waiting: { title: string; missing: string[]; from: number }[] = [];
  for (const it of items) {
    const pub = Date.parse(it?.published_at || it?.date || "") || 0;
    if (!pub || (it.kind || "news") !== "news") continue;
    const key = keyOf(it);
    const h = state?.held?.[key];
    if (h && !h.releasedAt) continue;
    const from = Math.max(pub, Number(h?.releasedAt) || 0);
    if (now - from > 12 * 3600_000) continue;
    const missing = PLATFORMS.filter(p => !Number(state?.[p]?.[key]));
    // Today's Instagram posts are rationed by importance (#162): a story its priority keeps off
    // Instagram isn't waiting for it.
    // The worker tries Instagram for 3 hours after a story could go out (12 for a show); past that
    // it is never coming, by design, and not «stuck» (INCIDENTS #190).
    const igWindow = (it.kind === "show" ? 12 : 3) * 3600_000;
    const due = missing.filter(p => p !== "instagram" || (igAllows(it.social_priority) && now - from < igWindow));
    if (due.length) waiting.push({ title: String(it.title || "").slice(0, 120), missing: due, from });
  }
  // Instagram takes a limited number of posts a day, so the site sends it the newest stories first
  // and older ones may never go — by design. Missing Instagram is a fault only when Instagram has
  // posted nothing for an hour while stories wait (the 16:30 bell was full of rationed stories).
  const lastIg = Math.max(0, ...Object.values(state?.instagram || {}).map(Number).filter(Number.isFinite));
  const igStalled = now - lastIg > 60 * 60_000;
  return waiting
    .map(w => ({ ...w, missing: w.missing.filter(p => p !== "instagram" || igStalled) }))
    .filter(w => w.missing.length && now - w.from >= 60 * 60_000)
    .map(w => ({ title: w.title, missing: w.missing.map(p => PLATFORM_AR[p]) }));
}

/** Merge this check's findings into the running list: keep «since» for problems still open. */
export function mergeProblems(prev: HealthProblem[], found: Omit<HealthProblem, "since">[], codes: string[], now = Date.now()): HealthProblem[] {
  const kept = prev.filter(p => !codes.includes(p.code)); // problems this check doesn't own stay as they were
  const since = new Map(prev.map(p => [p.key, p.since]));
  return [...kept, ...found.map(p => ({ ...p, since: since.get(p.key) || now }))];
}

async function readHealth(env: HealthEnv): Promise<HealthState> {
  try { return JSON.parse((await env.PUSH_KV!.get(HEALTH_KEY)) || "") as HealthState; } catch { return { checkedAt: 0, problems: [] }; }
}

export async function runSiteHealthCheck(env: HealthEnv, minute: number, keyOf: (it: any) => string, readState: () => Promise<any>, igRule: () => Promise<(priority: unknown) => boolean> = async () => () => true): Promise<void> {
  if (!env.PUSH_KV) return;
  try {
    const now = Date.now();
    const prev = await readHealth(env);
    let problems = prev.problems || [];
    const origin = env.SITE_ORIGIN.replace(/\/+$/, "");
    const bust = (u: string) => `${u}${u.includes("?") ? "&" : "?"}_h=${now}`;

    // ── every minute: the pages people open ──
    const feed: any[] = await fetch(bust(`${origin}/watcher-recent-content.json`)).then(r => (r.ok ? r.json() : [])).catch(() => []) as any[];
    const newest = (Array.isArray(feed) ? feed : []).filter(it => it?.url).sort((a, b) => (Date.parse(b.published_at || b.date) || 0) - (Date.parse(a.published_at || a.date) || 0))[0];
    const pages: [string, string][] = [["الصفحة الرئيسية", "/"], ["صفحة الأخبار", "/news/"], ["خريطة الموقع", "/sitemap.xml"]];
    if (newest) pages.push(["آخر خبر", String(newest.url)]);
    const results = await Promise.all(pages.map(async ([name, p]) => {
      const res = p.endsWith(".xml")
        ? await fetch(bust(origin + encodeURI(decodeURI(p)))).then(r => ({ ok: r.ok, status: r.status, ms: 0 })).catch(() => ({ ok: false, status: 0, ms: 0 }))
        : await checkPage(bust(origin + encodeURI(decodeURI(p))));
      return { name, p, ...res };
    }));
    const pageInfo: Record<string, { status: number; ms: number }> = {};
    for (const r of results) pageInfo[r.p] = { status: r.status, ms: r.ms };
    const down = results.filter(r => !r.ok).map(r => ({ key: `page:${r.p}`, code: "page_down", title: `${r.name} مش بتفتح`, detail: r.status ? `رد الموقع ${r.status}` : "الموقع مردّش خلال ١٥ ثانية" }));
    const slow = results.filter(r => r.ok && r.ms > 8000).map(r => ({ key: `slow:${r.p}`, code: "page_slow", title: `${r.name} بطيئة جدًا`, detail: `فتحت في ${Math.round(r.ms / 1000)} ثانية` }));
    problems = mergeProblems(problems, [...down, ...slow], ["page_down", "page_slow"], now);
    if (!Array.isArray(feed) || !feed.length) problems = mergeProblems(problems, [{ key: "feed", code: "feed_missing", title: "لستة الأخبار الأخيرة مش بتتقرا", detail: "watcher-recent-content.json" }], ["feed_missing"], now);
    else problems = mergeProblems(problems, [], ["feed_missing"], now);

    // ── every five minutes: bots, freshness, platforms ──
    if (minute % 5 === 0) {
      const runs = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs?per_page=40`, {
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "arw-site-bot" },
      }).then(r => (r.ok ? r.json() : null)).catch(() => null) as any;
      if (runs?.workflow_runs) {
        const failed = failedWorkflows(runs.workflow_runs).map(f => ({ key: `ci:${f.name}`, code: "ci_failed", title: `تشغيل «${f.name}» فشل`, detail: f.url }));
        problems = mergeProblems(problems, failed, ["ci_failed"], now);
      }
      const lastAt = newest ? Date.parse(newest.published_at || newest.date) || 0 : 0;
      const quiet = lastAt && now - lastAt > 6 * 3600_000;
      problems = mergeProblems(problems, quiet ? [{ key: "stale", code: "news_stale", title: "مفيش خبر جديد نزل من أكتر من ٦ ساعات", detail: `آخر خبر: ${String(newest?.title || "").slice(0, 100)}` }] : [], ["news_stale"], now);
      const state = await readState().catch(() => null);
      if (state) {
        const igAllows = await igRule().catch(() => () => true);
        const stuck = stuckOnSocial(Array.isArray(feed) ? feed : [], state, keyOf, now, igAllows)
          .map(s => ({ key: `social:${s.title}`, code: "social_stuck", title: `«${s.title}» منزلش على ${s.missing.join(" و")}`, detail: "عدّى عليه أكتر من ساعة على الموقع ومش محجوز" }));
        problems = mergeProblems(problems, stuck, ["social_stuck"], now);
      }
    }

    // One Telegram message per problem (not one a minute), when the owner's chat is set. A page
    // that fails once is often a blip: it is told only after failing for two minutes.
    const told = (prev.told || []).filter(k => problems.some(p => p.key === k));
    const tell = problems.filter(p => !told.includes(p.key) && (!p.code.startsWith("page_") || now - p.since >= 90_000));
    if (tell.length && env.ADMIN_TELEGRAM_CHAT_ID) {
      const text = `🩺 حارس الموقع:\n${tell.map(p => `• ${p.title}${p.detail && !p.detail.startsWith("http") ? ` (${p.detail})` : ""}`).join("\n")}`;
      const sent = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.ADMIN_TELEGRAM_CHAT_ID, text }),
      }).then(r => r.ok).catch(() => false);
      if (sent) told.push(...tell.map(p => p.key));
    }
    const next: HealthState = { checkedAt: now, problems, pages: pageInfo, told };
    // KV allows a limited number of writes a day: write when something changed, else every 10 minutes.
    const sig = (h: HealthState) => JSON.stringify([(h.problems || []).map(p => p.key).sort(), (h.told || []).slice().sort()]);
    if (sig(next) !== sig(prev) || minute % 10 === 0) await env.PUSH_KV.put(HEALTH_KEY, JSON.stringify(next));
  } catch {
    // A broken watchdog must never break the minute tick.
  }
}

/** What /health and the panel show: open problems, oldest first. */
export async function siteHealth(env: HealthEnv): Promise<HealthState> {
  if (!env.PUSH_KV) return { checkedAt: 0, problems: [] };
  const h = await readHealth(env);
  return { checkedAt: h.checkedAt || 0, problems: (h.problems || []).slice().sort((a, b) => a.since - b.since), pages: h.pages };
}
