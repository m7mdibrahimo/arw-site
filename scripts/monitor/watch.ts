#!/usr/bin/env -S npx tsx
/**
 * المراقب التقني — **من غير أي ذكاء اصطناعي**.
 *
 * بيبحث عن الأعطال الحقيقية بس: صفحة واقعة، خبر واقف، نشر قديم، تشغيل فشل، اختبار فشل.
 * كل حكم بيتحسب بحساب صريح في checks.ts — فمستحيل «يهلوس» ويقول إنه عمل حاجة وهو ما عملهاش.
 *
 * الاستخدام:
 *   npx tsx scripts/monitor/watch.ts                 # مرة واحدة
 *   npx tsx scripts/monitor/watch.ts --with-tests    # + تشغيل الاختبارات والبناء
 *   npx tsx scripts/monitor/watch.ts --daemon        # يفضل شغّال (كل 5 دقايق)
 *   npx tsx scripts/monitor/watch.ts --fix           # + إصلاحات محلية آمنة (مش على الموقع الحي)
 *   npx tsx scripts/monitor/watch.ts --json          # مخرجات للماكينات
 *
 * كود الخروج: 1 لو فيه مشكلة واقعة — عشان GitHub يبعتلك إيميل من غير أي إعداد إضافي.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkPage, deployLag, failedWorkflows, onlyBookkeeping } from "../../worker/src/health";
import {
  ciFindings, commandFindings, deployFindings, feedFindings, hasDown, mergeFindings,
  pageFindings, repoFindings, summarize, workerFindings, worst,
  type Finding, type PageResult, type RepoState, type WorkerState,
} from "./checks";

const ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.join(ROOT, "reports/guard");
const STATUS_FILE = path.join(REPORT_DIR, "status.json");
const HEARTBEAT_FILE = path.join(REPORT_DIR, "heartbeat.json");
const LOG_FILE = path.join(REPORT_DIR, "monitor.log");

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valueOf = (f: string, d: number) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/monitor/config.json"), "utf-8")) as {
  site: { origin: string; pages: string[]; slowMs: number; local?: string };
  feed: { maxAgeHours: number };
  worker?: { stateUrl: string; maxIdleMin: number; apiWarnAt: number };
  deploy?: { maxLagMin: number };
  ci?: { windowHours: number };
  checks: { tests: string; build: string; timeoutMinutes: number };
};

/** أمر بيتنفّذ من غير ما يوقف المراقب لو فشل */
function run(cmd: string, argv: string[], timeoutMs = 600_000): { code: number; out: string } {
  try {
    const out = execFileSync(cmd, argv, { cwd: ROOT, encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e: any) {
    return { code: typeof e?.status === "number" ? e.status : 1, out: String(e?.stdout || "") + String(e?.stderr || e?.message || "") };
  }
}

const gh = (argv: string[]) => run("gh", argv, 60_000);

async function collect(): Promise<Finding[]> {
  const now = Date.now();
  const origin = CONFIG.site.origin.replace(/\/+$/, "");
  const bust = (u: string) => `${u}${u.includes("?") ? "&" : "?"}_w=${now}`;
  const found: Finding[] = [];

  // ── ١. الصفحات الحية ──
  const targets = [...CONFIG.site.pages];
  if (CONFIG.site.local) targets.push(CONFIG.site.local);
  const results: PageResult[] = [];
  for (const p of targets) {
    const full = p.startsWith("http") ? p : origin + p;
    const name = p.startsWith("http") ? "السيرفر المحلي" : p === "/" ? "الصفحة الرئيسية" : p === "/news/" ? "صفحة الأخبار" : p === "/sitemap.xml" ? "خريطة الموقع" : p === "/robots.txt" ? "robots.txt" : p === "/build.json" ? "نسخة البناء" : p;
    if (p.endsWith(".json") || p.endsWith(".xml") || p.endsWith(".txt")) {
      try {
        const r = await fetch(bust(full), { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "ARW-Watch/1.0", "Cache-Control": "no-cache" } });
        results.push({ name, path: p, ok: r.ok, status: r.status, ms: 0 });
      } catch {
        results.push({ name, path: p, ok: false, status: 0, ms: 0 });
      }
    } else {
      const r = await checkPage(bust(full));
      results.push({ name, path: p, ok: r.ok, status: r.status, ms: r.ms });
    }
  }
  found.push(...pageFindings(results, CONFIG.site.slowMs));

  // ── ٢. الأخبار: آخر خبر نزل امتى ──
  try {
    const feed = (await fetch(bust(`${origin}/watcher-recent-content.json`)).then((r) => (r.ok ? r.json() : []))) as any[];
    const newest = (Array.isArray(feed) ? feed : [])
      .map((it) => Date.parse(it?.published_at || it?.date || "") || 0)
      .sort((a, b) => b - a)[0] || 0;
    found.push(...feedFindings(newest, now, CONFIG.feed.maxAgeHours));
  } catch {
    found.push(...feedFindings(0, now, CONFIG.feed.maxAgeHours));
  }

  // ── ٣. بوت الأخبار نفسه: بينبض؟ متقفّل؟ استهلاكه قرب من الحد؟ ──
  // ده أهم فحص: لو البوت وقف، الأخبار بتقف من غير أي رسالة خطأ.
  try {
    const st = (await fetch(bust(`${origin}${CONFIG.worker?.stateUrl ?? "/watcher-state.json"}`)).then((r) => (r.ok ? r.json() : null))) as any;
    const state: WorkerState = {
      enabled: typeof st?.enabled === "boolean" ? st.enabled : null,
      lastChecked: Date.parse(st?.lastChecked || "") || 0,
      apiCallsToday: Number(st?.apiCallsToday) || 0,
    };
    found.push(...workerFindings(state, now, CONFIG.worker?.maxIdleMin ?? 20, CONFIG.worker?.apiWarnAt ?? 0));
  } catch {
    found.push(...workerFindings({ enabled: null, lastChecked: 0, apiCallsToday: 0 }, now, CONFIG.worker?.maxIdleMin ?? 20, 0));
  }

  // ── ٤. النشر: الموقع الحي متأخر عن main؟ ──
  try {
    const build = (await fetch(bust(`${origin}/build.json`)).then((r) => (r.ok ? r.json() : null))) as any;
    const headRaw = gh(["api", `repos/m7mdibrahimo/arw-site/commits/main`]);
    const head = headRaw.code === 0 ? JSON.parse(headRaw.out) : null;
    let lag = deployLag(Number(build?.commitTime), Date.parse(head?.commit?.committer?.date || ""));
    if (lag && build?.commit) {
      const cmp = gh(["api", `repos/m7mdibrahimo/arw-site/compare/${build.commit}...main`]);
      if (cmp.code === 0 && onlyBookkeeping(JSON.parse(cmp.out)?.files)) lag = 0; // bookkeeping بس = طبيعي
    }
    found.push(...deployFindings(lag, CONFIG.deploy?.maxLagMin ?? 40));
  } catch {
    /* تعذّر الفحص — مش عطل في الموقع */
  }

  // ── ٥. تشغيلات GitHub اللي فشلت ──
  try {
    const runsRaw = gh(["api", "repos/m7mdibrahimo/arw-site/actions/runs?per_page=40"]);
    if (runsRaw.code === 0) {
      const runs = JSON.parse(runsRaw.out);
      found.push(...ciFindings(failedWorkflows(runs.workflow_runs || []), now, CONFIG.ci?.windowHours ?? 6));
    }
  } catch {
    /* تعذّر الفحص */
  }

  // ── ٦. حالة الريبو المحلي ──
  try {
    const branch = run("git", ["branch", "--show-current"]).out.trim() || "?";
    const counts = run("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]).out.trim().split(/\s+/);
    const dirty = run("git", ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
    const state: RepoState = { branch, ahead: Number(counts[0]) || 0, behind: Number(counts[1]) || 0, dirty };
    found.push(...repoFindings(state));
  } catch {
    /* مش مشكلة */
  }

  return found;
}

async function collectCommands(): Promise<Finding[]> {
  const timeout = (CONFIG.checks.timeoutMinutes ?? 20) * 60_000;
  const out = [];
  for (const [name, cmd] of [["الاختبارات", CONFIG.checks.tests], ["البناء", CONFIG.checks.build]] as const) {
    const parts = cmd.split(" ");
    const r = run(parts[0], parts.slice(1), timeout);
    out.push({ name, code: r.code, tail: r.out });
  }
  return commandFindings(out);
}

/** إصلاحات محلية آمنة بس — مفيش أي حاجة بتلمس الموقع الحي */
function fix(prev: Finding[]): string[] {
  const actions: string[] = [];
  if (prev.some((f) => f.id === "repo:behind")) {
    const r = run("git", ["fetch", "--prune", "origin"], 120_000);
    actions.push(r.code === 0 ? "حدّثت مراجع GitHub (git fetch --prune)" : "فشل تحديث مراجع GitHub");
  }
  return actions;
}

async function cycle(): Promise<number> {
  const now = Date.now();
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const found = [...(await collect()), ...(has("--with-tests") ? await collectCommands() : [])];

  let prev: Finding[] = [];
  try {
    prev = (JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"))?.findings || []) as Finding[];
  } catch {
    /* أول مرة */
  }
  const { current, appeared, resolved } = mergeFindings(prev, found, now);

  if (has("--fix") && appeared.length) fix(prev);

  // تنبيه (اختياري تمامًا — مش متفعّل غير لو إنت حطيت المتغيّرات)
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.ARW_ALERT_CHAT_ID;
  const downs = appeared.filter((f) => f.level === "down");
  if (token && chat && downs.length) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `🛠️ المراقب التقني:\n${downs.map((f) => `• ${f.title} (${f.detail})`).join("\n")}` }),
    }).catch(() => null);
  }

  const report = {
    checkedAt: now,
    level: worst(current),
    summary: summarize(current),
    findings: current,
    appeared: appeared.map((f) => f.id),
    resolved: resolved.map((f) => f.id),
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(report, null, 2));
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({ at: now, pid: process.pid }));

  const line = `[${new Date(now).toISOString()}] ${report.summary}` + (appeared.length ? ` · جديد: ${appeared.map((f) => f.title).join(" | ")}` : "");
  fs.appendFileSync(LOG_FILE, line + "\n");

  if (has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n🛠️  المراقب التقني — ${new Date(now).toLocaleString("ar-EG")}`);
    console.log(`   ${report.summary}`);
    for (const f of current) console.log(`   ${f.level === "down" ? "🔴" : "🟡"} ${f.title} — ${f.detail}`);
    if (resolved.length) console.log(`   ✅ اتصلّح: ${resolved.map((f) => f.title).join(" | ")}`);
    if (!current.length) console.log("   ✅ كل حاجة تمام");
    console.log(`   التقرير: reports/guard/status.json\n`);
  }

  return hasDown(current) ? 1 : 0;
}

/** المراقب نفسه لازم يراقب: لو اللفة السابقة ماتت في النص، ده عطل. */
function checkOwnStall(intervalMs: number): Finding[] {
  try {
    const hb = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, "utf-8"));
    const gap = Date.now() - Number(hb.at || 0);
    if (gap > intervalMs * 3) {
      return [{
        id: "watchdog:stalled",
        level: "warn",
        title: `المراقب نفسه كان واقف ${Math.round(gap / 60_000)} دقيقة`,
        detail: "يمكن الماك كان نايم أو العملية اتقتلت — الفحص ده رجع شغّال",
      }];
    }
  } catch {
    /* أول مرة */
  }
  return [];
}

async function main() {
  const intervalSec = valueOf("--every", 300);
  if (!has("--daemon")) {
    process.exitCode = await cycle();
    return;
  }
  console.log(`المراقب شغّال دايمًا — كل ${intervalSec} ثانية. للإيقاف: Ctrl+C`);
  for (;;) {
    process.exitCode = await cycle();
    const stall = checkOwnStall(intervalSec * 1000);
    if (stall.length) console.log(`⚠️  ${stall[0].title}`);
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

main();
