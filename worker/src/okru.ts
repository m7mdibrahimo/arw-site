// «العرض قبل الجميع» and the owner's OK.ru videos (owner 2026-10-29: «السيرفر ده فيه بروفايل وفيه الفديوهات … عايز علي اي
// فديو انشره … كل حاجة تلقائي»). OK.ru lists every video on its author's profile, and a video is either for all users or
// for friends only — no «by link» — and a friends-only video doesn't play in the site's player. So for a show in its
// window, each of its OK.ru videos is turned to friends only (off the profile) and left out of the members' servers; when
// the window ends it is turned back to all users and comes in for everyone. Nothing to do by hand for any show.
//   want/done per video in D1 (early_ok): the panel's save and the release only say what they want (worker/src/early.ts),
//   every minute syncOk() asks OK.ru (video.update, privacy) until it's done.
// OK.ru's API: an application of the owner's (OK_APP_KEY, plus OK_SESSION_SECRET for its owner's permanent token, or
// OK_APP_SECRET), and the token itself (OK_TOKEN), with the VIDEO_CONTENT and VALUABLE_ACCESS rights. Until they're set
// nothing is asked and the videos stay as they are (and still play for members: they're public anyway).

export interface OkEnv { OK_APP_KEY?: string; OK_APP_SECRET?: string; OK_SESSION_SECRET?: string; OK_TOKEN?: string }
export type OkPrivacy = "FRIENDS" | "PUBLIC";

/** An OK.ru video's id from any of its links (video, videoembed, mobile), or «» */
export function okVideoId(url: unknown): string {
  const m = String(url || "").match(/^https?:\/\/(?:www\.|m\.)?ok\.ru\/(?:video|videoembed|live)\/(\d{1,25})/i);
  return m ? m[1] : "";
}
export const okConfigured = (env: OkEnv) => !!(env.OK_APP_KEY && env.OK_TOKEN && (env.OK_SESSION_SECRET || env.OK_APP_SECRET));

/** MD5 in hex (OK.ru's signatures; Web Crypto has no MD5 everywhere) */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = ((bytes.length + 8) >>> 6) + 1, w = new Uint32Array(n * 16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  w[n * 16 - 2] = (bytes.length * 8) >>> 0; w[n * 16 - 1] = Math.floor(bytes.length / 0x20000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < w.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      let f: number, g: number;
      if (r === 0) { f = (b & c) | (~b & d); g = i; }
      else if (r === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (r === 2) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + w[o + g]) >>> 0, sh = S[r * 4 + (i % 4)];
      b = (b + ((x << sh) | (x >>> (32 - sh)))) >>> 0; a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(v => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
}
/** OK.ru's signature: md5 of the sorted «k=v» pairs (no access_token) and the session's secret */
export function okSig(params: Record<string, string>, env: OkEnv): string {
  const secret = env.OK_SESSION_SECRET ? env.OK_SESSION_SECRET.toLowerCase() : md5(String(env.OK_TOKEN) + String(env.OK_APP_SECRET));
  return md5(Object.keys(params).filter(k => k !== "access_token" && k !== "session_key").sort().map(k => `${k}=${params[k]}`).join("") + secret);
}
/** One call to OK.ru's REST API; an OK.ru error is thrown with its words */
export async function okCall(env: OkEnv, method: string, args: Record<string, string>): Promise<any> {
  const params: Record<string, string> = { application_key: String(env.OK_APP_KEY), format: "json", method, ...args };
  const body = new URLSearchParams({ ...params, sig: okSig(params, env), access_token: String(env.OK_TOKEN) });
  const r = await fetch("https://api.ok.ru/fb.do", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const text = await r.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { /* «true» / empty: fine */ }
  if (!r.ok) throw new Error(`OK.ru ${r.status}`);
  if (d && typeof d === "object" && (d.error_code || d.error_msg)) throw new Error(`OK.ru ${d.error_code}: ${d.error_msg}`);
  return d;
}

// ── D1: what each video should be, and what it is ───────────────────────────
const ready = new WeakSet<D1Database>();
export async function ensureOk(db: D1Database) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS early_ok (vid TEXT PRIMARY KEY, k TEXT NOT NULL, want TEXT NOT NULL, done TEXT NOT NULL DEFAULT '',
    tries INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL)`).run();
  // its server's lines in the show's file, held out of it while the video is still friends-only after the window
  await db.prepare("ALTER TABLE early_ok ADD COLUMN item TEXT NOT NULL DEFAULT ''").run().catch(() => {});
  ready.add(db);
}
/** A show's window began or moved: its OK.ru videos off the profile; any it no longer has, back for everyone */
export async function okWantHidden(db: D1Database, k: string, servers: string[], now = Date.now()) {
  await ensureOk(db);
  const vids = [...new Set(servers.map(okVideoId).filter(Boolean))];
  const known = ((await db.prepare("SELECT vid FROM early_ok WHERE k = ?1").bind(k).all<any>()).results || []).map((r: any) => String(r.vid));
  for (const v of known) if (!vids.includes(v)) await want(db, k, v, "PUBLIC", now);
  for (const v of vids) await want(db, k, v, "FRIENDS", now);
}
/** A show's window ended (or was taken off): its OK.ru videos for everyone again */
export async function okWantPublic(db: D1Database, k: string, now = Date.now()) {
  await ensureOk(db);
  await db.prepare("UPDATE early_ok SET want = 'PUBLIC', tries = 0, error = '', updated = ?2 WHERE k = ?1 AND want != 'PUBLIC'").bind(k, now).run();
}
async function want(db: D1Database, k: string, vid: string, w: OkPrivacy, now: number) {
  await db.prepare(`INSERT INTO early_ok (vid, k, want, updated) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(vid) DO UPDATE SET k = ?2, want = ?3, tries = CASE WHEN early_ok.want = ?3 THEN early_ok.tries ELSE 0 END, updated = ?4`).bind(vid, k, w, now).run();
}
/** The OK.ru videos that are friends-only now, so not playable in the site's player: left out of the members' servers */
export async function okHidden(db: D1Database | undefined, k: string): Promise<Set<string>> {
  if (!db) return new Set();
  await ensureOk(db);
  const rows = (await db.prepare("SELECT vid FROM early_ok WHERE k = ?1 AND done = 'FRIENDS'").bind(k).all<any>()).results || [];
  return new Set(rows.map((r: any) => String(r.vid)));
}
/** A server list's items («- url: …» and the lines under it), each with its OK.ru video's id */
function serverItems(lines: string[]): { lines: string[]; vid: string }[] {
  const items: { lines: string[]; vid: string }[] = [];
  for (const l of lines) {
    if (/^\s*-\s/.test(l) || !items.length) items.push({ lines: [l], vid: "" });
    else items[items.length - 1].lines.push(l);
  }
  for (const it of items) it.vid = okVideoId((it.lines.join("\n").match(/url:\s*['"]?(https?:\/\/[^'"\s]+)/) || [])[1]);
  return items;
}
/** The window ended but an OK.ru video is still friends-only (OK.ru not set up, or down): its server stays out of the
 *  show's file, so the page never shows a server that doesn't play; it's put back once the video is public (syncOk) */
export async function okHold(db: D1Database, k: string, vault: string, now = Date.now()): Promise<string> {
  const hidden = await okHidden(db, k);
  if (!hidden.size) return vault;
  const out: string[] = [];
  let inServers = false, list: string[] = [];
  const flush = async () => {
    for (const it of serverItems(list)) {
      if (it.vid && hidden.has(it.vid)) await db.prepare("UPDATE early_ok SET item = ?2, updated = ?3 WHERE vid = ?1").bind(it.vid, it.lines.join("\n"), now).run();
      else out.push(...it.lines);
    }
    list = [];
  };
  for (const l of vault.split(/\r?\n/)) {
    if (/^[A-Za-z_][\w-]*:/.test(l)) { if (inServers) await flush(); inServers = /^servers:/.test(l); out.push(l); continue; }
    if (inServers) list.push(l); else out.push(l);
  }
  if (inServers) await flush();
  return out.join("\n");
}
/** A held server's lines back at the top of the show's servers (or a new «servers:» before «layout:») */
export function okPutBack(text: string, item: string): string {
  const m = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m || !item) return text;
  const lines = m[2].split(/\r?\n/);
  const at = lines.findIndex(l => /^servers:\s*(null|\[\])?\s*$/.test(l));
  if (at >= 0) lines.splice(at, 1, "servers:", ...item.split("\n"));
  else {
    const lay = lines.findIndex(l => /^layout:/.test(l));
    lines.splice(lay >= 0 ? lay : lines.length, 0, "servers:", ...item.split("\n"));
  }
  return m[1] + lines.join("\n") + text.slice(m[1].length + m[2].length);
}

/** Every minute: each video OK.ru hasn't been told about yet (a few a minute, a failing one less and less often) */
export async function syncOk(db: D1Database | undefined, env: OkEnv, now = Date.now(), call = okCall, io?: {
  read: (path: string) => Promise<{ content: string } | null>;
  commit: (path: string, text: string, message: string) => Promise<unknown>;
}): Promise<{ vid: string; to: string; ok: boolean }[]> {
  if (!db || !okConfigured(env)) return [];
  await ensureOk(db);
  // never turned friends-only (or public again): nothing to ask OK.ru
  await db.prepare("DELETE FROM early_ok WHERE want = 'PUBLIC' AND done IN ('', 'PUBLIC') AND item = ''").run();
  const rows = (await db.prepare("SELECT vid, k, want, tries, updated FROM early_ok WHERE want != done AND tries < 40 ORDER BY updated LIMIT 8").all<any>()).results || [];
  const out: { vid: string; to: string; ok: boolean }[] = [];
  for (const r of rows) {
    // after a failure: 1, 2, 4 … minutes (at most an hour) before the next try
    if (r.tries && now - Number(r.updated) < Math.min(60, 2 ** (r.tries - 1)) * 60_000) continue;
    try {
      await call(env, "video.update", { vid: String(r.vid), privacy: String(r.want) });
      await db.prepare("UPDATE early_ok SET done = ?2, error = '', updated = ?3 WHERE vid = ?1 AND want = ?2").bind(r.vid, r.want, now).run();
      out.push({ vid: r.vid, to: r.want, ok: true });
    } catch (e: any) {
      await db.prepare("UPDATE early_ok SET tries = tries + 1, error = ?2, updated = ?3 WHERE vid = ?1").bind(r.vid, String(e?.message || e).slice(0, 200), now).run();
      out.push({ vid: r.vid, to: r.want, ok: false });
    }
  }
  // public again: a server held out of its show's file goes back in (one commit; tried again next minute if it fails)
  const back = (await db.prepare("SELECT vid, k, item FROM early_ok WHERE want = 'PUBLIC' AND done = 'PUBLIC' AND item != '' LIMIT 5").all<any>()).results || [];
  for (const b of back) {
    if (!io) break;
    try {
      const path = `content/${b.k}.md`, file = await io.read(path);
      if (file && !file.content.includes(`ok.ru/video/${b.vid}`) && !file.content.includes(`ok.ru/videoembed/${b.vid}`)) {
        const label = String(b.k).startsWith("recaps/") ? "ملخص" : String(b.k).startsWith("nostalgia/") ? "عرض / حلقة نوستالجيا" : "عرض";
        await io.commit(path, okPutBack(file.content, b.item), `Update ${label} “${String(b.k).split("/")[1]}” (لوحة التحكم — سيرفر أوكي متاح للجميع)`);
      }
      await db.prepare("UPDATE early_ok SET item = '' WHERE vid = ?1").bind(b.vid).run();
    } catch (e: any) { console.log(`[ok.ru] put back ${b.k}: ${e?.message || e}`); }
  }
  await db.prepare("DELETE FROM early_ok WHERE want = 'PUBLIC' AND done = 'PUBLIC' AND item = ''").run();
  return out;
}
