// The site's members (owner 2026-10-14: «نظام التسجيل للمتابعيين … اسم المستخدم والايميل والباسورد … كود كابتشا سهل
// وبسيط … ولما المتابع يسجل دخول يقدر انه يعمل متابعة للقسم ال هو عايزه»). Accounts live in the site's D1 database
// (tables made here on first use), passwords as PBKDF2 hashes (the panel's own, worker/src/studio.ts), sessions as
// the hash of a random token the browser keeps (the site and the worker are on different domains: no cookie).
//
//   GET  /members/captcha            a 4-digit picture drawn as strokes (no text a bot could read), one use, 10 minutes
//   POST /members/signup             {username, email, password, captcha:{id, answer}, website} → {token, member, recovery}
//   POST /members/login              {login (username or email), password} → {token, member}
//   POST /members/logout             the session ends
//   GET  /members/me                 the member, from the session
//   POST /members/profile            {display, pic, fav_fed, fav_star, bio}
//   POST /members/password           {current, password}
//   POST /members/recover            {login, code, password}: the recovery code given at sign-up (then a new one)
//   POST /members/forgot             {email}: a link to set a new password (when the site can send mail)
//   POST /members/reset              {token, password}
//   POST /members/verify             {token}: the e-mail confirmed
//   POST /members/verify-again       a new confirmation mail
//   GET  /members/u/<username>       a member's public page: name, picture, since when, favourites, comments
//   GET  /api/studio/members         the panel: every member (perm «members»)
//   POST /api/studio/members/ban     {id, on}
//
// Mail goes through Resend when the worker has RESEND_API_KEY (the owner adds it in Cloudflare); without it, sign-up
// works the same and the recovery code is the way back in.
import { hashPassword, verifyPassword } from "./studio";
import { ensureTable as ensureComments, isReservedName, WRESTLER_PIC, OFFICIAL_NAME } from "./comments";

export interface MembersEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; RESEND_API_KEY?: string }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });
const SITE = "https://arab-wrestling.com";
const DAY = 86_400_000;
const SESSION_DAYS = 90;

// ── tables ──────────────────────────────────────────────────────────────────
const ready = new WeakMap<D1Database, Promise<unknown>>();
export function ensureMembers(db: D1Database): Promise<unknown> {
  let p = ready.get(db);
  if (!p) ready.set(db, p = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, ukey TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL, recovery TEXT NOT NULL DEFAULT '',
      display TEXT NOT NULL DEFAULT '', pic TEXT NOT NULL DEFAULT '', fav_fed TEXT NOT NULL DEFAULT '', fav_star TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '')`),
    db.prepare("CREATE TABLE IF NOT EXISTS member_sessions (token TEXT PRIMARY KEY, member INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_sessions_member ON member_sessions (member)"),
    db.prepare("CREATE TABLE IF NOT EXISTS member_tokens (token TEXT PRIMARY KEY, member INTEGER NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL)"),
  ])
    // the site's own account (owner 2026-10-14: «اعملي عضوية بتاعتي … موثقة العلامة الذهبي»): added to older tables
    .then(() => db.prepare("ALTER TABLE members ADD COLUMN official INTEGER NOT NULL DEFAULT 0").run().catch(() => null))
    // the blue badge: every member gets it, the owner can take it away or give it back (owner 2026-10-14: «ادي العلامة
    // الزرقاء التوثيق لاي حد او اشيله من عند اي حد»)
    .then(() => db.prepare("ALTER TABLE members ADD COLUMN badge INTEGER NOT NULL DEFAULT 1").run().catch(() => null))
    .catch((e) => { ready.delete(db); throw e; }));
  return p;
}

// ── small helpers ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
function b64url(bytes: Uint8Array): string { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`arw-members|${s}`)));
  return Array.from(d, b => b.toString(16).padStart(2, "0")).join("");
}
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
// Arabic-Indic and Persian digits typed on an Arabic keyboard count as the same digits
export const latinDigits = (s: string) => String(s || "").replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));

/** A username: 3–20 letters (Arabic or Latin), digits, «_» or «.», starting with a letter */
export function usernameProblem(u: string, official = false): string | null {
  if (u.length < 3) return "اسم المستخدم قصير، اكتب 3 حروف على الأقل.";
  if (u.length > 20) return "اسم المستخدم طويل، 20 حرفًا على الأكثر.";
  if (!/^[A-Za-zء-ي][A-Za-z0-9ء-ي٠-٩_.]*$/.test(u)) return "اسم المستخدم يبدأ بحرف، ويكون من حروف وأرقام فقط (ومسموح بـ _ و .).";
  if (official) return null;
  if (isReservedName(u) || /^(admin|administrator|moderator|support|root|arw|arabwrestling|staff|team|official|system)$/i.test(u) || /^(مدير|المدير|الإدارة|الادارة|ادمن|أدمن|الدعم)$/.test(u)) return "هذا الاسم غير متاح، اختر اسمًا آخر.";
  return null;
}
export function passwordProblem(p: string, username = ""): string | null {
  if (typeof p !== "string" || p.length < 8) return "كلمة المرور 8 حروف على الأقل.";
  if (p.length > 200) return "كلمة المرور طويلة جدًا.";
  if (!/[A-Za-zء-ي]/.test(p) || !/[0-9٠-٩]/.test(p)) return "اجعل كلمة المرور فيها حروف وأرقام.";
  if (username && p.toLowerCase().includes(username.toLowerCase())) return "لا تجعل اسم المستخدم جزءًا من كلمة المرور.";
  return null;
}
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
const ukeyOf = (u: string) => u.normalize("NFKC").toLowerCase();

type Member = { id: number; username: string; email: string; salt: string; hash: string; iterations: number; recovery: string; display: string; pic: string; fav_fed: string; fav_star: string; bio: string; verified: number; banned: number; created: number; last_seen: number; official?: number; badge?: number };
/** What the member's own pages see (never the hashes) */
const mine = (m: Member) => ({ id: m.id, username: m.username, email: m.email, display: m.official ? OFFICIAL_NAME : (m.display || m.username), pic: m.official ? "official" : m.pic, fav_fed: m.fav_fed, fav_star: m.fav_star, bio: m.bio, verified: !!m.verified, created: m.created, official: !!m.official, blue: !m.official && m.badge !== 0 });

// ── rate limits (KV counters with their own expiry) ───────────────────────────
async function tooMany(kv: KVNamespace, key: string, max: number, _windowSec: number): Promise<boolean> {
  const n = Number((await kv.get(`members:rl:${key}`)) || 0);
  return n >= max;
}
async function count(kv: KVNamespace, key: string, windowSec: number) {
  const n = Number((await kv.get(`members:rl:${key}`)) || 0);
  await kv.put(`members:rl:${key}`, String(n + 1), { expirationTtl: Math.max(60, windowSec) });
}

// ── the captcha ──────────────────────────────────────────────────────────────
// Digits 2–9 (no 0/1, too like O and l), each drawn as a stroke on a 10×16 grid, turned and moved a little, over a
// few lines of noise. No <text>: a bot reading the SVG finds only curves.
const GLYPHS: Record<string, number[][]> = {
  "2": [[0, 4], [2, 1], [5, 0], [8, 1], [10, 4], [9, 7], [0, 16], [10, 16]],
  "3": [[0, 2], [3, 0], [7, 0], [9, 2], [9, 5], [7, 7.5], [4, 8], [7, 8.5], [10, 11], [10, 13], [8, 15.5], [4, 16], [1, 15], [0, 13]],
  "4": [[7, 16], [7, 0], [0, 11], [10, 11]],
  "5": [[10, 0], [1, 0], [0, 7], [5, 6], [9, 8], [10, 12], [8, 15], [4, 16], [0, 14]],
  "6": [[9, 1], [5, 0], [2, 2], [0, 8], [0, 12], [2, 15], [5, 16], [8, 15], [10, 12], [9, 9], [6, 8], [3, 8], [0, 11]],
  "7": [[0, 0], [10, 0], [4, 16]],
  "8": [[5, 8], [2, 6], [1, 3], [3, 0.5], [5, 0], [7, 0.5], [9, 3], [8, 6], [5, 8], [1, 10], [0, 13], [2, 15.5], [5, 16], [8, 15.5], [10, 13], [9, 10], [5, 8]],
  "9": [[10, 7], [7, 8], [4, 8], [1, 6], [0, 3], [2, 0.5], [5, 0], [8, 0.5], [10, 4], [10, 8], [9, 13], [6, 16], [2, 15]],
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export function captchaSvg(answer: string): string {
  const W = 168, H = 60;
  const inks = ["#0e9594", "#1e2530", "#c0603a", "#3866c7", "#7c6ee8"];
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="رمز التحقق">`;
  for (let i = 0; i < 5; i++) {
    out += `<path d="M${rnd(0, 30).toFixed(1)} ${rnd(5, H - 5).toFixed(1)} Q ${rnd(40, 120).toFixed(1)} ${rnd(-10, H + 10).toFixed(1)} ${rnd(W - 30, W).toFixed(1)} ${rnd(5, H - 5).toFixed(1)}" fill="none" stroke="${inks[i % inks.length]}" stroke-opacity="0.22" stroke-width="${rnd(1, 2.2).toFixed(1)}"/>`;
  }
  for (let i = 0; i < 18; i++) out += `<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="${rnd(0.8, 1.8).toFixed(1)}" fill="${inks[i % inks.length]}" fill-opacity="0.3"/>`;
  [...answer].forEach((d, i) => {
    const sx = rnd(2.0, 2.3), sy = rnd(2.2, 2.5);
    const x0 = 20 + i * 34 + rnd(-3, 3), y0 = 11 + rnd(-3, 3), rot = rnd(-16, 16);
    const pts = GLYPHS[d].map(([x, y]) => `${(x0 + x * sx + rnd(-0.5, 0.5)).toFixed(1)},${(y0 + y * sy + rnd(-0.5, 0.5)).toFixed(1)}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="${inks[Math.floor(Math.random() * 2) ? 0 : 1]}" stroke-width="${rnd(3, 3.8).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${rot.toFixed(1)} ${x0 + 11} ${y0 + 18})"/>`;
  });
  return out + "</svg>";
}
export async function newCaptcha(kv: KVNamespace): Promise<{ id: string; svg: string }> {
  const digits = Object.keys(GLYPHS);
  const answer = Array.from({ length: 4 }, () => digits[Math.floor(Math.random() * digits.length)]).join("");
  const id = randomToken().slice(0, 22);
  await kv.put(`members:cap:${id}`, answer, { expirationTtl: 600 });
  return { id, svg: captchaSvg(answer) };
}
/** One try per picture: right or wrong, it's gone */
export async function checkCaptcha(kv: KVNamespace, cap: any): Promise<boolean> {
  const id = String(cap?.id || "");
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return false;
  const answer = await kv.get(`members:cap:${id}`);
  if (!answer) return false;
  await kv.delete(`members:cap:${id}`);
  return latinDigits(String(cap?.answer || "")).replace(/\s+/g, "") === answer;
}

// ── mail ──────────────────────────────────────────────────────────────────────
export function mailHtml(title: string, lines: string[], button?: { text: string; href: string }, after = ""): string {
  const p = lines.map(l => `<p style="margin:0 0 14px;font-size:16px;line-height:1.9;color:#3b4250">${l}</p>`).join("");
  const b = button ? `<p style="margin:26px 0 22px;text-align:center"><a href="${button.href}" style="display:inline-block;background:#0e9594;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 32px;border-radius:12px">${button.text}</a></p>` : "";
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#faf7f0;font-family:Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf7f0;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #ece6d8;border-radius:18px;overflow:hidden">
<tr><td style="background:#0e9594;padding:22px 26px;text-align:right"><img src="${SITE}/assets/brand-logo.png" width="44" height="44" alt="" style="vertical-align:middle;border-radius:10px"> <span style="color:#ffffff;font-weight:800;font-size:20px;vertical-align:middle;margin-right:8px">عرب راسلنج</span></td></tr>
<tr><td style="padding:30px 28px 10px;text-align:right"><h1 style="margin:0 0 16px;font-size:21px;color:#1e2530">${title}</h1>${p}${b}${after}</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #f1ece0;text-align:right;font-size:13px;color:#8a8f9b;line-height:1.8">وصلتك هذه الرسالة لأن عنوان بريدك استُخدم في موقع <a href="${SITE}" style="color:#0e9594;text-decoration:none">عرب راسلنج</a>. إن لم تكن أنت، تجاهلها.</td></tr>
</table></td></tr></table></body></html>`;
}
export async function sendMail(env: MembersEnv, to: string, subject: string, html: string, f: typeof fetch = fetch): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "عرب راسلنج <no-reply@arab-wrestling.com>", to: [to], reply_to: "contact@arab-wrestling.com", subject, html }),
    });
    return r.ok;
  } catch { return false; }
}
async function mailToken(db: D1Database, member: number, kind: "verify" | "reset", hours: number, now: number): Promise<string> {
  const t = randomToken();
  await db.batch([
    db.prepare("DELETE FROM member_tokens WHERE member = ?1 AND kind = ?2").bind(member, kind),
    db.prepare("INSERT INTO member_tokens (token, member, kind, expires) VALUES (?1, ?2, ?3, ?4)").bind(await sha(t), member, kind, now + hours * 3_600_000),
  ]);
  return t;
}
async function sendVerify(env: MembersEnv, db: D1Database, m: Member, now: number) {
  if (!env.RESEND_API_KEY) return false;
  const t = await mailToken(db, m.id, "verify", 72, now);
  return sendMail(env, m.email, "أكّد بريدك في عرب راسلنج", mailHtml(`أهلًا بك يا ${esc(m.display || m.username)} 👋`, [
    "سعداء بانضمامك إلى عرب راسلنج.",
    "بقيت خطوة صغيرة: أكّد بريدك بالضغط على الزر، وبعدها يمكنك استرجاع حسابك به إذا نسيت كلمة المرور.",
  ], { text: "تأكيد البريد", href: `${SITE}/account/?verify=${t}` }));
}
const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ── sessions ──────────────────────────────────────────────────────────────────
async function startSession(db: D1Database, member: number, request: Request, now: number): Promise<string> {
  const t = `m_${randomToken()}`;
  await db.prepare("INSERT INTO member_sessions (token, member, created, expires, ua) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(await sha(t), member, now, now + SESSION_DAYS * DAY, String(request.headers.get("User-Agent") || "").slice(0, 200)).run();
  return t;
}
/** The member a request comes from (Authorization: Bearer m_…), or null; seen now */
export async function memberOf(request: Request, env: MembersEnv, now = Date.now()): Promise<Member | null> {
  const db = env.ANALYTICS;
  const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!db || !/^m_[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  await ensureMembers(db);
  const m = await db.prepare("SELECT m.* FROM member_sessions s JOIN members m ON m.id = s.member WHERE s.token = ?1 AND s.expires > ?2 AND m.banned = 0").bind(await sha(t), now).first<Member>();
  if (m && now - (m.last_seen || 0) > 3_600_000) await db.prepare("UPDATE members SET last_seen = ?1 WHERE id = ?2").bind(now, m.id).run();
  return m || null;
}
/** A recovery code: 3 groups of 4 (letters and digits that can't be mistaken) */
function recoveryCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(b, x => A[x % A.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const cleanCode = (c: unknown) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ── the routes ────────────────────────────────────────────────────────────────
export async function handleMembers(request: Request, env: MembersEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "الحسابات غير متاحة الآن." }, 503);
  await ensureMembers(db);
  const path = url.pathname.replace(/^\/members/, "") || "/";
  const ip = String(request.headers.get("CF-Connecting-IP") || "");
  const body: any = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (path === "/captcha" && request.method === "GET") return reply(await newCaptcha(env.PUSH_KV));

  if (path === "/signup" && request.method === "POST") {
    if (String(body.website || "")) return reply({ ok: false, error: "تعذّر إنشاء الحساب." }, 400);
    if (await tooMany(env.PUSH_KV, `su:${ip}`, 5, 3600)) return reply({ ok: false, error: "أنشأت حسابات كثيرة من هذا الجهاز، حاول بعد ساعة." }, 429);
    const username = String(body.username || "").normalize("NFC").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const bad = usernameProblem(username) || (!EMAIL.test(email) ? "اكتب بريدًا إلكترونيًا صحيحًا." : null) || passwordProblem(password, username);
    if (bad) return reply({ ok: false, error: bad }, 400);
    if (!(await checkCaptcha(env.PUSH_KV, body.captcha))) return reply({ ok: false, error: "رمز التحقق غير صحيح، جرّب الرمز الجديد.", captcha: true }, 400);
    const taken = await db.prepare("SELECT ukey = ?1 AS u, email = ?2 AS e FROM members WHERE ukey = ?1 OR email = ?2 LIMIT 1").bind(ukeyOf(username), email).first<{ u: number; e: number }>();
    if (taken?.u) return reply({ ok: false, error: "اسم المستخدم مستخدم من قبل، اختر اسمًا آخر.", field: "username" }, 409);
    if (taken?.e) return reply({ ok: false, error: "هذا البريد له حساب بالفعل، سجّل دخولك.", field: "email" }, 409);
    const { salt, hash, iterations } = await hashPassword(password);
    const code = recoveryCode();
    const country = String((request as any).cf?.country || "").slice(0, 2).toUpperCase();
    const ins = await db.prepare(`INSERT INTO members (username, ukey, email, salt, hash, iterations, recovery, display, created, last_seen, ip, country)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?1, ?8, ?8, ?9, ?10) RETURNING *`).bind(username, ukeyOf(username), email, salt, hash, iterations, await sha(cleanCode(code)), now, ip, country).first<Member>();
    if (!ins) return reply({ ok: false, error: "تعذّر إنشاء الحساب، حاول مرة أخرى." }, 500);
    await count(env.PUSH_KV, `su:${ip}`, 3600);
    const token = await startSession(db, ins.id, request, now);
    const mailed = await sendVerify(env, db, ins, now).catch(() => false);
    return reply({ ok: true, token, member: mine(ins), recovery: code, mailed });
  }

  if (path === "/login" && request.method === "POST") {
    const login = String(body.login || "").trim();
    const key = login.includes("@") ? login.toLowerCase() : ukeyOf(login);
    if (await tooMany(env.PUSH_KV, `li:${ip}`, 12, 900) || await tooMany(env.PUSH_KV, `la:${key}`, 8, 900)) return reply({ ok: false, error: "محاولات كثيرة، انتظر ربع ساعة ثم حاول مرة أخرى." }, 429);
    const m = await db.prepare("SELECT * FROM members WHERE ukey = ?1 OR email = ?1 LIMIT 1").bind(key).first<Member>();
    if (!m || !(await verifyPassword(String(body.password || ""), m))) {
      await count(env.PUSH_KV, `li:${ip}`, 900); await count(env.PUSH_KV, `la:${key}`, 900);
      return reply({ ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." }, 401);
    }
    if (m.banned) return reply({ ok: false, error: "هذا الحساب موقوف. للاستفسار راسلنا من صفحة تواصل معنا." }, 403);
    const token = await startSession(db, m.id, request, now);
    await db.prepare("UPDATE members SET last_seen = ?1 WHERE id = ?2").bind(now, m.id).run();
    return reply({ ok: true, token, member: mine(m) });
  }

  if (path === "/recover" && request.method === "POST") {
    const login = String(body.login || "").trim();
    const key = login.includes("@") ? login.toLowerCase() : ukeyOf(login);
    if (await tooMany(env.PUSH_KV, `rc:${ip}`, 8, 3600)) return reply({ ok: false, error: "محاولات كثيرة، حاول بعد ساعة." }, 429);
    const m = await db.prepare("SELECT * FROM members WHERE ukey = ?1 OR email = ?1 LIMIT 1").bind(key).first<Member>();
    const ok = !!m && !m.banned && m.recovery === await sha(cleanCode(body.code));
    if (!ok) { await count(env.PUSH_KV, `rc:${ip}`, 3600); return reply({ ok: false, error: "البيانات غير صحيحة، تأكد من اسم المستخدم وكود الاسترجاع." }, 400); }
    const bad = passwordProblem(String(body.password || ""), m!.username);
    if (bad) return reply({ ok: false, error: bad }, 400);
    const { salt, hash, iterations } = await hashPassword(String(body.password));
    const code = recoveryCode();
    await db.batch([
      db.prepare("UPDATE members SET salt = ?1, hash = ?2, iterations = ?3, recovery = ?4 WHERE id = ?5").bind(salt, hash, iterations, await sha(cleanCode(code)), m!.id),
      db.prepare("DELETE FROM member_sessions WHERE member = ?1").bind(m!.id),
    ]);
    const token = await startSession(db, m!.id, request, now);
    return reply({ ok: true, token, member: mine(m!), recovery: code });
  }

  if (path === "/forgot" && request.method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!env.RESEND_API_KEY) return reply({ ok: false, error: "استرجاع الحساب بالبريد غير متاح الآن، استخدم كود الاسترجاع.", nomail: true }, 503);
    if (await tooMany(env.PUSH_KV, `fg:${ip}`, 5, 3600)) return reply({ ok: false, error: "طلبات كثيرة، حاول بعد ساعة." }, 429);
    await count(env.PUSH_KV, `fg:${ip}`, 3600);
    const m = EMAIL.test(email) ? await db.prepare("SELECT * FROM members WHERE email = ?1 AND banned = 0").bind(email).first<Member>() : null;
    if (m) {
      const t = await mailToken(db, m.id, "reset", 2, now);
      await sendMail(env, m.email, "تغيير كلمة المرور في عرب راسلنج", mailHtml("تغيير كلمة المرور", [
        `طلبت تغيير كلمة المرور لحسابك <b>${esc(m.username)}</b>.`,
        "اضغط على الزر واكتب كلمة المرور الجديدة. الرابط صالح لمدة ساعتين.",
      ], { text: "تغيير كلمة المرور", href: `${SITE}/account/?reset=${t}` }));
    }
    // the same answer either way: no one learns which addresses have an account
    return reply({ ok: true });
  }

  if (path === "/reset" && request.method === "POST") {
    const row = await db.prepare("SELECT t.member, t.expires, m.username FROM member_tokens t JOIN members m ON m.id = t.member WHERE t.token = ?1 AND t.kind = 'reset'").bind(await sha(String(body.token || ""))).first<{ member: number; expires: number; username: string }>();
    if (!row || row.expires < now) return reply({ ok: false, error: "الرابط انتهت صلاحيته، اطلب رابطًا جديدًا." }, 400);
    const bad = passwordProblem(String(body.password || ""), row.username);
    if (bad) return reply({ ok: false, error: bad }, 400);
    const { salt, hash, iterations } = await hashPassword(String(body.password));
    await db.batch([
      db.prepare("UPDATE members SET salt = ?1, hash = ?2, iterations = ?3, verified = 1 WHERE id = ?4").bind(salt, hash, iterations, row.member),
      db.prepare("DELETE FROM member_tokens WHERE member = ?1 AND kind = 'reset'").bind(row.member),
      db.prepare("DELETE FROM member_sessions WHERE member = ?1").bind(row.member),
    ]);
    const m = await db.prepare("SELECT * FROM members WHERE id = ?1").bind(row.member).first<Member>();
    return reply({ ok: true, token: await startSession(db, row.member, request, now), member: mine(m!) });
  }

  if (path === "/verify" && request.method === "POST") {
    const row = await db.prepare("SELECT member, expires FROM member_tokens WHERE token = ?1 AND kind = 'verify'").bind(await sha(String(body.token || ""))).first<{ member: number; expires: number }>();
    if (!row || row.expires < now) return reply({ ok: false, error: "رابط التأكيد انتهت صلاحيته، اطلب رابطًا جديدًا من صفحة حسابك." }, 400);
    await db.batch([
      db.prepare("UPDATE members SET verified = 1 WHERE id = ?1").bind(row.member),
      db.prepare("DELETE FROM member_tokens WHERE member = ?1 AND kind = 'verify'").bind(row.member),
    ]);
    return reply({ ok: true });
  }

  if (path.startsWith("/u/") && request.method === "GET") {
    const u = decodeURIComponent(path.slice(3)).trim();
    const m = await db.prepare("SELECT id, username, display, pic, fav_fed, fav_star, bio, created, official, badge FROM members WHERE ukey = ?1 AND banned = 0").bind(ukeyOf(u)).first<any>();
    if (!m) return reply({ ok: false, error: "لا يوجد عضو بهذا الاسم." }, 404);
    await ensureComments(db);
    const c = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE member = ?1 AND deleted = 0").bind(m.id).first<{ n: number }>();
    return reply({ ok: true, member: { username: m.username, display: m.official ? OFFICIAL_NAME : (m.display || m.username), pic: m.official ? "official" : m.pic, official: !!m.official, blue: !m.official && m.badge !== 0, fav_fed: m.fav_fed, fav_star: m.fav_star, bio: m.bio, created: m.created, comments: c?.n || 0 } });
  }

  // ── the member's own ──
  const me = await memberOf(request, env, now);
  if (!me) return reply({ ok: false, error: "سجّل دخولك أولًا.", signedOut: true }, 401);

  if (path === "/me" && request.method === "GET") return reply({ ok: true, member: mine(me), mail: !!env.RESEND_API_KEY });

  if (path === "/logout" && request.method === "POST") {
    const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    await db.prepare("DELETE FROM member_sessions WHERE token = ?1").bind(await sha(t)).run();
    return reply({ ok: true });
  }

  if (path === "/profile" && request.method === "POST") {
    if (me.official) { body.display = me.display; body.pic = me.pic; }
    const display = String(body.display ?? me.display).normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 30);
    if (display.length < 2) return reply({ ok: false, error: "الاسم الظاهر حرفان على الأقل." }, 400);
    if (isReservedName(display) && !me.official) return reply({ ok: false, error: "هذا الاسم خاص بالحساب الرسمي للموقع، اختر اسمًا آخر." }, 400);
    const pic = String(body.pic ?? me.pic);
    const okPic = pic === "" || WRESTLER_PIC.test(pic) || /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(pic);
    const fav_fed = /^(WWE|AEW|NJPW|TNA|ROH|MLP|MLW|CMLL|AAA|UFC|STARDOM|NOAH|)$/.test(String(body.fav_fed ?? me.fav_fed)) ? String(body.fav_fed ?? me.fav_fed) : me.fav_fed;
    const fav_star = String(body.fav_star ?? me.fav_star).replace(/\s+/g, " ").trim().slice(0, 40);
    const bio = String(body.bio ?? me.bio).replace(/\s+/g, " ").trim().slice(0, 160);
    await db.prepare("UPDATE members SET display = ?1, pic = ?2, fav_fed = ?3, fav_star = ?4, bio = ?5 WHERE id = ?6")
      .bind(display, okPic ? pic : me.pic, fav_fed, fav_star, bio, me.id).run();
    const m = await db.prepare("SELECT * FROM members WHERE id = ?1").bind(me.id).first<Member>();
    return reply({ ok: true, member: mine(m!) });
  }

  if (path === "/password" && request.method === "POST") {
    if (!(await verifyPassword(String(body.current || ""), me))) return reply({ ok: false, error: "كلمة المرور الحالية غير صحيحة." }, 400);
    const bad = passwordProblem(String(body.password || ""), me.username);
    if (bad) return reply({ ok: false, error: bad }, 400);
    const { salt, hash, iterations } = await hashPassword(String(body.password));
    const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    await db.batch([
      db.prepare("UPDATE members SET salt = ?1, hash = ?2, iterations = ?3 WHERE id = ?4").bind(salt, hash, iterations, me.id),
      // other devices are signed out; this one stays
      db.prepare("DELETE FROM member_sessions WHERE member = ?1 AND token != ?2").bind(me.id, await sha(t)),
    ]);
    return reply({ ok: true });
  }

  if (path === "/recovery" && request.method === "POST") {
    // a new recovery code (the old one stops working)
    if (!(await verifyPassword(String(body.current || ""), me))) return reply({ ok: false, error: "كلمة المرور غير صحيحة." }, 400);
    const code = recoveryCode();
    await db.prepare("UPDATE members SET recovery = ?1 WHERE id = ?2").bind(await sha(cleanCode(code)), me.id).run();
    return reply({ ok: true, recovery: code });
  }

  if (path === "/verify-again" && request.method === "POST") {
    if (me.verified) return reply({ ok: true, already: true });
    if (await tooMany(env.PUSH_KV, `va:${me.id}`, 3, 3600)) return reply({ ok: false, error: "أرسلنا رسائل كثيرة، انتظر قليلًا." }, 429);
    await count(env.PUSH_KV, `va:${me.id}`, 3600);
    const sent = await sendVerify(env, db, me, now);
    return sent ? reply({ ok: true }) : reply({ ok: false, error: "إرسال البريد غير متاح الآن." }, 503);
  }

  return reply({ ok: false, error: "not found" }, 404);
}

// ── the panel ─────────────────────────────────────────────────────────────────
export async function studioMembers(env: MembersEnv, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: true, items: [], counts: { total: 0, week: 0, today: 0, active: 0 } };
  await ensureMembers(db);
  await ensureComments(db);
  const [rows, total, week, active] = await db.batch([
    db.prepare(`SELECT m.id, m.username, m.display, m.email, m.pic, m.verified, m.banned, m.created, m.last_seen, m.country, m.ip, m.official, m.badge,
      (SELECT COUNT(*) FROM comments c WHERE c.member = m.id AND c.deleted = 0) AS comments FROM members m ORDER BY m.created DESC LIMIT 2000`),
    db.prepare("SELECT COUNT(*) AS n FROM members"),
    db.prepare("SELECT COUNT(*) AS n FROM members WHERE created > ?1").bind(now - 7 * DAY),
    db.prepare("SELECT COUNT(*) AS n FROM members WHERE last_seen > ?1").bind(now - 7 * DAY),
  ]) as any[];
  return { success: true, items: rows.results || [], counts: { total: total.results?.[0]?.n || (rows.results || []).length, week: week.results?.[0]?.n || 0, active: active.results?.[0]?.n || 0 } };
}
/** One member, everything the panel may know (never the password's hash or the recovery code): their details, their
 *  comments, the devices they're signed in on */
export async function studioMemberDetail(env: MembersEnv, id: unknown, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  await ensureComments(db);
  const m = await db.prepare(`SELECT id, username, email, display, pic, fav_fed, fav_star, bio, verified, banned, created, last_seen, ip, country, official, badge
    FROM members WHERE id = ?1`).bind(Number(id) || 0).first<any>();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  const [comments, sessions, hearts] = await db.batch([
    db.prepare("SELECT id, path, title, text, at, parent, hearted, deleted FROM comments WHERE member = ?1 ORDER BY at DESC LIMIT 200").bind(m.id),
    db.prepare("SELECT created, expires, ua FROM member_sessions WHERE member = ?1 AND expires > ?2 ORDER BY created DESC LIMIT 20").bind(m.id, now),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE member = ?1 AND hearted = 1 AND deleted = 0").bind(m.id),
  ]) as any[];
  return { success: true, member: m, comments: comments.results || [], sessions: sessions.results || [], hearts: hearts.results?.[0]?.n || 0 };
}
/** The site's own account (owner 2026-10-14: «اعملي عضوية بتاعتي … موثقة العلامة الذهبي … زي ال انت عاملهالي في اللوحة»):
 *  a member that signs in on the site like any other, but shows as «عرب راسلنج» with the logo and the gold badge, and
 *  its comments are the site's own (official = 1), exactly as the panel's replies. Made and changed by the owner only. */
export async function studioOfficialAccount(env: MembersEnv, body: any = null, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const cur = await db.prepare("SELECT * FROM members WHERE official = 1 ORDER BY id LIMIT 1").first<Member>();
  const view = (m: Member | null) => m ? { id: m.id, username: m.username, email: m.email, created: m.created, last_seen: m.last_seen } : null;
  if (!body) return { success: true, account: view(cur) };
  const username = String(body.username ?? cur?.username ?? "").normalize("NFC").trim();
  const email = String(body.email ?? cur?.email ?? "").trim().toLowerCase();
  const password = String(body.password || "");
  const bad = usernameProblem(username, true) || (!EMAIL.test(email) ? "اكتب إيميل صحيح." : null) || (password || !cur ? passwordProblem(password, username) : null);
  if (bad) return { success: false, error: bad };
  const taken = await db.prepare("SELECT ukey = ?1 AS u, email = ?2 AS e FROM members WHERE (ukey = ?1 OR email = ?2) AND id != ?3 LIMIT 1").bind(ukeyOf(username), email, cur?.id || 0).first<{ u: number; e: number }>();
  if (taken?.u) return { success: false, error: "اسم المستخدم ده مستخدم لعضو تاني." };
  if (taken?.e) return { success: false, error: "الإيميل ده عليه حساب عضو تاني." };
  if (!cur) {
    const { salt, hash, iterations } = await hashPassword(password);
    const ins = await db.prepare(`INSERT INTO members (username, ukey, email, salt, hash, iterations, display, pic, verified, official, created, last_seen)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'official', 1, 1, ?8, 0) RETURNING *`).bind(username, ukeyOf(username), email, salt, hash, iterations, OFFICIAL_NAME, now).first<Member>();
    return { success: true, account: view(ins), created: true };
  }
  const steps = [db.prepare("UPDATE members SET username = ?1, ukey = ?2, email = ?3, display = ?4, pic = 'official', verified = 1, banned = 0 WHERE id = ?5").bind(username, ukeyOf(username), email, OFFICIAL_NAME, cur.id)];
  if (password) {
    const { salt, hash, iterations } = await hashPassword(password);
    steps.push(db.prepare("UPDATE members SET salt = ?1, hash = ?2, iterations = ?3 WHERE id = ?4").bind(salt, hash, iterations, cur.id));
    // a new password: out of the account everywhere
    steps.push(db.prepare("DELETE FROM member_sessions WHERE member = ?1").bind(cur.id));
  }
  await db.batch(steps);
  const m = await db.prepare("SELECT * FROM members WHERE id = ?1").bind(cur.id).first<Member>();
  return { success: true, account: view(m) };
}
/** The blue badge on a member, on or off (the owner's call; the site's own account keeps its gold one) */
export async function studioBadgeMember(env: MembersEnv, id: unknown, on: unknown) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const r = await db.prepare("UPDATE members SET badge = ?1 WHERE id = ?2 AND official = 0").bind(on ? 1 : 0, Number(id) || 0).run();
  if (!r.meta?.changes) return { success: false, error: "العضو ده مش موجود." };
  return { success: true };
}
export async function studioBanMember(env: MembersEnv, id: unknown, on: unknown) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const r = await db.prepare("UPDATE members SET banned = ?1 WHERE id = ?2 AND official = 0").bind(on ? 1 : 0, Number(id) || 0).run();
  if (!r.meta?.changes) return { success: false, error: "العضو ده مش موجود." };
  if (on) await db.prepare("DELETE FROM member_sessions WHERE member = ?1").bind(Number(id)).run();
  return { success: true };
}
