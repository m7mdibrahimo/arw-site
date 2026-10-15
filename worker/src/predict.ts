// «توقعات العروض الكبرى وترتيب أفضل المتوقعين» (owner 2026-10-15): the owner puts up a big show's card from the panel
// (its matches, and each one's possible winners); members pick a winner for each match until the show starts; once
// the owner enters the results, each right pick earns its match's points, and the members are ranked: for that show,
// and over all of them. Whoever took part is told their score in the bell (member_inbox, worker/src/follows.ts).
//
//   GET  /predict                       {events, leaders, me?}       anyone (a member also gets their picks and rank)
//   POST /predict/pick {match, pick}    {ok}                         a member, until the show starts
//   panel (worker/src/index.ts): studioPredict (list), studioPredictSave, studioPredictResult, studioPredictDelete
import { once } from "./once";
import { memberOf, type MembersEnv } from "./members";
import { ensureFollows } from "./follows";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export function ensurePredict(db: D1Database): Promise<void> {
  return once(db, "predict", () => db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS pred_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_en TEXT NOT NULL DEFAULT '', starts INTEGER NOT NULL, image TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', created INTEGER NOT NULL, done_at INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pred_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, event INTEGER NOT NULL, ord INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, options TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 1, winner TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS pred_matches_event ON pred_matches (event, ord)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pred_picks (member INTEGER NOT NULL, match INTEGER NOT NULL, pick TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (member, match))"),
    db.prepare("CREATE INDEX IF NOT EXISTS pred_picks_match ON pred_picks (match)"),
  ]));
}

const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const IMAGE = /^(?:\/[^\s"'<>\\]{1,400}|https:\/\/[^\s"'<>\\]{1,400})$/;
const opts = (raw: string): string[] => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };

/** Each member's points and right picks, over the given events' finished matches */
async function standings(db: D1Database, eventId = 0, limit = 20) {
  const rows = (await db.prepare(`SELECT p.member AS member, SUM(CASE WHEN p.pick = m.winner THEN m.points ELSE 0 END) AS points,
      SUM(CASE WHEN p.pick = m.winner THEN 1 ELSE 0 END) AS right, COUNT(*) AS picks
    FROM pred_picks p JOIN pred_matches m ON m.id = p.match JOIN pred_events e ON e.id = m.event
    WHERE m.winner != '' AND e.status = 'done' ${eventId ? "AND e.id = ?1" : "AND ?1 = ?1"}
    GROUP BY p.member ORDER BY points DESC, right DESC, MIN(p.at) ASC`).bind(eventId).all<{ member: number; points: number; right: number; picks: number }>()).results || [];
  return rows.map((r, i) => ({ ...r, rank: i + 1 })).filter(r => r.picks > 0).slice(0, Math.max(limit, 0) || undefined);
}
/** Names and pictures for a ranking (as each member is now) */
async function withPeople(db: D1Database, list: { member: number }[]) {
  if (!list.length) return [];
  const ids = list.map(x => x.member);
  const people = new Map(((await db.prepare(`SELECT id, username, display, pic, official, badge, premium_until FROM members WHERE id IN (${ids.map(() => "?").join(",")}) AND banned = 0`).bind(...ids).all<any>()).results || []).map(m => [m.id, m]));
  const now = Date.now();
  return list.filter(x => people.has(x.member)).map((x: any) => {
    const m: any = people.get(x.member);
    return { rank: x.rank, points: x.points, right: x.right, picks: x.picks, user: m.username, name: m.display || m.username, pic: m.official ? "official" : m.pic,
      blue: !m.official && (m.badge !== 0 || Number(m.premium_until) > now), gold: !!m.official || m.badge === 2, prem: !m.official && Number(m.premium_until) > now };
  });
}

export async function handlePredict(request: Request, env: MembersEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "التوقعات غير متاحة الآن." }, 503);
  await ensurePredict(db);
  const path = url.pathname.replace(/^\/predict/, "") || "/";

  if (path === "/" && request.method === "GET") {
    const me = await memberOf(request, env, now);
    // what's open, and what finished in the last 60 days
    const events = (await db.prepare("SELECT * FROM pred_events WHERE status IN ('open', 'done') AND (status = 'open' OR done_at > ?1) ORDER BY starts DESC LIMIT 12").bind(now - 60 * 86_400_000).all<any>()).results || [];
    const ids = events.map(e => e.id);
    const matches = ids.length ? (await db.prepare(`SELECT * FROM pred_matches WHERE event IN (${ids.map(() => "?").join(",")}) ORDER BY event, ord, id`).bind(...ids).all<any>()).results || [] : [];
    const mids = matches.map(m => m.id);
    const counts = mids.length ? (await db.prepare(`SELECT match, pick, COUNT(*) AS n FROM pred_picks WHERE match IN (${mids.map(() => "?").join(",")}) GROUP BY match, pick`).bind(...mids).all<any>()).results || [] : [];
    const mine = me && mids.length ? (await db.prepare(`SELECT match, pick FROM pred_picks WHERE member = ?1 AND match IN (${mids.map(() => "?").join(",")})`).bind(me.id, ...mids).all<any>()).results || [] : [];
    const myPick = new Map(mine.map(r => [r.match, r.pick]));
    const out = [];
    for (const e of events) {
      const locked = e.status === "done" || now >= e.starts;
      const ms = matches.filter(m => m.event === e.id).map(m => {
        const c = counts.filter(x => x.match === m.id), total = c.reduce((s, x) => s + x.n, 0);
        return { id: m.id, title: m.title, options: opts(m.options), points: m.points, winner: e.status === "done" ? m.winner : "",
          // what everyone picked shows once the picks are closed (no following the crowd before)
          share: locked ? Object.fromEntries(c.map(x => [x.pick, total ? Math.round((x.n * 100) / total) : 0])) : null, total, mine: myPick.get(m.id) || "" };
      });
      out.push({ id: e.id, title: e.title, title_en: e.title_en, starts: e.starts, image: e.image, status: e.status, locked, matches: ms,
        leaders: e.status === "done" ? await withPeople(db, await standings(db, e.id, 10)) : [] });
    }
    const all = await standings(db, 0, 0);
    const leaders = await withPeople(db, all.slice(0, 20));
    const meRow = me ? all.find(r => r.member === me.id) : null;
    return reply({ ok: true, now, events: out, leaders, me: me ? { rank: meRow ? meRow.rank : 0, points: meRow ? meRow.points : 0, right: meRow ? meRow.right : 0, of: all.length } : null });
  }

  if (path === "/pick" && request.method === "POST") {
    const me = await memberOf(request, env, now);
    if (!me) return reply({ ok: false, error: "سجل دخولك أولا.", signedOut: true }, 401);
    const b: any = await request.json().catch(() => ({}));
    const m = await db.prepare("SELECT m.*, e.starts, e.status FROM pred_matches m JOIN pred_events e ON e.id = m.event WHERE m.id = ?1").bind(Number(b.match) || 0).first<any>();
    if (!m || m.status !== "open") return reply({ ok: false, error: "هذا التوقع غير متاح." }, 404);
    if (now >= m.starts) return reply({ ok: false, error: "أغلقت التوقعات، بدأ العرض.", locked: true }, 400);
    const pick = String(b.pick || "");
    if (!opts(m.options).includes(pick)) return reply({ ok: false, error: "اختر أحد المتنافسين." }, 400);
    await db.prepare("INSERT INTO pred_picks (member, match, pick, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (member, match) DO UPDATE SET pick = excluded.pick, at = excluded.at").bind(me.id, m.id, pick, now).run();
    return reply({ ok: true, pick });
  }
  return reply({ ok: false, error: "not found" }, 404);
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function studioPredict(env: MembersEnv) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePredict(db);
  const events = (await db.prepare("SELECT * FROM pred_events ORDER BY starts DESC LIMIT 60").all<any>()).results || [];
  const matches = (await db.prepare("SELECT m.*, (SELECT COUNT(*) FROM pred_picks p WHERE p.match = m.id) AS picks FROM pred_matches m ORDER BY event, ord, id").all<any>()).results || [];
  const players = (await db.prepare("SELECT m.event AS event, COUNT(DISTINCT p.member) AS n FROM pred_picks p JOIN pred_matches m ON m.id = p.match GROUP BY m.event").all<any>()).results || [];
  return { success: true, events: events.map(e => ({ ...e, players: players.find(p => p.event === e.id)?.n || 0, matches: matches.filter(m => m.event === e.id).map(m => ({ ...m, options: opts(m.options) })) })) };
}

/** A card saved: its name, time, picture, state, and matches (a match already picked keeps its options' names) */
export async function studioPredictSave(env: MembersEnv, b: any, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePredict(db);
  const title = clean(b.title, 120), starts = Number(b.starts) || 0, image = clean(b.image, 400);
  if (title.length < 2) return { success: false, error: "اكتب اسم العرض." };
  if (!starts) return { success: false, error: "حدد ميعاد بداية العرض (التوقعات بتتقفل ساعتها)." };
  const status = ["draft", "open", "done"].includes(b.status) ? b.status : "draft";
  const matches = (Array.isArray(b.matches) ? b.matches : []).slice(0, 20).map((m: any, i: number) => ({
    id: Number(m.id) || 0, ord: i, title: clean(m.title, 160), points: Math.min(Math.max(Math.round(Number(m.points) || 1), 1), 5),
    options: [...new Set((Array.isArray(m.options) ? m.options : []).map((o: unknown) => clean(o, 60)).filter(Boolean))].slice(0, 8) as string[],
  }));
  if (!matches.length) return { success: false, error: "ضيف نزال واحد على الأقل." };
  for (const m of matches) {
    if (m.title.length < 2) return { success: false, error: "كل نزال لازم يكون ليه اسم." };
    if (m.options.length < 2) return { success: false, error: `النزال «${m.title}» محتاج اختيارين على الأقل.` };
  }
  let id = Number(b.id) || 0;
  if (id) {
    const ex = await db.prepare("SELECT id FROM pred_events WHERE id = ?1").bind(id).first();
    if (!ex) return { success: false, error: "العرض ده مش موجود." };
    await db.prepare("UPDATE pred_events SET title = ?1, title_en = ?2, starts = ?3, image = ?4, status = CASE WHEN status = 'done' THEN 'done' ELSE ?5 END WHERE id = ?6").bind(title, clean(b.title_en, 120), starts, IMAGE.test(image) ? image : "", status === "done" ? "open" : status, id).run();
  } else {
    id = Number((await db.prepare("INSERT INTO pred_events (title, title_en, starts, image, status, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id").bind(title, clean(b.title_en, 120), starts, IMAGE.test(image) ? image : "", status === "done" ? "open" : status, now).first<{ id: number }>())?.id || 0);
  }
  const keep: number[] = [];
  for (const m of matches) {
    if (m.id) {
      const ex = await db.prepare("SELECT id FROM pred_matches WHERE id = ?1 AND event = ?2").bind(m.id, id).first();
      if (ex) {
        await db.prepare("UPDATE pred_matches SET ord = ?1, title = ?2, options = ?3, points = ?4 WHERE id = ?5").bind(m.ord, m.title, JSON.stringify(m.options), m.points, m.id).run();
        // a pick for a name that's gone no longer counts
        await db.prepare(`DELETE FROM pred_picks WHERE match = ?1 AND pick NOT IN (${m.options.map(() => "?").join(",")})`).bind(m.id, ...m.options).run();
        keep.push(m.id);
        continue;
      }
    }
    const r = await db.prepare("INSERT INTO pred_matches (event, ord, title, options, points) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id").bind(id, m.ord, m.title, JSON.stringify(m.options), m.points).first<{ id: number }>();
    if (r) keep.push(r.id);
  }
  const gone = ((await db.prepare("SELECT id FROM pred_matches WHERE event = ?1").bind(id).all<{ id: number }>()).results || []).map(r => r.id).filter(x => !keep.includes(x));
  for (const g of gone) await db.batch([db.prepare("DELETE FROM pred_picks WHERE match = ?1").bind(g), db.prepare("DELETE FROM pred_matches WHERE id = ?1").bind(g)]);
  return { success: true, id };
}

/** The results: each match's winner; the card is done, the rankings count it, and whoever took part is told */
export async function studioPredictResult(env: MembersEnv, b: any, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePredict(db);
  const e = await db.prepare("SELECT * FROM pred_events WHERE id = ?1").bind(Number(b.id) || 0).first<any>();
  if (!e) return { success: false, error: "العرض ده مش موجود." };
  const matches = (await db.prepare("SELECT * FROM pred_matches WHERE event = ?1").bind(e.id).all<any>()).results || [];
  const winners = b.winners && typeof b.winners === "object" ? b.winners : {};
  for (const m of matches) {
    const w = String(winners[m.id] ?? "");
    if (w && !opts(m.options).includes(w)) return { success: false, error: `الفايز في «${m.title}» لازم يكون من الاختيارات.` };
    await db.prepare("UPDATE pred_matches SET winner = ?1 WHERE id = ?2").bind(w, m.id).run();
  }
  const finished = !!b.finish;
  const first = finished && e.status !== "done";
  if (finished) await db.prepare("UPDATE pred_events SET status = 'done', done_at = CASE WHEN done_at = 0 THEN ?1 ELSE done_at END WHERE id = ?2").bind(now, e.id).run();
  // the first time the results are out: each one who took part gets their score in the bell
  let told = 0;
  if (first) {
    await ensureFollows(db);
    const rows = (await db.prepare(`SELECT p.member AS member, SUM(CASE WHEN p.pick = m.winner THEN 1 ELSE 0 END) AS right, COUNT(*) AS n,
        SUM(CASE WHEN p.pick = m.winner THEN m.points ELSE 0 END) AS points
      FROM pred_picks p JOIN pred_matches m ON m.id = p.match WHERE m.event = ?1 AND m.winner != '' GROUP BY p.member`).bind(e.id).all<any>()).results || [];
    for (let i = 0; i < rows.length; i += 50) {
      await db.batch(rows.slice(i, i + 50).map(r => db.prepare("INSERT OR IGNORE INTO member_inbox (member, url, title, title_en, image, program, fed, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7)")
        .bind(r.member, `/predictions/#e${e.id}`, `نتائج توقعات ${e.title}: أصبت ${r.right} من ${r.n} (${r.points} نقطة)`, `${e.title_en || e.title} predictions: ${r.right} of ${r.n} right (${r.points} pts)`, e.image || "", "التوقعات", now)));
    }
    told = rows.length;
  }
  return { success: true, told };
}

export async function studioPredictDelete(env: MembersEnv, id: unknown) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePredict(db);
  const e = Number(id) || 0;
  await db.batch([
    db.prepare("DELETE FROM pred_picks WHERE match IN (SELECT id FROM pred_matches WHERE event = ?1)").bind(e),
    db.prepare("DELETE FROM pred_matches WHERE event = ?1").bind(e),
    db.prepare("DELETE FROM pred_events WHERE id = ?1").bind(e),
  ]);
  return { success: true };
}
