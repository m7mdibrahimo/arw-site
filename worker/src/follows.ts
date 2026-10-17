// «المتابعة» (owner 2026-10-15): a member follows a program (WWE RAW, AEW Dynamite…) or a whole promotion (WWE,
// AEW…), from the show's page, the program's library page, the promotion's page or their account, and is told the
// moment a new full translated show of it is on the site: in the bell in the header (their inbox), and on their phone
// or computer if they allowed it (the same empty web push as the comments' answers, signed with the same key).
//
// Only full shows (content/shows): never recaps, news or nostalgia. The site lists its newest ones in
// /follow-feed.json; every minute the worker reads it, and each show not seen before goes to its followers' inboxes.
//
//   GET  /follow                 {follows, unread}                      (member)
//   POST /follow                 {kind: program|fed|libfed, key, label, on}  (member) follow or stop
// «libfed» is a federation of «مكتبة العروض» (/library/federation/<key>/: CMLL, AAA, UFC, Stardom…), owner 2026-10-18:
// «العضو المسجل في الموقع يقدر انه يعمل متابعة لكل الاتحاد ال في مكتبة العروض».
//   GET  /follow/inbox?before=   {items, unread}                        (member) newest first, 30 a page
//   POST /follow/read            {id} or {all: true}                    (member)
//   GET  /follow/push-key        the site's public key for web push
//   POST /follow/push            {endpoint} → {pk}                      (member) this device is told too
//   POST /follow/unpush          {endpoint}                             (member)
//   POST /follow/peek            {pk, since} → {items}                  the service worker, woken by a push
import { once } from "./once";
import { memberOf, type MembersEnv } from "./members";
import { vapidKeys, validEndpoint, pushOnce } from "./comment-push";

export interface FollowsEnv extends MembersEnv { SITE_ORIGIN?: string }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export const MAX_FOLLOWS = 100;
const KINDS = ["program", "fed", "libfed"] as const;
// a program by its library address (/library/<key>/), a promotion by its page (/federation/<key>/)
const PROGRAM_KEY = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,79}$/u;
const FED_KEY = /^[a-z0-9][a-z0-9-]{1,19}$/;
export const followKeyOk = (kind: string, key: string) => kind === "program" || kind === "libfed" ? PROGRAM_KEY.test(key) : kind === "fed" ? FED_KEY.test(key) : false;

export function ensureFollows(db: D1Database): Promise<void> {
  return once(db, "follows", () => db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS member_follows (member INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, PRIMARY KEY (member, kind, key))"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_follows_key ON member_follows (kind, key)"),
    db.prepare("CREATE TABLE IF NOT EXISTS member_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, title_en TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', program TEXT NOT NULL DEFAULT '', fed TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, pushed INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_inbox_member ON member_inbox (member, id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS member_inbox_once ON member_inbox (member, url)"),
    db.prepare("CREATE TABLE IF NOT EXISTS member_push (endpoint TEXT PRIMARY KEY, member INTEGER NOT NULL, pk TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_push_member ON member_push (member)"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_push_pk ON member_push (pk)"),
  ]));
}

const unreadOf = async (db: D1Database, member: number) =>
  Number((await db.prepare("SELECT COUNT(*) AS n FROM member_inbox WHERE member = ?1 AND read = 0").bind(member).first<{ n: number }>())?.n || 0);
const itemOut = (r: any) => ({ id: r.id, url: r.url, title: r.title, title_en: r.title_en, image: r.image, program: r.program, fed: r.fed, at: r.at, read: !!r.read });

export async function handleFollows(request: Request, env: FollowsEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "المتابعة غير متاحة الآن." }, 503);
  await ensureFollows(db);
  const path = url.pathname.replace(/^\/follow/, "") || "/";

  if (path === "/push-key" && request.method === "GET") return reply({ key: (await vapidKeys(env.PUSH_KV)).pub });

  // the service worker, woken by an empty push: what's new for this device (its own key, nothing else readable)
  if (path === "/peek" && request.method === "POST") {
    const b: any = await request.json().catch(() => ({}));
    const pk = String(b.pk || "");
    if (!/^[A-Za-z0-9_-]{32}$/.test(pk)) return reply({ items: [] });
    const dev = await db.prepare("SELECT member FROM member_push WHERE pk = ?1").bind(pk).first<{ member: number }>();
    if (!dev) return reply({ items: [], gone: true });
    const rows = (await db.prepare("SELECT * FROM member_inbox WHERE member = ?1 AND read = 0 AND at > ?2 ORDER BY id DESC LIMIT 3").bind(dev.member, Math.max(Number(b.since) || 0, now - 2 * 86_400_000)).all()).results || [];
    return reply({ items: rows.map(itemOut) });
  }

  const me = await memberOf(request, env, now);
  if (!me) return reply({ ok: false, error: "سجل دخولك أولا.", signedOut: true }, 401);
  const b: any = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (path === "/" && request.method === "GET") {
    const rows = (await db.prepare("SELECT kind, key, label, created FROM member_follows WHERE member = ?1 ORDER BY created DESC").bind(me.id).all()).results || [];
    return reply({ ok: true, follows: rows, unread: await unreadOf(db, me.id) });
  }
  if (path === "/" && request.method === "POST") {
    const kind = String(b.kind || ""), key = String(b.key || "").normalize("NFC").toLowerCase();
    if (!(KINDS as readonly string[]).includes(kind) || !followKeyOk(kind, key)) return reply({ ok: false, error: "تعذرت المتابعة." }, 400);
    if (b.on === false) {
      await db.prepare("DELETE FROM member_follows WHERE member = ?1 AND kind = ?2 AND key = ?3").bind(me.id, kind, key).run();
      return reply({ ok: true, on: false });
    }
    const n = Number((await db.prepare("SELECT COUNT(*) AS n FROM member_follows WHERE member = ?1").bind(me.id).first<{ n: number }>())?.n || 0);
    if (n >= MAX_FOLLOWS) return reply({ ok: false, error: `يمكنك متابعة ${MAX_FOLLOWS} برنامجا واتحادا على الأكثر.` }, 400);
    const label = String(b.label || "").replace(/\s+/g, " ").trim().slice(0, 60) || key;
    await db.prepare("INSERT INTO member_follows (member, kind, key, label, created) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (member, kind, key) DO UPDATE SET label = excluded.label").bind(me.id, kind, key, label, now).run();
    return reply({ ok: true, on: true });
  }
  if (path === "/inbox" && request.method === "GET") {
    const before = Number(url.searchParams.get("before")) || 0;
    const rows = (await db.prepare(`SELECT * FROM member_inbox WHERE member = ?1 ${before ? "AND id < ?2" : "AND ?2 = ?2"} ORDER BY id DESC LIMIT 30`).bind(me.id, before).all()).results || [];
    return reply({ ok: true, items: rows.map(itemOut), unread: await unreadOf(db, me.id), more: rows.length === 30 });
  }
  if (path === "/read" && request.method === "POST") {
    if (b.all) await db.prepare("UPDATE member_inbox SET read = 1, pushed = 1 WHERE member = ?1 AND read = 0").bind(me.id).run();
    else await db.prepare("UPDATE member_inbox SET read = 1, pushed = 1 WHERE member = ?1 AND id = ?2").bind(me.id, Number(b.id) || 0).run();
    return reply({ ok: true, unread: await unreadOf(db, me.id) });
  }
  if (path === "/push" && request.method === "POST") {
    const endpoint = validEndpoint(b.endpoint);
    if (!endpoint) return reply({ ok: false, error: "تعذر تفعيل الإشعارات على هذا الجهاز." }, 400);
    const pk = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[x % 64]).join("");
    await db.prepare("INSERT INTO member_push (endpoint, member, pk, created) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (endpoint) DO UPDATE SET member = excluded.member, pk = excluded.pk, created = excluded.created").bind(endpoint, me.id, pk, now).run();
    // a member's ten newest devices
    await db.prepare("DELETE FROM member_push WHERE member = ?1 AND endpoint NOT IN (SELECT endpoint FROM member_push WHERE member = ?1 ORDER BY created DESC LIMIT 10)").bind(me.id).run();
    return reply({ ok: true, pk });
  }
  if (path === "/unpush" && request.method === "POST") {
    await db.prepare("DELETE FROM member_push WHERE member = ?1 AND endpoint = ?2").bind(me.id, String(b.endpoint || "")).run();
    return reply({ ok: true });
  }
  return reply({ ok: false, error: "not found" }, 404);
}

// ── the minute's work: new shows to their followers, then their devices woken ─────────────────────────────────────
type FeedItem = { url: string; title: string; headline: string; program: string; program_name: string; fed: string; libfed?: string; image: string; date: string };
const SEEN_KV = "follow:seen";

/** Shows on the site that no one has been told about yet go to their followers' inboxes */
export async function runFollowNotify(env: FollowsEnv, now = Date.now(), f: typeof fetch = fetch): Promise<{ added: number; items: number }> {
  const db = env.ANALYTICS;
  if (!db || !env.SITE_ORIGIN) return { added: 0, items: 0 };
  await ensureFollows(db);
  let feed: FeedItem[] = [];
  try {
    const r = await f(`${env.SITE_ORIGIN}/follow-feed.json?_cb=${now}`, { headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) return { added: 0, items: 0 };
    feed = await r.json() as FeedItem[];
  } catch { return { added: 0, items: 0 }; }
  if (!Array.isArray(feed) || !feed.length) return { added: 0, items: 0 };
  const raw = await env.PUSH_KV.get(SEEN_KV);
  // the first time: what's already on the site is not news to anyone
  if (raw === null) { await env.PUSH_KV.put(SEEN_KV, JSON.stringify(feed.map(i => i.url).slice(0, 300))); return { added: 0, items: 0 }; }
  const seen: string[] = JSON.parse(raw || "[]");
  const fresh = feed.filter(i => i && typeof i.url === "string" && /^\/shows\//.test(i.url) && !seen.includes(i.url)
    && Date.parse(i.date) <= now + 60_000 && Date.parse(i.date) > now - 2 * 86_400_000).slice(0, 3);
  let added = 0;
  for (const it of fresh) {
    const fed = String(it.fed || "").toLowerCase(), program = String(it.program || "").normalize("NFC").toLowerCase();
    const libfed = String(it.libfed || "").normalize("NFC").toLowerCase();
    const followers = ((await db.prepare("SELECT DISTINCT member FROM member_follows WHERE (kind = 'program' AND key = ?1) OR (kind = 'fed' AND key = ?2) OR (kind = 'libfed' AND key = ?3 AND ?3 != '')").bind(program, fed, libfed).all<{ member: number }>()).results || []).map(r => r.member);
    const title = String(it.headline || it.title || "").slice(0, 200), titleEn = String(it.title || "").slice(0, 200);
    for (let i = 0; i < followers.length; i += 50) {
      await db.batch(followers.slice(i, i + 50).map(m => db.prepare("INSERT OR IGNORE INTO member_inbox (member, url, title, title_en, image, program, fed, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(m, it.url, title, titleEn, String(it.image || "").slice(0, 400), String(it.program_name || "").slice(0, 80), fed, now)));
    }
    added += followers.length;
    seen.unshift(it.url);
  }
  // shows that left the window are still remembered (a show moved in time is never told twice)
  for (const i of feed) if (!seen.includes(i.url) && Date.parse(i.date) <= now - 2 * 86_400_000) seen.push(i.url);
  if (fresh.length || seen.length !== JSON.parse(raw || "[]").length) await env.PUSH_KV.put(SEEN_KV, JSON.stringify(seen.slice(0, 300)));
  return { added, items: fresh.length };
}

/** The devices of members with something new are woken (30 members a minute; a device that's gone is forgotten) */
export async function runFollowPush(env: FollowsEnv, now = Date.now(), f: typeof fetch = fetch): Promise<number> {
  const db = env.ANALYTICS;
  if (!db) return 0;
  await ensureFollows(db);
  const members = ((await db.prepare("SELECT DISTINCT i.member FROM member_inbox i JOIN member_push p ON p.member = i.member WHERE i.pushed = 0 AND i.read = 0 AND i.at > ?1 LIMIT 30").bind(now - 6 * 3_600_000).all<{ member: number }>()).results || []).map(r => r.member);
  let sent = 0;
  for (const m of members) {
    const devices = ((await db.prepare("SELECT endpoint FROM member_push WHERE member = ?1").bind(m).all<{ endpoint: string }>()).results || []).map(r => r.endpoint);
    for (const e of devices) {
      try {
        const s = await pushOnce(env.PUSH_KV, e, f);
        if (s === 404 || s === 410) await db.prepare("DELETE FROM member_push WHERE endpoint = ?1").bind(e).run();
        else if (s >= 200 && s < 300) sent++;
      } catch { /* the next show tries again */ }
    }
    await db.prepare("UPDATE member_inbox SET pushed = 1 WHERE member = ?1 AND pushed = 0").bind(m).run();
  }
  return sent;
}
