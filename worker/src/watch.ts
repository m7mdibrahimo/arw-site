// «تابع المشاهدة» and «سجل المشاهدة» (owner 2026-10-15): what a signed-in member (free or premium) started watching —
// a show, a recap or a nostalgia episode — is kept with their account: the home page offers to go back to it, with
// about how much they watched (the players are other sites', so it's the time the page played, not the exact second),
// and a page lists everything they watched. A show watched to (almost) the end leaves «تابع المشاهدة», stays in the history.
//
//   GET  /watch?continue=1          {items}  what to go back to (12 at most, the last 30 days)
//   GET  /watch?before=<ms>         {items, more}  the history, newest first, 60 a page
//   POST /watch {op: "start", item}         a member started watching
//   POST /watch {op: "tick", url, secs}     they kept watching (secs since the last tick, 10 minutes at most)
//   POST /watch {op: "hide", url}           out of «تابع المشاهدة» (still in the history)
//   POST /watch {op: "remove", url}         out of the history
//   POST /watch {op: "clear"}               the whole history gone
import { memberOf, type MembersEnv } from "./members";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export const MAX_WATCH = 500;
const DAY = 86_400_000;
// the watch pages only, and the site's own pictures
const PATH = /^\/(?:en\/)?(?:shows|recaps|nostalgia)\/[^\s"'<>\\]{1,300}$/;
const IMAGE = /^(?:\/[^\s"'<>\\]{1,400}|https:\/\/[^\s"'<>\\]{1,400})$/;
/** «01:18:54», «1:18:54» or «78:54» → seconds (0 when unknown) */
export function durationSecs(d: unknown): number {
  const p = String(d || "").trim().split(":").map(Number);
  if (!p.length || p.some(n => !Number.isFinite(n) || n < 0)) return 0;
  const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
  return s > 0 && s < 12 * 3600 ? s : 0;
}
export function cleanWatch(x: any) {
  if (!x || typeof x !== "object") return null;
  const url = String(x.url || "").trim();
  if (!PATH.test(url)) return null;
  const image = String(x.image || "").trim();
  const kind = /^\/(?:en\/)?nostalgia\//.test(url) ? "nostalgia" : /^\/(?:en\/)?recaps\//.test(url) ? "recap" : "show";
  return {
    url, kind,
    title: String(x.title || "").replace(/\s+/g, " ").trim().slice(0, 200),
    image: IMAGE.test(image) ? image : "",
    fed: String(x.fed || "").replace(/[^\w .&-]/g, "").slice(0, 20),
    duration: durationSecs(x.duration),
  };
}

const ready = new WeakMap<D1Database, Promise<unknown>>();
function ensureWatch(db: D1Database) {
  let p = ready.get(db);
  if (!p) {
    p = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS member_watch (member INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'show', fed TEXT NOT NULL DEFAULT '', duration INTEGER NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0, first INTEGER NOT NULL, last INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (member, url))"),
      db.prepare("CREATE INDEX IF NOT EXISTS member_watch_last ON member_watch (member, last)"),
    ]).catch((e) => { ready.delete(db); throw e; });
    ready.set(db, p);
  }
  return p;
}
const out = (r: any) => ({ url: r.url, title: r.title, image: r.image, kind: r.kind, fed: r.fed, duration: r.duration, watched: r.watched, first: r.first, last: r.last, views: r.views, done: r.duration > 0 && r.watched >= r.duration * 0.9 });

export async function handleWatch(request: Request, env: MembersEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "سجل المشاهدة غير متاح الآن." }, 503);
  if (url.pathname !== "/watch") return reply({ ok: false, error: "not found" }, 404);
  const me = await memberOf(request, env, now);
  if (!me) return reply({ ok: false, error: "سجل دخولك أولا.", signedOut: true }, 401);
  await ensureWatch(db);

  if (request.method === "GET") {
    if (url.searchParams.get("continue")) {
      const rows = (await db.prepare("SELECT * FROM member_watch WHERE member = ?1 AND hidden = 0 AND last > ?2 AND (duration = 0 OR watched < duration * 0.9) ORDER BY last DESC LIMIT 12").bind(me.id, now - 30 * DAY).all()).results || [];
      return reply({ ok: true, items: rows.map(out) });
    }
    const before = Number(url.searchParams.get("before")) || now + 1;
    const rows = (await db.prepare("SELECT * FROM member_watch WHERE member = ?1 AND last < ?2 ORDER BY last DESC LIMIT 60").bind(me.id, before).all()).results || [];
    const total = Number((await db.prepare("SELECT COUNT(*) AS n FROM member_watch WHERE member = ?1").bind(me.id).first<{ n: number }>())?.n || 0);
    return reply({ ok: true, items: rows.map(out), more: rows.length === 60, total });
  }
  if (request.method !== "POST") return reply({ ok: false, error: "not allowed" }, 405);
  const b: any = await request.json().catch(() => ({}));
  const target = String(b.url || "");

  if (b.op === "start") {
    const x = cleanWatch(b.item);
    if (!x) return reply({ ok: false, error: "تعذر الحفظ." }, 400);
    // a visit counts again after half an hour; opening it again brings it back to «تابع المشاهدة»
    await db.prepare(`INSERT INTO member_watch (member, url, title, image, kind, fed, duration, watched, first, last, views, hidden) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8, 1, 0)
      ON CONFLICT (member, url) DO UPDATE SET title = excluded.title, image = excluded.image, kind = excluded.kind, fed = excluded.fed,
        duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE member_watch.duration END,
        views = member_watch.views + CASE WHEN member_watch.last < ?8 - 1800000 THEN 1 ELSE 0 END,
        watched = CASE WHEN member_watch.duration > 0 AND member_watch.watched >= member_watch.duration * 0.9 THEN 0 ELSE member_watch.watched END,
        last = ?8, hidden = 0`).bind(me.id, x.url, x.title, x.image, x.kind, x.fed, x.duration, now).run();
    await db.prepare("DELETE FROM member_watch WHERE member = ?1 AND url NOT IN (SELECT url FROM member_watch WHERE member = ?1 ORDER BY last DESC LIMIT ?2)").bind(me.id, MAX_WATCH).run();
    return reply({ ok: true });
  }
  if (b.op === "tick") {
    const secs = Math.min(Math.max(Math.round(Number(b.secs) || 0), 0), 600);
    if (!secs) return reply({ ok: true });
    await db.prepare("UPDATE member_watch SET watched = CASE WHEN duration > 0 THEN MIN(duration, watched + ?3) ELSE watched + ?3 END, last = ?4 WHERE member = ?1 AND url = ?2").bind(me.id, target, secs, now).run();
    return reply({ ok: true });
  }
  if (b.op === "hide") { await db.prepare("UPDATE member_watch SET hidden = 1 WHERE member = ?1 AND url = ?2").bind(me.id, target).run(); return reply({ ok: true }); }
  if (b.op === "remove") { await db.prepare("DELETE FROM member_watch WHERE member = ?1 AND url = ?2").bind(me.id, target).run(); return reply({ ok: true }); }
  if (b.op === "clear") { await db.prepare("DELETE FROM member_watch WHERE member = ?1").bind(me.id).run(); return reply({ ok: true }); }
  return reply({ ok: false, error: "not found" }, 404);
}
