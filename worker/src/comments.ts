// Visitors' comments under shows, recaps and stories (owner 2026-10-14: «امكانية المتابعين التعليق علي الموضوع … صندوقين
// اتنين فقط واحد للاسم وال تحته للرسالة»; published right away: «عايزها تتنشر علطول»). Kept in the site's D1 database
// («arw-analytics», table «comments», made here on first use: no migration to run by hand). The owner reads and deletes
// them in the panel (#/comments), and each new one reaches the panel's bell.
//
//   GET  /comments?p=/news/x/        a page's comments, newest first
//   POST /comments                   {p, title, name, text, pic, website, t} → published at once
//   GET  /comments/pic/<id>.webp     a visitor's own picture (R2 «arw-media», comments/<id>.webp)
//   GET  /api/studio/comments        the panel: every comment, with the day's, week's and total counts
//   POST /api/studio/comments/delete {ids}           (a comment's replies go with it)
//   POST /api/studio/comments/reply  {id, text}      the site's own answer, as «عرب راسلنج» with the blue badge
//   POST /comments/inbox             {k, since}      the answers to this visitor's comments (worker/src/comment-push.ts)
//   GET  /comments/push-key, POST /comments/push      a push to the visitor's phone when someone answers them
//
// Visitors answer each other too (owner 2026-10-14): a reply has parent = the comment it's under (the thread) and
// reply_to = the comment or reply it answers; whoever wrote that one is told (on the site, and by a push if they asked).
//
// The site's own account (owner 2026-10-14: «عضوية ارد بيها علي المتابعيين بصورة الموقع وفي علامة توثيق»): a reply
// written in the panel is kept with official = 1 and parent = the comment it answers; the page shows it under that
// comment with the site's logo, the name («عرب راسلنج», «Arab Wrestling» on the English pages) and the verified badge.
// No visitor can take that name.
//
// Published at once, so the guards are here: only from the site's own pages, never from a bot or a form filled in
// under 2 seconds (or with the hidden field filled), no links, no 5th comment in 10 minutes or 31st in a day from the
// same visitor, no same comment twice on a page, a picture only from the site's list or a small square image.
import { BOT_UA, cairo, fromSite, pagePath } from "./analytics";
import { notifyOwner, ownerOf, savePush, validEndpoint, vapidKeys } from "./comment-push";
import { ensureMembers, memberOf } from "./members";

export interface CommentsEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; MEDIA?: R2Bucket;
  /** "1": visitors may comment too. Comments are the members' only (owner 2026-10-14: «التعليق … لازم يكون مسجل في الموقع فقط») */
  COMMENTS_OPEN?: string }

export const PIC_ORIGIN = "https://arw-site-bot.m7mdibrahimpc.workers.dev";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });

const ready = new WeakMap<D1Database, Promise<unknown>>();
/** The table, made once per worker instance (CREATE … IF NOT EXISTS: nothing happens when it is there) */
export function ensureTable(db: D1Database): Promise<unknown> {
  let p = ready.get(db);
  if (!p) ready.set(db, p = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, text TEXT NOT NULL, pic TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, day TEXT NOT NULL, vhash TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE INDEX IF NOT EXISTS comments_path ON comments (path, deleted, at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS comments_at ON comments (deleted, at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS comments_who ON comments (vhash, at)"),
  ]).then(async () => {
    // the site's replies (added after the table was first made): an existing column makes ALTER fail, which is fine
    for (const col of ["parent INTEGER NOT NULL DEFAULT 0", "official INTEGER NOT NULL DEFAULT 0", "hearted INTEGER NOT NULL DEFAULT 0", "ip TEXT NOT NULL DEFAULT ''", "reply_to INTEGER NOT NULL DEFAULT 0", "owner TEXT NOT NULL DEFAULT ''", "hearted_at INTEGER NOT NULL DEFAULT 0", "member INTEGER NOT NULL DEFAULT 0"]) {
      await db.prepare(`ALTER TABLE comments ADD COLUMN ${col}`).run().catch(() => null);
    }
    // the answers to a visitor's comments, found fast
    await db.prepare("CREATE INDEX IF NOT EXISTS comments_owner ON comments (owner)").run().catch(() => null);
    await db.prepare("CREATE INDEX IF NOT EXISTS comments_reply ON comments (reply_to, at)").run().catch(() => null);
  }).catch((e) => { ready.delete(db); throw e; }));
  return p;
}

/** The pages comments are under: a show, recap, nostalgia episode or story, Arabic or English */
export function commentPath(raw: unknown): string | null {
  const p = pagePath(raw);
  return p && /^\/(?:en\/)?(?:news|shows|recaps|nostalgia)\/[^/]+\/$/.test(p) ? p : null;
}

/** A name or a comment as it is kept: no control or invisible characters, spaces tidied, lines kept in a comment */
export function cleanText(raw: unknown, max: number, lines = false): string {
  let s = String(raw ?? "").normalize("NFC")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/\r\n?/g, "\n");
  s = lines ? s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}
/** The site's own name, in either language and its usual spellings: a visitor can't comment under it */
export const OFFICIAL_NAME = "عرب راسلنج";
export function isReservedName(name: string): boolean {
  const k = String(name).toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^a-z\u0621-\u064A]/g, "");
  return /عربر[ايو]*س[ل]+[ي]*ن[جغك]|arabwrest|arabwrasl/.test(k);
}
export const HAS_LINK = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|ru|me|tv|link|site|online|shop|info|biz)\b|t\.me\/|wa\.me\/)/i;

/** The picture as kept: «w:<slug>» (a wrestler's from /assets/avatars/), or nothing; an upload is stored apart */
export const WRESTLER_PIC = /^w:[a-z0-9-]{2,40}$/;
const UPLOAD = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

async function visitor(env: CommentsEnv, request: Request, day: string): Promise<string> {
  let s = await env.PUSH_KV.get("analytics:salt");
  if (!s) { s = crypto.randomUUID(); await env.PUSH_KV.put("analytics:salt", s); }
  const data = new TextEncoder().encode(`${s}|comments|${request.headers.get("CF-Connecting-IP") || ""}|${request.headers.get("User-Agent") || ""}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h.slice(0, 10), b => b.toString(16).padStart(2, "0")).join("");
}

type Row = { id: number; path: string; title: string; name: string; text: string; pic: string; at: number; parent: number; official: number; hearted?: number; ip?: string; country?: string; reply_to?: number; owner?: string; mname?: string; mbadge?: number; mprem?: number };
const out = (r: Row) => ({ id: r.id, name: r.name, text: r.text, pic: r.pic, at: r.at, parent: r.parent || 0, official: !!r.official, hearted: !!r.hearted, reply_to: r.reply_to || 0, member: r.mname || "", blue: !!r.mname && !r.official && (r.mbadge !== 0 || Number(r.mprem) > Date.now()), gold: !!r.mname && !r.official && r.mbadge === 2, prem: !!r.mname && !r.official && Number(r.mprem) > Date.now() });

/** /comments and /comments/pic/<id>.webp */
export async function handleComments(request: Request, env: CommentsEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const pic = url.pathname.match(/^\/comments\/pic\/(\d+)\.webp$/);
  if (pic) {
    const obj = env.MEDIA ? await env.MEDIA.get(`comments/${pic[1]}.webp`) : null;
    if (!obj) return new Response("not found", { status: 404, headers: CORS });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/webp", "Cache-Control": "public, max-age=31536000, immutable", ...CORS } });
  }
  // the push: the site's public key, and a browser's address for a visitor
  if (url.pathname === "/comments/push-key" && request.method === "GET") {
    return reply({ key: (await vapidKeys(env.PUSH_KV)).pub }, 200, { "Cache-Control": "public, max-age=3600" });
  }
  // the site's own account, signed in on the site, does on the page what the panel does: a heart, or the comment gone
  // (owner 2026-10-14: «ليا الصلاحية اني اعمل اي حاجة بعضويتي سواء في الموقع او في اللوحة»)
  if (url.pathname === "/comments/mod" && request.method === "POST") {
    const m: any = await memberOf(request, env as any, now);
    if (!m?.official) return reply({ ok: false, error: "هذا لحساب الموقع الرسمي فقط." }, 403);
    const b: any = await request.json().catch(() => ({}));
    if (b.op === "delete") return reply({ ok: (await studioDeleteComments(env, [b.id])) > 0 });
    if (b.op === "heart" || b.op === "unheart") { const r: any = await studioHeartComment(env, b.id, b.op === "heart", now); return reply({ ok: !!r.success, error: r.error }); }
    return reply({ ok: false, error: "not found" }, 404);
  }
  if (url.pathname === "/comments/push" && request.method === "POST") {
    const b: any = await request.json().catch(() => ({}));
    const owner = await ownerOf(b.k), endpoint = validEndpoint(b.endpoint);
    if (!owner || !endpoint) return reply({ ok: false }, 400);
    await savePush(env.PUSH_KV, owner, endpoint);
    return reply({ ok: true });
  }
  if (!["/comments", "/comments/inbox"].includes(url.pathname)) return reply({ ok: false, error: "not found" }, 404);
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "التعليقات غير متاحة الآن." }, 503);
  await ensureTable(db);

  // the answers to a visitor's comments since they last looked (theirs to them aside)
  if (url.pathname === "/comments/inbox") {
    if (request.method !== "POST") return reply({ ok: false, error: "not allowed" }, 405);
    const b: any = await request.json().catch(() => ({}));
    const owner = await ownerOf(b.k);
    if (!owner) return reply({ items: [] });
    const since = Math.max(Number(b.since) || 0, now - 30 * 86_400_000);
    const [rows, hearts] = await db.batch([
      db.prepare(`SELECT r.id, r.name, r.text, r.pic, r.at, r.path, r.title, r.official, r.parent, c.text AS mine
        FROM comments r JOIN comments c ON r.reply_to = c.id
        WHERE c.owner = ?1 AND c.deleted = 0 AND r.deleted = 0 AND r.owner != ?1 AND r.at > ?2 ORDER BY r.at DESC LIMIT 20`).bind(owner, since),
      // the site's heart on one of theirs (owner 2026-10-14: «لو انا عملت هارت علي تعليق يجيلو اشعار»)
      db.prepare("SELECT id, text, path, title, hearted_at FROM comments WHERE owner = ?1 AND deleted = 0 AND hearted = 1 AND hearted_at > ?2 ORDER BY hearted_at DESC LIMIT 10").bind(owner, since),
    ]) as any[];
    const items = [
      ...(rows.results || []).map((r: any) => ({
        kind: "reply", id: r.id, name: r.official ? OFFICIAL_NAME : r.name, official: !!r.official, pic: r.official ? "" : r.pic, at: r.at,
        text: String(r.text).slice(0, 160), mine: String(r.mine || "").slice(0, 80), title: r.title, url: `${r.path}#c-${r.id}`,
      })),
      ...(hearts.results || []).map((c: any) => ({
        kind: "heart", id: c.id, name: OFFICIAL_NAME, official: true, pic: "", at: c.hearted_at,
        text: String(c.text).slice(0, 160), mine: String(c.text).slice(0, 80), title: c.title, url: `${c.path}#c-${c.id}`,
      })),
    ].sort((a, b) => b.at - a.at);
    return reply({ items }, 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "GET") {
    const path = commentPath(url.searchParams.get("p"));
    if (!path) return reply({ items: [] });
    // a member's comment: their username too, for the «عضو» badge and the link to their page
    await ensureMembers(db);
    const rows = await db.prepare(`SELECT c.id, c.name, c.text, c.pic, c.at, c.parent, c.official, c.hearted, c.reply_to, m.username AS mname, m.badge AS mbadge, m.premium_until AS mprem
      FROM comments c LEFT JOIN members m ON m.id = c.member AND c.member > 0 WHERE c.path = ?1 AND c.deleted = 0 ORDER BY c.at DESC LIMIT 400`).bind(path).all<Row>();
    return reply({ items: (rows.results || []).map(out) }, 200, { "Cache-Control": "no-store" });
  }
  if (request.method !== "POST") return reply({ ok: false, error: "not allowed" }, 405);

  // ── a new comment ──
  const ua = request.headers.get("User-Agent") || "";
  if (!ua || BOT_UA.test(ua) || !fromSite(request.headers.get("Origin"), request.headers.get("Referer"))) return reply({ ok: false, error: "تعذر إرسال التعليق." }, 403);
  const raw = await request.text();
  if (raw.length > 120_000) return reply({ ok: false, error: "الصورة كبيرة جدا، اختر صورة أصغر." }, 413);
  let b: any;
  try { b = JSON.parse(raw); } catch { return reply({ ok: false, error: "تعذر إرسال التعليق." }, 400); }
  const path = commentPath(b?.p);
  if (!path) return reply({ ok: false, error: "تعذر إرسال التعليق." }, 400);
  // a bot: the field people never see is filled, or the form was sent faster than anyone can type
  if (String(b.website || "") !== "" || !(Number(b.t) >= 2000)) return reply({ ok: true, id: 0, status: "published" });
  // a member comments as themselves: their name and picture, kept with their account
  const member = await memberOf(request, env as any, now);
  if (!member && env.COMMENTS_OPEN !== "1") return reply({ ok: false, signedOut: true, error: "التعليق للأعضاء فقط. سجل دخولك أو أنشئ حسابا مجانيا لتعلق." }, 401);
  // the site's own account, signed in on the site: its comments are the site's, as the panel's replies (official = 1)
  const official = !!(member as any)?.official;
  const name = official ? OFFICIAL_NAME : member ? (member.display || member.username) : cleanText(b.name, 40);
  const text = cleanText(b.text, 1000, true);
  if (name.length < 2) return reply({ ok: false, error: "اكتب اسمك أولا." }, 400);
  if (text.length < 2) return reply({ ok: false, error: "اكتب تعليقك أولا." }, 400);
  if (HAS_LINK.test(text) || HAS_LINK.test(name)) return reply({ ok: false, error: "الروابط غير مسموح بها في التعليقات." }, 400);
  if (isReservedName(name) && !official) return reply({ ok: false, error: "هذا الاسم خاص بالحساب الرسمي للموقع، اختر اسما آخر." }, 400);
  // a visitor can't take a member's name
  if (!member) {
    await ensureMembers(db);
    const k = name.normalize("NFKC").toLowerCase();
    if (await db.prepare("SELECT 1 FROM members WHERE ukey = ?1 OR lower(display) = ?1 LIMIT 1").bind(k).first()) return reply({ ok: false, error: "هذا الاسم لعضو مسجل في الموقع. سجل دخولك إن كان حسابك، أو اختر اسما آخر.", member: true }, 400);
  }
  const title = cleanText(b.title, 200);
  // an answer to a comment or to a reply: on the same page, under the same comment (the thread), told to whoever wrote it
  let target: Row | null = null;
  if (b.parent) {
    target = await db.prepare("SELECT id, path, parent, owner FROM comments WHERE id = ?1 AND deleted = 0").bind(Number(b.parent) || 0).first<Row>();
    if (!target || target.path !== path) return reply({ ok: false, error: "هذا التعليق محذوف، ولا يمكن الرد عليه." }, 404);
  }
  const parent = target ? (target.parent || target.id) : 0;
  const owner = await ownerOf(b.k);
  const { day } = cairo(now);
  const who = await visitor(env, request, day);
  const [recent, today, same] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE vhash = ?1 AND at > ?2").bind(who, now - 10 * 60_000),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE vhash = ?1 AND at > ?2").bind(who, now - 86_400_000),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE path = ?1 AND text = ?2 AND parent = ?3 AND deleted = 0").bind(path, text, parent),
  ]) as any[];
  if (!official && (recent.results?.[0]?.n || 0) >= 4) return reply({ ok: false, error: "أرسلت تعليقات كثيرة الآن، انتظر قليلا ثم حاول مرة أخرى." }, 429);
  if (!official && (today.results?.[0]?.n || 0) >= 30) return reply({ ok: false, error: "وصلت إلى الحد اليومي للتعليقات، شكرا لك." }, 429);
  if ((same.results?.[0]?.n || 0) > 0) return reply({ ok: false, error: "هذا التعليق منشور بالفعل." }, 409);

  const chosen = official ? "" : member ? member.pic : String(b.pic || "");
  const wrestler = WRESTLER_PIC.test(chosen) || (member && /^https:\/\//.test(chosen)) ? chosen : "";
  const upload = !wrestler && !member && env.MEDIA ? chosen.match(UPLOAD) : null;
  let bytes: Uint8Array | null = null;
  if (upload) {
    try { bytes = Uint8Array.from(atob(upload[2]), c => c.charCodeAt(0)); } catch { bytes = null; }
    if (bytes && (bytes.length < 200 || bytes.length > 80_000)) bytes = null; // the page sends a 160px square: a few kB
  }
  const country = String((request as any).cf?.country || "").slice(0, 2).toUpperCase();
  // the visitor's address, for the panel only (owner 2026-10-14: «عايز كمان يبان ip بتاع المتابع ال معلق في اللوحة»):
  // never in what the page gets (out())
  const ip = String(request.headers.get("CF-Connecting-IP") || "").slice(0, 45);
  const ins = await db.prepare("INSERT INTO comments (path, title, name, text, pic, at, day, vhash, country, ip, parent, reply_to, owner, member, official) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) RETURNING id")
    .bind(path, title, name, text, official ? "official" : wrestler, now, day, who, country, ip, parent, target ? target.id : 0, owner, member ? member.id : 0, official ? 1 : 0).first<{ id: number }>();
  const id = ins?.id || 0;
  let picOut = wrestler;
  if (bytes && id) {
    try {
      await env.MEDIA!.put(`comments/${id}.webp`, bytes, { httpMetadata: { contentType: `image/${upload![1]}` } });
      picOut = `${PIC_ORIGIN}/comments/pic/${id}.webp`;
      await db.prepare("UPDATE comments SET pic = ?1 WHERE id = ?2").bind(picOut, id).run();
    } catch { picOut = ""; }
  }
  // whoever wrote what this answers is told (not someone answering themselves)
  if (target?.owner && target.owner !== owner) await notifyOwner(env.PUSH_KV, target.owner).catch(() => 0);
  return reply({ ok: true, id, status: "published", pic: picOut, parent, reply_to: target ? target.id : 0, name, member: member ? member.username : "", official, blue: !!member && !official && ((member as any).badge !== 0 || Number((member as any).premium_until) > now), gold: !!member && !official && (member as any).badge === 2, prem: !!member && !official && Number((member as any).premium_until) > now });
}

// ── the panel ──────────────────────────────────────────────────────────────
export async function studioComments(env: CommentsEnv, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: true, items: [], counts: { today: 0, week: 0, total: 0 } };
  await ensureTable(db);
  const { day } = cairo(now);
  const [rows, today, week, total] = await db.batch([
    db.prepare("SELECT id, path, title, name, text, pic, at, parent, official, hearted, ip, country FROM comments WHERE deleted = 0 ORDER BY at DESC LIMIT 1500"),
    // the numbers are the visitors' comments; the site's own replies aren't counted
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE deleted = 0 AND official = 0 AND day = ?1").bind(day),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE deleted = 0 AND official = 0 AND at > ?1").bind(now - 7 * 86_400_000),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE deleted = 0 AND official = 0"),
  ]) as any[];
  return {
    success: true,
    items: (rows.results || []).map((r: Row) => ({ ...out(r), path: r.path, title: r.title, ip: r.ip || "", country: r.country || "" })),
    counts: { today: today.results?.[0]?.n || 0, week: week.results?.[0]?.n || 0, total: total.results?.[0]?.n || 0 },
  };
}

/** Deleted comments leave the site at once; a visitor's own picture goes with them (the row stays, marked, for the record) */
export async function studioDeleteComments(env: CommentsEnv, ids: unknown): Promise<number> {
  const db = env.ANALYTICS;
  if (!db) return 0;
  await ensureTable(db);
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!list.length) return 0;
  const q = list.map((_, i) => `?${i + 1}`).join(",");
  const res = await db.prepare(`UPDATE comments SET deleted = 1 WHERE (id IN (${q}) OR parent IN (${q})) AND deleted = 0`).bind(...list).run();
  if (env.MEDIA) await Promise.all(list.map(id => env.MEDIA!.delete(`comments/${id}.webp`).catch(() => null)));
  return res.meta?.changes || 0;
}

/** The site's own reply to a comment (a reply to a reply answers the same comment): published at once */
export async function studioReplyComment(env: CommentsEnv, id: unknown, rawText: unknown, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "التعليقات مش متاحة دلوقتي." };
  await ensureTable(db);
  const text = cleanText(rawText, 1000, true);
  if (text.length < 1) return { success: false, error: "اكتب الرد الأول." };
  const target = await db.prepare("SELECT id, path, title, parent, owner FROM comments WHERE id = ?1 AND deleted = 0").bind(Number(id) || 0).first<Row>();
  if (!target) return { success: false, error: "التعليق ده اتحذف أو مش موجود." };
  const parent = target.parent || target.id;
  const { day } = cairo(now);
  const ins = await db.prepare("INSERT INTO comments (path, title, name, text, pic, at, day, vhash, country, parent, official, reply_to) VALUES (?1, ?2, ?3, ?4, 'official', ?5, ?6, 'official', '', ?7, 1, ?8) RETURNING id")
    .bind(target.path, target.title, OFFICIAL_NAME, text, now, day, parent, target.id).first<{ id: number }>();
  // the visitor is told: «عرب راسلنج رد على تعليقك»
  if (target.owner) await notifyOwner(env.PUSH_KV, target.owner).catch(() => 0);
  return { success: true, item: { id: ins?.id || 0, name: OFFICIAL_NAME, text, pic: "official", at: now, parent, official: true, path: target.path, title: target.title } };
}

/** The site's heart on a visitor's comment (owner 2026-10-14, like YouTube's: «زر اعجاب… اعمله عليه قلب ويبان عنده»):
 *  on, or off again. Only a visitor's comment: the site doesn't heart its own replies */
export async function studioHeartComment(env: CommentsEnv, id: unknown, on: unknown, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "التعليقات مش متاحة دلوقتي." };
  await ensureTable(db);
  const c = await db.prepare("SELECT id, owner, hearted_at FROM comments WHERE id = ?1 AND deleted = 0 AND official = 0").bind(Number(id) || 0).first<Row & { hearted_at: number }>();
  if (!c) return { success: false, error: "التعليق ده اتحذف أو مش موجود." };
  // the visitor is told the first time only («أعجب عرب راسلنج بتعليقك»): a heart taken off and given again says nothing new
  const first = !!on && !c.hearted_at;
  await db.prepare("UPDATE comments SET hearted = ?1, hearted_at = CASE WHEN ?2 THEN ?3 ELSE hearted_at END WHERE id = ?4").bind(on ? 1 : 0, first ? 1 : 0, now, c.id).run();
  if (first && c.owner) await notifyOwner(env.PUSH_KV, c.owner).catch(() => 0);
  return { success: true, hearted: !!on };
}

/** The bell: visitors' comments of the last hours, as notifications */
export async function commentNotifications(env: CommentsEnv, sinceMs: number): Promise<any[]> {
  const db = env.ANALYTICS;
  if (!db) return [];
  try {
    await ensureTable(db);
    const rows = await db.prepare("SELECT id, path, title, name, text, at FROM comments WHERE deleted = 0 AND official = 0 AND at > ?1 ORDER BY at DESC LIMIT 40").bind(sinceMs).all<Row>();
    return (rows.results || []).map(r => ({ id: `comment:${r.id}`, type: "comment", at: r.at, name: r.name, text: r.text.slice(0, 160), title: r.title, url: r.path }));
  } catch { return []; }
}
