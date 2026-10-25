/**
 * المنطق الخالص للمراقب التقني — من غير أي ذكاء اصطناعي ومن غير أي شبكة.
 *
 * السبب (INCIDENTS #481): الموديل المجاني قال «عملت الملف» وهو ما ناداش أداة أصلاً.
 * أي حاجة بتتقرا ويتبلّغ عنها لازم تكون حساب صريح في الكود، مش كلام موديل.
 *
 * كل الدوال هنا **خالصة**: بتاخد بيانات وترجّع نتائج. مفيش fetch، مفيش ملفات، مفيش وقت.
 * ده اللي بيخلّي الاختبارات مضمونة، وبيخلّي السلوك متوقّع ١٠٠٪.
 */

export type Level = "ok" | "warn" | "down";

export interface Finding {
  /** مفتاح ثابت للمشكلة — عشان نقدر نقول «لسه موجودة من امتى» */
  id: string;
  level: Level;
  title: string;
  detail: string;
  /** امتى ظهرت أول مرة (بيملاه watch.ts) */
  since?: number;
}

export interface PageResult {
  name: string;
  path: string;
  ok: boolean;
  status: number;
  ms: number;
}

export interface CiFailure {
  name: string;
  at: number;
  url: string;
}

export interface RepoState {
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
}

export interface CommandResult {
  name: string;
  code: number;
  /** آخر سطور المخرجات — للتفاصيل بس */
  tail: string;
}

/**
 * حالة بوت الأخبار (الـworker) — من ملف watcher-state.json المكشوف علنًا.
 * ده نبض حقيقي: الـworker بيشتغل كل دقيقة وبيحدّث الملف ده.
 * (ملاحظة: الـworker مش موصول بالدومين — هو cron بس — فالحكم على نبضه من هنا،
 * مش من صفحة /health اللي مالهاش وجود. ده كان إنذار كاذب اتصحّح في أول لفة.)
 */
export interface WorkerState {
  enabled: boolean | null;
  /** وقت آخر فحص (مللي ثانية) */
  lastChecked: number;
  apiCallsToday: number;
}

const LEVEL_ORDER: Record<Level, number> = { ok: 0, warn: 1, down: 2 };

/** أعلى خطورة في القايمة */
export function worst(findings: Finding[]): Level {
  return findings.reduce<Level>((acc, f) => (LEVEL_ORDER[f.level] > LEVEL_ORDER[acc] ? f.level : acc), "ok");
}

/** هل فيه حاجة واقعة فعلاً؟ (ده اللي بيوقف الـ workflow عشان يوصلك إيميل) */
export function hasDown(findings: Finding[]): boolean {
  return findings.some((f) => f.level === "down");
}

/** الصفحات: مردّتش، ولا رجّعت كود غلط، ولا بطيئة. */
export function pageFindings(results: PageResult[], slowMs = 8000): Finding[] {
  const out: Finding[] = [];
  for (const r of results) {
    if (!r.ok) {
      out.push({
        id: `page:${r.path}`,
        level: "down",
        title: `${r.name} مش بتفتح`,
        detail: r.status ? `رد الموقع ${r.status}` : "الموقع مردّش خلال الوقت المسموح",
      });
    } else if (r.ms > slowMs) {
      out.push({
        id: `slow:${r.path}`,
        level: "warn",
        title: `${r.name} بطيئة جدًا`,
        detail: `فتحت في ${Math.round(r.ms / 1000)} ثانية`,
      });
    }
  }
  return out;
}

/** الأخبار: مفيش خبر جديد من مدة طويلة. */
export function feedFindings(newestAt: number, now: number, maxAgeHours: number): Finding[] {
  if (!newestAt) {
    return [{ id: "feed:missing", level: "down", title: "لستة الأخبار الأخيرة مش بتتقرا", detail: "watcher-recent-content.json فاضي أو مش موجود" }];
  }
  const ageMs = now - newestAt;
  const limit = maxAgeHours * 3600_000;
  if (ageMs > limit) {
    const hours = Math.floor(ageMs / 3600_000);
    return [{ id: "feed:stale", level: "down", title: `مفيش خبر جديد من ${hours} ساعة`, detail: `الحد المسموح ${maxAgeHours} ساعات` }];
  }
  return [];
}

/**
 * بوت الأخبار: متقفّل؟ ولا نبضه واقف؟ ولا استهلاكه قرب من الحد؟
 * ده أهم فحص في المنظومة كلها: لو البوت وقف، الأخبار بتقف من غير أي رسالة خطأ.
 */
export function workerFindings(s: WorkerState, now: number, maxIdleMin: number, apiWarnAt: number): Finding[] {
  const out: Finding[] = [];
  if (s.enabled === false) {
    out.push({
      id: "worker:disabled",
      level: "down",
      title: "بوت الأخبار متقفّل — الأخبار مش بتتجاب",
      detail: "المفتاح enabled=false في watcher-state.json (لو إنت قافله بنفسك، تجاهل البلاغ ده)",
    });
  }
  const idleMin = Math.floor((now - s.lastChecked) / 60_000);
  if (!s.lastChecked) {
    out.push({ id: "worker:nostate", level: "down", title: "حالة بوت الأخبار مش بتتقرا", detail: "watcher-state.json فاضي أو مش موجود" });
  } else if (idleMin > maxIdleMin) {
    out.push({
      id: "worker:stalled",
      level: "down",
      title: `بوت الأخبار واقف من ${idleMin} دقيقة`,
      detail: `آخر نبض قبل ${idleMin} دقيقة — المفروض ينبض كل دقيقة (الحد ${maxIdleMin})`,
    });
  }
  if (apiWarnAt > 0 && s.apiCallsToday >= apiWarnAt) {
    out.push({
      id: "worker:apicap",
      level: "warn",
      title: `بوت الأخبار استهلك ${s.apiCallsToday} طلب النهاردة`,
      detail: "قرب من الحد اليومي — لو وصل الحد، الأخبار هتتأخر لبكرة",
    });
  }
  return out;
}

/**
 * النشر: الموقع الحي واقف على نسخة قديمة من الكود.
 * الحساب نفسه اللي في worker/src/health.ts (deployLag) — بس معدّي هنا كرقم جاهز
 * عشان الدالة تفضل خالصة.
 */
export function deployFindings(lagMs: number, maxLagMin: number): Finding[] {
  if (lagMs > maxLagMin * 60_000) {
    return [{
      id: "deploy:stale",
      level: "down",
      title: "الموقع واقف على نسخة قديمة — بناء Cloudflare بيفشل أو متعطل",
      detail: `متأخر ${Math.round(lagMs / 60_000)} دقيقة عن آخر تعديل`,
    }];
  }
  return [];
}

/** تشغيلات GitHub اللي فشلت (آخر `windowHours` ساعة). */
export function ciFindings(failures: CiFailure[], now: number, windowHours: number): Finding[] {
  const from = now - windowHours * 3600_000;
  return failures
    .filter((f) => f.at >= from)
    .map((f) => ({
      id: `ci:${f.name}`,
      level: "warn" as Level,
      title: `تشغيل «${f.name}» فشل`,
      detail: f.url,
    }));
}

/** الريبو المحلي: ورا GitHub، ولا فيه تعديلات مش محفوظة كتير. */
export function repoFindings(s: RepoState, maxDirty = 40): Finding[] {
  const out: Finding[] = [];
  if (s.behind > 0) {
    out.push({
      id: "repo:behind",
      level: "warn",
      title: `النسخة المحلية متأخرة ${s.behind} كوميت عن GitHub`,
      detail: `الفرع ${s.branch}`,
    });
  }
  if (s.ahead > 0) {
    out.push({
      id: "repo:ahead",
      level: "warn",
      title: `عندك ${s.ahead} كوميت محلي مش مرفوع`,
      detail: `الفرع ${s.branch} — ممكن تكون شغل مهم لسه مش على GitHub`,
    });
  }
  if (s.dirty > maxDirty) {
    out.push({
      id: "repo:dirty",
      level: "warn",
      title: `عندك ${s.dirty} ملف متغيّر مش محفوظ`,
      detail: "الريبو مش نضيف — صعّب تشخيص أي عطل",
    });
  }
  return out;
}

/** أوامر الفحص (الاختبارات/البناء): نجحت ولا لأ. */
export function commandFindings(results: CommandResult[]): Finding[] {
  return results
    .filter((r) => r.code !== 0)
    .map((r) => ({
      id: `cmd:${r.name}`,
      level: "down" as Level,
      title: `${r.name} فشل`,
      detail: r.tail.split("\n").filter(Boolean).slice(-3).join(" · ") || `كود الخروج ${r.code}`,
    }));
}

/** ملخّص مقروء لسطر واحد */
export function summarize(findings: Finding[]): string {
  if (!findings.length) return "تمّت المراجعة — مفيش مشاكل";
  const down = findings.filter((f) => f.level === "down").length;
  const warn = findings.filter((f) => f.level === "warn").length;
  return `${down} مشكلة واقعة · ${warn} تحذير`;
}

/**
 * مقارنة بالمرة اللي فاتت: بنحافظ على «since» للمشاكل اللي لسه موجودة،
 * وبنعرف إيه الجديد وإيه اللي اتصلّح. (نفس فكرة mergeProblems في health.ts)
 */
export function mergeFindings(prev: Finding[], found: Finding[], now: number): { current: Finding[]; appeared: Finding[]; resolved: Finding[] } {
  const prevBy = new Map(prev.map((f) => [f.id, f]));
  const current = found.map((f) => ({ ...f, since: prevBy.get(f.id)?.since ?? now }));
  const ids = new Set(current.map((f) => f.id));
  return {
    current,
    appeared: current.filter((f) => !prevBy.has(f.id)),
    resolved: prev.filter((f) => !ids.has(f.id)),
  };
}
