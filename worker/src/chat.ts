// «مجتمع المصارعة» (owner 2026-10-14: «نظام دردشات للمسجلين في الموقع فقط … جروب لكل محبين كل اتحاد … يترد في وقتها
// مباشرة … يرفق صور او ملف وخانة ايموجي … وخانة الصوت … تفاعل علي الرسايل … بالايموجي زي ماسنجر … ريبلاي علي الرسالة»).
//
// A room per promotion (and two for everyone), each one a Durable Object (ChatRoom) that keeps its messages in its own
// SQLite and holds the open WebSockets (hibernating while nobody talks, so a quiet room costs nothing). Members only:
// the page trades its member session for a one-minute ticket (POST /chat/ticket), then opens /chat/ws/<room>?ticket=.
//
//   GET  /chat/rooms                 every room: people in it now, its last message (public: the page shows the rooms)
//   POST /chat/ticket                a member's one-use ticket for the room's socket
//   GET  /chat/ws/<room>?ticket=     the room's WebSocket (the protocol: ChatRoom.webSocketMessage)
//   POST /chat/upload?room=&kind=    a picture, a voice note, a file → R2 «arw-media» chat/<room>/<yyyymm>/<random>.<ext>
//   GET  /chat/media/chat/…          what was uploaded (pictures, sound and video in place, other files downloaded)
// The panel (worker/src/index.ts, permission «community»):
//   GET  /api/studio/chat            the rooms, the reported messages, the muted members
//   GET  /api/studio/chat/room/<id>  a room's latest messages
//   POST /api/studio/chat/delete     {room, id}
//   POST /api/studio/chat/mute       {uid, hours} (0 = speak again)
//   POST /api/studio/chat/dismiss    {id} a report looked at
import { memberOf, ensureMembers } from "./members";
import { OFFICIAL_NAME, PIC_ORIGIN } from "./comments";

export interface ChatEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; MEDIA?: R2Bucket; CHAT?: DurableObjectNamespace; RESEND_API_KEY?: string }

/** The rooms. The page's copy (names, words, colours): _data/communityRooms.js — tests/chat.test.mts keeps the two the same */
export const ROOMS = ["general", "wwe", "aew", "njpw", "tna", "roh", "mma", "indie", "nostalgia"] as const;
export type RoomId = typeof ROOMS[number];
const isRoom = (r: unknown): r is RoomId => typeof r === "string" && (ROOMS as readonly string[]).includes(r);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });

// ── what may be sent ─────────────────────────────────────────────────────────
export const LIMITS = { text: 2000, image: 8 * 1024 * 1024, voice: 4 * 1024 * 1024, file: 15 * 1024 * 1024, voiceSeconds: 300, history: 60, keep: 20000 };
/** Files people may share: documents, archives, short videos (nothing that runs) */
const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4",
};
const IMAGE_TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };
const VOICE_TYPES: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac" };
const MEDIA_PREFIX = `${PIC_ORIGIN}/chat/media/`;
const REACTION = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣#*0-9]|\p{Emoji_Modifier}){1,12}$/u;

export type Who = { uid: number; user: string; name: string; pic: string; badge: "gold" | "blue" | "premium" | ""; mod: boolean; mute: number };
export type Att = { kind: "image" | "voice" | "file" | "video"; url: string; name?: string; size?: number; mime?: string; w?: number; h?: number; dur?: number; wave?: number[] };
export type Msg = {
  id: number; uid: number; user: string; name: string; pic: string; badge: string; text: string; att: Att | null;
  reply: { id: number; name: string; text: string; kind: string } | null; spoiler: boolean; reacts: Record<string, number[]>; at: number; del?: boolean; nonce?: string;
};

/** A message's text: trimmed, at most the limit, no more than two empty lines in a row */
export function cleanChatText(t: unknown): string {
  return String(t ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITS.text);
}
/** An attachment as the page sent it, only if it points at this room's own uploads */
export function cleanAtt(a: any, room: string): Att | null {
  if (!a || typeof a !== "object") return null;
  const kind = a.kind;
  if (!["image", "voice", "file", "video"].includes(kind)) return null;
  const url = String(a.url || "");
  if (!url.startsWith(`${MEDIA_PREFIX}chat/${room}/`) || !/^[A-Za-z0-9:/._-]+$/.test(url)) return null;
  const num = (v: unknown, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : undefined; };
  const out: Att = { kind, url };
  if (a.name) out.name = cleanChatText(a.name).replace(/\n/g, " ").slice(0, 120);
  out.size = num(a.size, 50 * 1024 * 1024);
  if (a.mime) out.mime = String(a.mime).slice(0, 80);
  if (kind === "image" || kind === "video") { out.w = num(a.w, 10000); out.h = num(a.h, 10000); }
  if (kind === "voice" || kind === "video") out.dur = num(a.dur, LIMITS.voiceSeconds * 4);
  if (kind === "voice" && Array.isArray(a.wave)) out.wave = a.wave.slice(0, 64).map((v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
  return out;
}

// ── the room ─────────────────────────────────────────────────────────────────
type Sock = WebSocket & { serializeAttachment(v: unknown): void; deserializeAttachment(): any };
const MOD_NAME = OFFICIAL_NAME;

/** One room: its messages (SQLite), the people in it (hibernating WebSockets), what they send (the protocol below).
 *  The page sends JSON: {t:"send", text, att?, reply?, spoiler?, nonce} · {t:"react", id, e} · {t:"del", id} · {t:"typing"}
 *  · {t:"more", before} · {t:"report", id, why} · {t:"pin", id} (the site's account) · "ping" (answered without waking)
 *  and gets: hello · msg · react · del · typing · presence · pin · more · error */
export class ChatRoom {
  state: any; env: ChatEnv; sql: any;
  /** who sent what lately (in memory: a fresh room forgets, which is fine) */
  private recent = new Map<number, number[]>();
  private lastTyping = new Map<number, number>();
  constructor(state: any, env: ChatEnv) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, user TEXT NOT NULL, name TEXT NOT NULL,
      pic TEXT NOT NULL DEFAULT '', badge TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', att TEXT NOT NULL DEFAULT '', reply TEXT NOT NULL DEFAULT '',
      spoiler INTEGER NOT NULL DEFAULT 0, reacts TEXT NOT NULL DEFAULT '{}', at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    try { state.setWebSocketAutoResponse?.(new (globalThis as any).WebSocketRequestResponsePair("ping", "pong")); } catch { /* tests */ }
  }

  // ── storage ──
  private meta(k: string): string | null { const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? String(r.v) : null; }
  private setMeta(k: string, v: string | null) {
    if (v === null) this.sql.exec("DELETE FROM meta WHERE k = ?", k);
    else this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }
  private row(r: any): Msg {
    const del = !!r.deleted;
    return {
      id: Number(r.id), uid: Number(r.uid), user: String(r.user), name: String(r.name), pic: String(r.pic), badge: String(r.badge),
      text: del ? "" : String(r.text), att: del || !r.att ? null : JSON.parse(String(r.att)), reply: r.reply ? JSON.parse(String(r.reply)) : null,
      spoiler: !!r.spoiler, reacts: del ? {} : JSON.parse(String(r.reacts || "{}")), at: Number(r.at), ...(del ? { del: true } : {}),
    };
  }
  private get(id: number): Msg | null { const r = this.sql.exec("SELECT * FROM msgs WHERE id = ?", Number(id) || 0).toArray()[0]; return r ? this.row(r) : null; }
  latest(n = LIMITS.history, before = 0): Msg[] {
    const rows = before
      ? this.sql.exec("SELECT * FROM msgs WHERE id < ? ORDER BY id DESC LIMIT ?", before, n).toArray()
      : this.sql.exec("SELECT * FROM msgs ORDER BY id DESC LIMIT ?", n).toArray();
    return rows.map((r: any) => this.row(r)).reverse();
  }

  // ── people ──
  private socks(except?: WebSocket): Sock[] { return (this.state.getWebSockets() as Sock[]).filter(w => w !== except && (w.readyState === undefined || w.readyState === 1)); }
  private who(ws: Sock): Who { return ws.deserializeAttachment() as Who; }
  private send(ws: WebSocket, data: unknown) { try { ws.send(JSON.stringify(data)); } catch { /* gone */ } }
  private broadcast(data: unknown, except?: WebSocket) { const s = JSON.stringify(data); for (const w of this.socks(except)) { try { w.send(s); } catch { /* gone */ } } }
  people(except?: WebSocket) {
    const seen = new Map<number, { uid: number; name: string; pic: string; badge: string }>();
    for (const w of this.socks(except)) { const p = this.who(w); if (p && !seen.has(p.uid)) seen.set(p.uid, { uid: p.uid, name: p.name, pic: p.pic, badge: p.badge }); }
    return [...seen.values()];
  }
  private presence(except?: WebSocket) { const p = this.people(except); this.broadcast({ t: "presence", online: p.length, people: p.slice(0, 60) }, except); }
  private mutedUntil(uid: number, now: number): number { const v = Number(this.meta(`mute:${uid}`) || 0); return v > now ? v : 0; }

  // ── HTTP: the socket (from the worker, with the member it checked) and the worker's own calls ──
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const room = request.headers.get("X-Chat-Room") || "";
    if (room && !this.meta("room")) this.setMeta("room", room);
    if (url.pathname.endsWith("/summary")) return Response.json(this.summary(now));
    if (url.pathname.endsWith("/admin")) return Response.json(await this.admin(await request.json().catch(() => ({})), now));
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    let me: Who;
    try { me = JSON.parse(decodeURIComponent(request.headers.get("X-Chat-User") || "")); } catch { return new Response("no member", { status: 401 }); }
    if (me.mute && me.mute > now) this.setMeta(`mute:${me.uid}`, String(me.mute));
    const pair = new (globalThis as any).WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, Sock];
    this.state.acceptWebSocket(server, [`u${me.uid}`]);
    server.serializeAttachment(me);
    const pin = Number(this.meta("pin") || 0);
    const msgs = this.latest(LIMITS.history + 1);
    this.send(server, {
      t: "hello", room: this.meta("room") || room, me: { uid: me.uid, name: me.name, user: me.user, mod: me.mod, muted: this.mutedUntil(me.uid, now) },
      msgs: msgs.slice(-LIMITS.history), pinned: pin ? this.get(pin) : null, done: msgs.length <= LIMITS.history,
    });
    this.presence();
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  summary(now = Date.now()) {
    const last = this.sql.exec("SELECT * FROM msgs WHERE deleted = 0 ORDER BY id DESC LIMIT 1").toArray()[0];
    const day = this.sql.exec("SELECT COUNT(*) AS n FROM msgs WHERE at > ? AND deleted = 0", now - 86_400_000).toArray()[0];
    const m = last ? this.row(last) : null;
    return {
      online: this.people().length, today: Number(day?.n || 0), lastId: m ? m.id : 0,
      last: m ? { name: m.name, badge: m.badge, text: m.spoiler ? "" : m.text.slice(0, 90), kind: m.att?.kind || "text", spoiler: m.spoiler, at: m.at } : null,
    };
  }

  /** What the worker asks of the room for the panel (delete, mute, kick, the latest messages) */
  async admin(b: any, now = Date.now()) {
    if (b.op === "recent") return { msgs: this.latest(Math.min(Number(b.n) || 100, 200), Number(b.before) || 0) };
    if (b.op === "delete") return { ok: this.remove(Number(b.id), now) };
    if (b.op === "mute") {
      const uid = Number(b.uid) || 0;
      const until = Number(b.until) || 0;
      this.setMeta(`mute:${uid}`, until > now ? String(until) : null);
      for (const w of this.socks()) { const p = this.who(w); if (p?.uid === uid) { p.mute = until; w.serializeAttachment(p); this.send(w, { t: "muted", until: until > now ? until : 0 }); } }
      return { ok: true };
    }
    if (b.op === "kick") {
      const uid = Number(b.uid) || 0;
      for (const w of this.socks()) { if (this.who(w)?.uid === uid) { this.send(w, { t: "error", code: "banned", error: "تم إيقاف حسابك." }); try { w.close(4003, "banned"); } catch { /* gone */ } } }
      this.presence();
      return { ok: true };
    }
    return { ok: false };
  }

  private remove(id: number, _now: number): boolean {
    const m = this.get(id);
    if (!m || m.del) return false;
    this.sql.exec("UPDATE msgs SET deleted = 1, text = '', att = '', reacts = '{}' WHERE id = ?", id);
    if (m.att?.url && this.env.MEDIA) this.env.MEDIA.delete(m.att.url.slice(MEDIA_PREFIX.length)).catch?.(() => {});
    if (Number(this.meta("pin") || 0) === id) { this.setMeta("pin", null); this.broadcast({ t: "pin", m: null }); }
    this.broadcast({ t: "del", id });
    return true;
  }

  // ── the protocol ──
  async webSocketMessage(ws: Sock, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 20_000) return;
    if (raw === "ping") { ws.send("pong"); return; }
    let b: any;
    try { b = JSON.parse(raw); } catch { return; }
    const me = this.who(ws);
    if (!me) return;
    const now = Date.now();
    const room = this.meta("room") || "";
    switch (b.t) {
      case "send": {
        const muted = this.mutedUntil(me.uid, now);
        if (muted) return this.send(ws, { t: "error", code: "muted", until: muted, nonce: b.nonce, error: "لا يمكنك الكتابة في المجتمع الآن." });
        // at most 6 messages in 10 seconds
        const times = (this.recent.get(me.uid) || []).filter(t => now - t < 10_000);
        if (times.length >= 6) return this.send(ws, { t: "error", code: "slow", nonce: b.nonce, error: "أرسلت رسائل كثيرة بسرعة، انتظر ثوانيَ قليلة." });
        const text = cleanChatText(b.text);
        const att = cleanAtt(b.att, room);
        if (!text && !att) return this.send(ws, { t: "error", code: "empty", nonce: b.nonce, error: "اكتب رسالتك أولًا." });
        let rep: Msg["reply"] = null;
        if (b.reply) {
          const o = this.get(Number(b.reply));
          if (o && !o.del) rep = { id: o.id, name: o.name, text: o.spoiler ? "" : o.text.slice(0, 140), kind: o.att?.kind || "text" };
        }
        times.push(now); this.recent.set(me.uid, times);
        const r = this.sql.exec(`INSERT INTO msgs (uid, user, name, pic, badge, text, att, reply, spoiler, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          me.uid, me.user, me.name, me.pic, me.badge, text, att ? JSON.stringify(att) : "", rep ? JSON.stringify(rep) : "", b.spoiler ? 1 : 0, now).toArray()[0];
        const m = this.row(r);
        this.lastTyping.delete(me.uid);
        this.broadcast({ t: "msg", m, nonce: typeof b.nonce === "string" ? b.nonce.slice(0, 40) : undefined });
        // the room keeps its latest messages
        if (m.id % 200 === 0) this.sql.exec("DELETE FROM msgs WHERE id <= ?", m.id - LIMITS.keep);
        return;
      }
      case "react": {
        const id = Number(b.id) || 0;
        const e = String(b.e || "");
        if (!REACTION.test(e)) return;
        const r = this.sql.exec("SELECT reacts, deleted FROM msgs WHERE id = ?", id).toArray()[0];
        if (!r || r.deleted) return;
        const reacts: Record<string, number[]> = JSON.parse(String(r.reacts || "{}"));
        // one reaction a person, as Messenger: the same one again takes it back, another one replaces it
        const had = Object.keys(reacts).find(k => reacts[k].includes(me.uid));
        for (const k of Object.keys(reacts)) { reacts[k] = reacts[k].filter(u => u !== me.uid); if (!reacts[k].length) delete reacts[k]; }
        if (had !== e) { if (Object.keys(reacts).length >= 12 && !reacts[e]) return; (reacts[e] ||= []).push(me.uid); }
        this.sql.exec("UPDATE msgs SET reacts = ? WHERE id = ?", JSON.stringify(reacts), id);
        this.broadcast({ t: "react", id, reacts });
        return;
      }
      case "del": {
        const m = this.get(Number(b.id));
        if (!m || m.del) return;
        if (m.uid !== me.uid && !me.mod) return;
        this.remove(m.id, now);
        return;
      }
      case "pin": {
        if (!me.mod) return;
        const id = Number(b.id) || 0;
        const m = id ? this.get(id) : null;
        if (id && (!m || m.del)) return;
        this.setMeta("pin", m ? String(m.id) : null);
        this.broadcast({ t: "pin", m });
        return;
      }
      case "typing": {
        if (now - (this.lastTyping.get(me.uid) || 0) < 2500) return;
        this.lastTyping.set(me.uid, now);
        this.broadcast({ t: "typing", uid: me.uid, name: me.name }, ws);
        return;
      }
      case "more": {
        const before = Number(b.before) || 0;
        const msgs = this.latest(LIMITS.history, before);
        return this.send(ws, { t: "more", msgs, done: msgs.length < LIMITS.history });
      }
      case "report": {
        const m = this.get(Number(b.id));
        if (!m || m.del || m.uid === me.uid || !this.env.ANALYTICS) return;
        await ensureReports(this.env.ANALYTICS);
        await this.env.ANALYTICS.prepare(`INSERT OR IGNORE INTO chat_reports (room, msg, uid, name, text, kind, reporter, reporter_name, why, at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(room, m.id, m.uid, m.name, m.text.slice(0, 500), m.att?.kind || "text", me.uid, me.name, cleanChatText(b.why).slice(0, 200), now).run();
        return this.send(ws, { t: "reported", id: m.id });
      }
    }
  }
  async webSocketClose(ws: Sock, code?: number) {
    try { ws.close(code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000); } catch { /* closed */ }
    this.presence(ws);
  }
  async webSocketError(ws: Sock) { this.presence(ws); }
}

// ── reports (D1) ─────────────────────────────────────────────────────────────
const reportsReady = new WeakMap<D1Database, Promise<unknown>>();
export function ensureReports(db: D1Database) {
  let p = reportsReady.get(db);
  if (!p) reportsReady.set(db, p = ensureMembers(db).then(() => db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS chat_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, msg INTEGER NOT NULL, uid INTEGER NOT NULL,
      name TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, reporter INTEGER NOT NULL, reporter_name TEXT NOT NULL, why TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, UNIQUE (room, msg, reporter))`),
  ])).then(() => db.prepare("ALTER TABLE members ADD COLUMN chat_mute INTEGER NOT NULL DEFAULT 0").run().catch(() => null))
    .catch((e) => { reportsReady.delete(db); throw e; }));
  return p;
}

// ── the worker's side ────────────────────────────────────────────────────────
const stub = (env: ChatEnv, room: RoomId) => env.CHAT!.get(env.CHAT!.idFromName(room));
const roomCall = (env: ChatEnv, room: RoomId, path: string, init: RequestInit = {}) =>
  stub(env, room).fetch(`https://chat/${room}${path}`, { ...init, headers: { ...(init.headers as any || {}), "X-Chat-Room": room } });
const fromSite = (origin: string | null) => !origin || /^https:\/\/(www\.)?arab-wrestling\.com$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");

/** The member as the room shows them */
async function whoFor(env: ChatEnv, request: Request): Promise<Who | null> {
  const m: any = await memberOf(request, env as any);
  if (!m || !env.ANALYTICS) return null;
  await ensureReports(env.ANALYTICS);
  const mute = await env.ANALYTICS.prepare("SELECT chat_mute FROM members WHERE id = ?1").bind(m.id).first<{ chat_mute: number }>();
  return {
    uid: m.id, user: m.username, name: m.official ? MOD_NAME : (m.display || m.username), pic: m.official ? "official" : m.pic,
    // the site's account: gold; a premium member: «premium» (the blue badge and a name that stands out); else blue if given
    badge: m.official ? "gold" : Number(m.premium_until) > Date.now() ? "premium" : m.badge === 0 ? "" : "blue", mod: !!m.official, mute: Number(mute?.chat_mute || 0),
  };
}

export async function handleChat(request: Request, env: ChatEnv, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = url.pathname;

  if (path === "/chat/rooms" && request.method === "GET") {
    if (!env.CHAT) return reply({ rooms: ROOMS.map(id => ({ id, online: 0, today: 0, lastId: 0, last: null })) });
    const rooms = await Promise.all(ROOMS.map(async id => {
      try { return { id, ...(await (await roomCall(env, id, "/summary")).json() as any) }; } catch { return { id, online: 0, today: 0, lastId: 0, last: null }; }
    }));
    return reply({ rooms }, 200, { "Cache-Control": "public, max-age=5" });
  }

  if (path === "/chat/ticket" && request.method === "POST") {
    const who = await whoFor(env, request);
    if (!who) return reply({ ok: false, signedOut: true, error: "سجّل دخولك لتنضم إلى المجتمع." }, 401);
    const ticket = rnd() + rnd();
    await env.PUSH_KV.put(`chat:t:${ticket}`, JSON.stringify(who), { expirationTtl: 60 });
    return reply({ ok: true, ticket, me: { uid: who.uid, name: who.name, pic: who.pic, badge: who.badge, mod: who.mod } });
  }

  const ws = path.match(/^\/chat\/ws\/([a-z]+)$/);
  if (ws && request.method === "GET") {
    if (!isRoom(ws[1]) || !env.CHAT) return new Response("no such room", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    if (!fromSite(request.headers.get("Origin"))) return new Response("forbidden", { status: 403 });
    const ticket = String(url.searchParams.get("ticket") || "");
    if (!/^[a-f0-9]{48}$/.test(ticket)) return new Response("no ticket", { status: 401 });
    const raw = await env.PUSH_KV.get(`chat:t:${ticket}`);
    if (!raw) return new Response("ticket expired", { status: 401 });
    await env.PUSH_KV.delete(`chat:t:${ticket}`);
    return stub(env, ws[1]).fetch(new Request(`https://chat/${ws[1]}/ws`, {
      headers: { Upgrade: "websocket", "X-Chat-Room": ws[1], "X-Chat-User": encodeURIComponent(raw) },
    }));
  }

  // the site's own account, from inside a room: a member stopped from writing (as the panel does)
  if (path === "/chat/mod/mute" && request.method === "POST") {
    const who = await whoFor(env, request);
    if (!who?.mod) return reply({ ok: false, error: "هذا لحساب الموقع الرسمي فقط." }, 403);
    const b: any = await request.json().catch(() => ({}));
    const r = await studioChatMute(env, b.uid, b.hours);
    return reply({ ok: r.success, error: (r as any).error, until: (r as any).until }, r.success ? 200 : 400);
  }

  if (path === "/chat/upload" && request.method === "POST") {
    const who = await whoFor(env, request);
    if (!who) return reply({ ok: false, signedOut: true, error: "سجّل دخولك أولًا." }, 401);
    if (who.mute > Date.now()) return reply({ ok: false, error: "لا يمكنك الإرسال في المجتمع الآن." }, 403);
    const room = url.searchParams.get("room");
    const kind = url.searchParams.get("kind");
    if (!isRoom(room) || !["image", "voice", "file"].includes(String(kind)) || !env.MEDIA) return reply({ ok: false, error: "تعذّر الرفع." }, 400);
    const count = Number(await env.PUSH_KV.get(`chat:up:${who.uid}`) || 0);
    // a premium member sends more, and bigger files
    const prem = who.badge === "premium" || who.mod;
    if (count >= (prem ? 100 : 40)) return reply({ ok: false, error: "رفعت ملفات كثيرة، حاول بعد ساعة." }, 429);
    const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    const fileName = (() => { try { return decodeURIComponent(request.headers.get("X-File-Name") || ""); } catch { return ""; } })().replace(/[\\/\u0000-\u001f]/g, "").slice(0, 120);
    let ext = "", ctype = "", max = 0;
    if (kind === "image") { ext = IMAGE_TYPES[type] || ""; ctype = type; max = LIMITS.image; }
    else if (kind === "voice") { ext = VOICE_TYPES[type] || ""; ctype = type; max = LIMITS.voice; }
    else { ext = (fileName.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase(); ctype = FILE_TYPES[ext] || ""; max = prem ? LIMITS.file * 2 : LIMITS.file; if (!ctype) ext = ""; }
    if (!ext) return reply({ ok: false, error: kind === "file" ? "هذا النوع من الملفات غير مسموح. المسموح: PDF وWord وExcel وPowerPoint وZIP والفيديو والصوت." : "نوع الملف غير مدعوم." }, 415);
    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > max) return reply({ ok: false, error: `الملف كبير، الحد الأقصى ${Math.round(max / 1024 / 1024)} ميجابايت.` }, 413);
    const body = new Uint8Array(await request.arrayBuffer());
    if (!body.length || body.length > max) return reply({ ok: false, error: `الملف كبير، الحد الأقصى ${Math.round(max / 1024 / 1024)} ميجابايت.` }, 413);
    const d = new Date();
    const key = `chat/${room}/${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}/${rnd()}.${ext}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: ctype }, customMetadata: { uid: String(who.uid), name: fileName } });
    await env.PUSH_KV.put(`chat:up:${who.uid}`, String(count + 1), { expirationTtl: 3600 });
    const out: Att = { kind: kind === "file" && /^video\//.test(ctype) ? "video" : kind as Att["kind"], url: MEDIA_PREFIX + key, size: body.length, mime: ctype };
    if (fileName) out.name = fileName;
    return reply({ ok: true, att: out });
  }

  if (path.startsWith("/chat/media/chat/") && (request.method === "GET" || request.method === "HEAD")) {
    const key = path.slice("/chat/media/".length);
    if (!/^chat\/[a-z]+\/\d{6}\/[a-f0-9]{24}\.[a-z0-9]{1,5}$/.test(key) || !env.MEDIA) return new Response("not found", { status: 404 });
    const obj: any = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers } as any);
    if (!obj) return new Response("not found", { status: 404 });
    const ctype = String(obj.httpMetadata?.contentType || "application/octet-stream");
    const inline = /^(image|audio|video)\//.test(ctype);
    const name = String(obj.customMetadata?.name || key.split("/").pop());
    const h = new Headers({
      "Content-Type": ctype, "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    if (obj.etag) h.set("ETag", obj.httpEtag || `"${obj.etag}"`);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
    if (request.headers.has("Range") && obj.range && typeof obj.range.offset === "number") {
      const end = obj.range.offset + (obj.range.length ?? obj.size - obj.range.offset) - 1;
      h.set("Content-Range", `bytes ${obj.range.offset}-${end}/${obj.size}`);
      h.set("Content-Length", String(end - obj.range.offset + 1));
      return new Response(request.method === "HEAD" ? null : obj.body, { status: 206, headers: h });
    }
    h.set("Content-Length", String(obj.size));
    return new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers: h });
  }

  return reply({ ok: false, error: "not found" }, 404);
}

// ── the panel ────────────────────────────────────────────────────────────────
export async function studioChat(env: ChatEnv, now = Date.now()) {
  const rooms = env.CHAT ? await Promise.all(ROOMS.map(async id => {
    try { return { id, ...(await (await roomCall(env, id, "/summary")).json() as any) }; } catch { return { id, online: 0, today: 0, lastId: 0, last: null }; }
  })) : ROOMS.map(id => ({ id, online: 0, today: 0, lastId: 0, last: null }));
  let reports: any[] = [], muted: any[] = [];
  if (env.ANALYTICS) {
    await ensureMembers(env.ANALYTICS);
    await ensureReports(env.ANALYTICS);
    const [r, m] = await env.ANALYTICS.batch([
      env.ANALYTICS.prepare("SELECT * FROM chat_reports WHERE done = 0 ORDER BY at DESC LIMIT 200"),
      env.ANALYTICS.prepare("SELECT id, username, display, pic, chat_mute FROM members WHERE chat_mute > ?1 ORDER BY chat_mute DESC").bind(now),
    ]) as any[];
    reports = r.results || []; muted = m.results || [];
  }
  return { success: true, rooms, reports, muted };
}
export async function studioChatRoom(env: ChatEnv, room: unknown, before = 0) {
  if (!isRoom(room) || !env.CHAT) return { success: false, error: "الغرفة دي مش موجودة." };
  const r: any = await (await roomCall(env, room, "/admin", { method: "POST", body: JSON.stringify({ op: "recent", n: 150, before }) })).json();
  return { success: true, msgs: r.msgs || [] };
}
export async function studioChatDelete(env: ChatEnv, room: unknown, id: unknown) {
  if (!isRoom(room) || !env.CHAT) return { success: false, error: "الغرفة دي مش موجودة." };
  const r: any = await (await roomCall(env, room, "/admin", { method: "POST", body: JSON.stringify({ op: "delete", id: Number(id) || 0 }) })).json();
  if (env.ANALYTICS) { await ensureReports(env.ANALYTICS); await env.ANALYTICS.prepare("UPDATE chat_reports SET done = 1 WHERE room = ?1 AND msg = ?2").bind(room, Number(id) || 0).run(); }
  return r.ok ? { success: true } : { success: false, error: "الرسالة دي اتمسحت قبل كده." };
}
export async function studioChatMute(env: ChatEnv, uid: unknown, hours: unknown, now = Date.now()) {
  const id = Number(uid) || 0;
  const h = Math.max(0, Math.min(24 * 365, Number(hours) || 0));
  const until = h ? now + h * 3_600_000 : 0;
  if (!env.ANALYTICS) return { success: false, error: "مش متاح دلوقتي." };
  await ensureMembers(env.ANALYTICS);
  await ensureReports(env.ANALYTICS);
  const r = await env.ANALYTICS.prepare("UPDATE members SET chat_mute = ?1 WHERE id = ?2 AND official = 0").bind(until, id).run();
  if (!r.meta?.changes) return { success: false, error: "العضو ده مش موجود." };
  if (env.CHAT) await Promise.all(ROOMS.map(room => roomCall(env, room, "/admin", { method: "POST", body: JSON.stringify({ op: "mute", uid: id, until }) }).catch(() => null)));
  return { success: true, until };
}
/** A stopped member leaves every room at once */
export async function chatKick(env: ChatEnv, uid: unknown) {
  if (!env.CHAT) return;
  await Promise.all(ROOMS.map(room => roomCall(env, room, "/admin", { method: "POST", body: JSON.stringify({ op: "kick", uid: Number(uid) || 0 }) }).catch(() => null)));
}
export async function studioChatDismiss(env: ChatEnv, id: unknown) {
  if (!env.ANALYTICS) return { success: false };
  await ensureReports(env.ANALYTICS);
  await env.ANALYTICS.prepare("UPDATE chat_reports SET done = 1 WHERE id = ?1").bind(Number(id) || 0).run();
  return { success: true };
}
