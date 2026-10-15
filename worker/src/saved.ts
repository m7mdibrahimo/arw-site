// «المفضلة وشاهد لاحقا على كل أجهزتك» (owner 2026-10-15): a member's saved list (the bookmark button on every show,
// recap and story, assets/features.js) is kept with their account, so the phone and the computer show the same list.
// A visitor's list stays in their browser as before; signing in on a device adds what it had to the account's.
//
//   GET  /saved                        {items}                  (member) newest first
//   POST /saved {op: "add", item}      {items}                  (member)
//   POST /saved {op: "remove", url}    {items}                  (member)
//   POST /saved {op: "merge", items}   {items}                  (member) a device's own list, the first time it signs in
import { once } from "./once";
import { memberOf, type MembersEnv } from "./members";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export const MAX_SAVED = 300;
// the site's own pages and pictures only (a list someone edited by hand can't carry anything else)
const PATH = /^\/(?:en\/)?(?:shows|recaps|news|nostalgia|news-en)\/[^\s"'<>\\]{1,300}$/;
const IMAGE = /^(?:\/[^\s"'<>\\]{1,400}|https:\/\/[^\s"'<>\\]{1,400})$/;
const KINDS = ["show", "recap", "news"];

function ensureSaved(db: D1Database): Promise<void> {
  return once(db, "saved", () => db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS member_saved (member INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', fed TEXT NOT NULL DEFAULT '', added INTEGER NOT NULL, PRIMARY KEY (member, url))"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_saved_added ON member_saved (member, added)"),
  ]));
}

/** One saved item as kept: a known page, its title, picture, kind and promotion (or null) */
export function cleanSaved(x: any, now = Date.now()) {
  if (!x || typeof x !== "object") return null;
  let url = String(x.url || "").trim();
  if (!PATH.test(url)) return null;
  const image = String(x.image || "").trim();
  const added = Number(x.addedAt ?? x.added) || now;
  return {
    url,
    title: String(x.title || "").replace(/\s+/g, " ").trim().slice(0, 200),
    image: IMAGE.test(image) ? image : "",
    kind: KINDS.includes(String(x.kind)) ? String(x.kind) : "show",
    fed: String(x.fed || "").replace(/[^\w .&-]/g, "").slice(0, 20),
    added: Math.min(added, now),
  };
}
const out = (r: any) => ({ url: r.url, title: r.title, image: r.image, kind: r.kind, fed: r.fed, addedAt: r.added });
async function list(db: D1Database, member: number) {
  return ((await db.prepare("SELECT * FROM member_saved WHERE member = ?1 ORDER BY added DESC LIMIT ?2").bind(member, MAX_SAVED).all()).results || []).map(out);
}
async function put(db: D1Database, member: number, items: NonNullable<ReturnType<typeof cleanSaved>>[]) {
  for (let i = 0; i < items.length; i += 50) {
    await db.batch(items.slice(i, i + 50).map(x => db.prepare("INSERT INTO member_saved (member, url, title, image, kind, fed, added) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (member, url) DO UPDATE SET title = excluded.title, image = excluded.image, kind = excluded.kind, fed = excluded.fed")
      .bind(member, x.url, x.title, x.image, x.kind, x.fed, x.added)));
  }
  // the newest MAX_SAVED stay
  await db.prepare("DELETE FROM member_saved WHERE member = ?1 AND url NOT IN (SELECT url FROM member_saved WHERE member = ?1 ORDER BY added DESC LIMIT ?2)").bind(member, MAX_SAVED).run();
}

export async function handleSaved(request: Request, env: MembersEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "المفضلة غير متاحة الآن." }, 503);
  if (url.pathname !== "/saved") return reply({ ok: false, error: "not found" }, 404);
  const me = await memberOf(request, env, now);
  if (!me) return reply({ ok: false, error: "سجل دخولك أولا.", signedOut: true }, 401);
  await ensureSaved(db);
  if (request.method === "GET") return reply({ ok: true, items: await list(db, me.id) });
  if (request.method !== "POST") return reply({ ok: false, error: "not allowed" }, 405);
  const b: any = await request.json().catch(() => ({}));
  if (b.op === "add") {
    const x = cleanSaved({ ...b.item, addedAt: now }, now);
    if (!x) return reply({ ok: false, error: "تعذر الحفظ." }, 400);
    await put(db, me.id, [x]);
  } else if (b.op === "remove") {
    await db.prepare("DELETE FROM member_saved WHERE member = ?1 AND url = ?2").bind(me.id, String(b.url || "")).run();
  } else if (b.op === "merge") {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_SAVED).map((x: any) => cleanSaved(x, now)).filter(Boolean) as NonNullable<ReturnType<typeof cleanSaved>>[];
    if (items.length) await put(db, me.id, items);
  } else return reply({ ok: false, error: "not found" }, 404);
  return reply({ ok: true, items: await list(db, me.id) });
}
