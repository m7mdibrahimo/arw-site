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

export interface MembersEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; RESEND_API_KEY?: string; MEDIA?: R2Bucket }

/** A member's own picture, uploaded from their device (owner 2026-10-15): R2 «members/<id>/<16 hex>.webp» */
export const MEMBER_PIC = /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/members\/pic\/(\d+)\/([a-f0-9]{16})\.(webp|jpg|png)$/;
const picKey = (url: string) => { const m = url.match(MEMBER_PIC); return m ? `members/${m[1]}/${m[2]}.${m[3]}` : ""; };

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });
const SITE = "https://arab-wrestling.com";
const DAY = 86_400_000;
const SESSION_DAYS = 90;

// ── tables ──────────────────────────────────────────────────────────────────
// remembered only once it worked: a promise left pending by a request that was cut off would never settle for the
// next one, and the panel's «الأعضاء» spun for ever (owner 2026-10-15)
const ready = new WeakSet<D1Database>();
export async function ensureMembers(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, ukey TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL, recovery TEXT NOT NULL DEFAULT '',
      display TEXT NOT NULL DEFAULT '', pic TEXT NOT NULL DEFAULT '', fav_fed TEXT NOT NULL DEFAULT '', fav_star TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '')`),
    db.prepare("CREATE TABLE IF NOT EXISTS member_sessions (token TEXT PRIMARY KEY, member INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS member_sessions_member ON member_sessions (member)"),
    db.prepare("CREATE TABLE IF NOT EXISTS member_tokens (token TEXT PRIMARY KEY, member INTEGER NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL)"),
  ]);
  // the site's own account (owner 2026-10-14: «اعملي عضوية بتاعتي … موثقة العلامة الذهبي»): added to older tables
  await db.prepare("ALTER TABLE members ADD COLUMN official INTEGER NOT NULL DEFAULT 0").run().catch(() => null);
  // the blue badge: every member gets it, the owner can take it away or give it back (owner 2026-10-14: «ادي العلامة
  // الزرقاء التوثيق لاي حد او اشيله من عند اي حد»)
  await db.prepare("ALTER TABLE members ADD COLUMN badge INTEGER NOT NULL DEFAULT 1").run().catch(() => null);
  // «العضوية المميزة» (worker/src/premium.ts): until when, and since when
  await db.prepare("ALTER TABLE members ADD COLUMN premium_until INTEGER NOT NULL DEFAULT 0").run().catch(() => null);
  await db.prepare("ALTER TABLE members ADD COLUMN premium_since INTEGER NOT NULL DEFAULT 0").run().catch(() => null);
  // the member's real name, asked first at sign-up (owner 2026-10-18: «لما حد يسجل بتكتب اسم الاول والاسم الثاني اول حاجة»)
  await db.prepare("ALTER TABLE members ADD COLUMN first_name TEXT NOT NULL DEFAULT ''").run().catch(() => null);
  await db.prepare("ALTER TABLE members ADD COLUMN last_name TEXT NOT NULL DEFAULT ''").run().catch(() => null);
  ready.add(db);
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
  if (u.length > 20) return "اسم المستخدم طويل، 20 حرفا على الأكثر.";
  if (!/^[A-Za-zء-ي][A-Za-z0-9ء-ي٠-٩_.]*$/.test(u)) return "اسم المستخدم يبدأ بحرف، ويكون من حروف وأرقام فقط (ومسموح بـ _ و .).";
  if (official) return null;
  if (isReservedName(u) || /^(admin|administrator|moderator|support|root|arw|arabwrestling|staff|team|official|system)$/i.test(u) || /^(مدير|المدير|الإدارة|الادارة|ادمن|أدمن|الدعم)$/.test(u)) return "هذا الاسم غير متاح، اختر اسما آخر.";
  return null;
}
/** A first or second name: 2–20 letters (Arabic or Latin), a space, «-» or «'» inside; the cleaned name, or the problem */
export function cleanPersonName(raw: unknown, which: "first" | "last"): { name: string; problem: string | null } {
  const name = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const label = which === "first" ? "الاسم الأول" : "الاسم الثاني";
  if (!name) return { name, problem: `اكتب ${label}.` };
  if (name.length < 2 || name.length > 20) return { name, problem: `${label} من حرفين إلى 20 حرفا.` };
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '\-]*$/u.test(name)) return { name, problem: `${label} حروف فقط، من غير أرقام أو رموز.` };
  return { name, problem: null };
}
export function passwordProblem(p: string, username = ""): string | null {
  if (typeof p !== "string" || p.length < 8) return "كلمة المرور 8 حروف على الأقل.";
  if (p.length > 200) return "كلمة المرور طويلة جدا.";
  if (!/[A-Za-zء-ي]/.test(p) || !/[0-9٠-٩]/.test(p)) return "اجعل كلمة المرور فيها حروف وأرقام.";
  if (username && p.toLowerCase().includes(username.toLowerCase())) return "لا تجعل اسم المستخدم جزءا من كلمة المرور.";
  return null;
}
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
const ukeyOf = (u: string) => u.normalize("NFKC").toLowerCase();

type Member = { id: number; username: string; email: string; first_name?: string; last_name?: string; salt: string; hash: string; iterations: number; recovery: string; display: string; pic: string; fav_fed: string; fav_star: string; bio: string; verified: number; banned: number; created: number; last_seen: number; official?: number; badge?: number; premium_until?: number };
/** What the member's own pages see (never the hashes) */
const mine = (m: Member) => ({ id: m.id, username: m.username, email: m.email, first_name: m.first_name || "", last_name: m.last_name || "", display: m.official ? OFFICIAL_NAME : (m.display || m.username), pic: m.official ? "official" : m.pic, fav_fed: m.fav_fed, fav_star: m.fav_star, bio: m.bio, verified: !!m.verified, created: m.created, official: !!m.official,
  // a premium member has the blue badge while it lasts (owner 2026-10-14: «هياخد علامة التوثيق الزرقاء»)
  // the site's own account has every privilege, premium included, always (owner 2026-10-14: «ليا عضويتي ليها كل الامتيازات»)
  premium: m.official ? 4102444800000 : Number(m.premium_until) > Date.now() ? Number(m.premium_until) : 0, blue: !m.official && (m.badge !== 0 || Number(m.premium_until) > Date.now()),
  // the gold badge the owner gives by hand (owner 2026-10-15: «احط علامة توثيق ذهبي … لاي حد»)
  gold: !m.official && m.badge === 2 });

// ── a member's own picture: a data: URL of at most 250 KB that really is the picture it says ──────────────────
type PicBytes = { bytes: Uint8Array; ext: "webp" | "jpg" | "png" };
function picBytes(image: unknown): PicBytes | { error: string; status: 400 | 413 } {
  const d = String(image || "").match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  let bytes: Uint8Array | null = null;
  try { bytes = d ? Uint8Array.from(atob(d[2]), c => c.charCodeAt(0)) : null; } catch { bytes = null; }
  if (!d || !bytes || bytes.length < 200) return { error: "تعذر قراءة الصورة، جرب صورة أخرى.", status: 400 };
  if (bytes.length > 250_000) return { error: "الصورة كبيرة جدا، جرب صورة أخرى.", status: 413 };
  // the file is what it says it is
  const head = Array.from(bytes.slice(0, 12));
  const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const ext = d[1] === "webp" && isWebp ? "webp" : d[1] === "jpeg" && isJpeg ? "jpg" : d[1] === "png" && isPng ? "png" : "";
  if (!ext) return { error: "تعذر قراءة الصورة، جرب صورة أخرى.", status: 400 };
  return { bytes, ext };
}
async function putPic(media: R2Bucket, id: number, p: PicBytes): Promise<string> {
  const name = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  await media.put(`members/${id}/${name}.${p.ext}`, p.bytes, { httpMetadata: { contentType: p.ext === "jpg" ? "image/jpeg" : `image/${p.ext}` } });
  return `https://arw-site-bot.m7mdibrahimpc.workers.dev/members/pic/${id}/${name}.${p.ext}`;
}

// ── rate limits (KV counters with their own expiry) ───────────────────────────
async function tooMany(kv: KVNamespace, key: string, max: number, _windowSec: number): Promise<boolean> {
  const n = Number((await kv.get(`members:rl:${key}`)) || 0);
  return n >= max;
}
async function count(kv: KVNamespace, key: string, windowSec: number) {
  const n = Number((await kv.get(`members:rl:${key}`)) || 0);
  // KV takes one write a second per key: a burst still counts once, never fails the request
  await kv.put(`members:rl:${key}`, String(n + 1), { expirationTtl: Math.max(60, windowSec) }).catch(() => {});
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
    out += `<polyline points="${pts}" fill="none" stroke="${inks[Math.floor(Math.random() * 2) ? 0 : 1]}" stroke-width="${rnd(3, 3.8).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${rot.toFixed(1)} ${(x0 + 11).toFixed(1)} ${(y0 + 18).toFixed(1)})"/>`;
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
<tr><td style="padding:18px 28px 26px;border-top:1px solid #f1ece0;text-align:right;font-size:13px;color:#8a8f9b;line-height:1.8">وصلتك هذه الرسالة لأن عنوان بريدك استخدم في موقع <a href="${SITE}" style="color:#0e9594;text-decoration:none">عرب راسلنج</a>. إن لم تكن أنت، تجاهلها.</td></tr>
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
  return sendMail(env, m.email, "فعل حسابك في عرب راسلنج", mailHtml(`أهلا بك يا ${esc(m.display || m.username)} 👋`, [
    "سعداء بانضمامك إلى عرب راسلنج.",
    "بقيت خطوة واحدة: اضغط على الزر لتفعيل حسابك، وبعدها تدخل مباشرة وتستفيد من كل مميزات العضوية.",
    "الرابط صالح لمدة 3 أيام. إن لم تنشئ هذا الحساب، تجاهل هذه الرسالة.",
  ], { text: "تفعيل الحساب", href: `${SITE}/account/?verify=${t}` }));
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
  // with mail on, an account works only once its e-mail is confirmed (owner 2026-10-14: «التفعيل ده اجباري وليس اختياري»)
  const m = await db.prepare("SELECT m.* FROM member_sessions s JOIN members m ON m.id = s.member WHERE s.token = ?1 AND s.expires > ?2 AND m.banned = 0 AND (m.verified = 1 OR ?3 = 0)").bind(await sha(t), now, mustVerify(env) ? 1 : 0).first<Member>();
  if (m && now - (m.last_seen || 0) > 3_600_000) await db.prepare("UPDATE members SET last_seen = ?1 WHERE id = ?2").bind(now, m.id).run();
  return m || null;
}
/** Activation by e-mail is required whenever the site can send mail (without the key, nobody could ever get in) */
const mustVerify = (env: MembersEnv) => !!env.RESEND_API_KEY;
/** k•••@gmail.com: enough for the member to recognise their own address */
const maskEmail = (e: string) => e.replace(/^(.)([^@]*)(@.*)$/, (_, a, b, c) => a + "•".repeat(Math.min(Math.max(b.length, 2), 6)) + c);
/** The activation mail again (at most 3 an hour for one account) */
async function resendVerify(env: MembersEnv, db: D1Database, m: Member, now: number): Promise<boolean> {
  if (await tooMany(env.PUSH_KV, `va:${m.id}`, 3, 3600)) return false;
  await count(env.PUSH_KV, `va:${m.id}`, 3600);
  return sendVerify(env, db, m, now).catch(() => false);
}
const pendingReply = (m: Member, sent: boolean, extra: Record<string, unknown> = {}) => reply({
  ok: false, unverified: true, email: maskEmail(m.email), sent,
  error: sent ? "حسابك لم يفعل بعد. أرسلنا رابط التفعيل إلى بريدك، افتح الرسالة واضغط «تفعيل الحساب»." : "حسابك لم يفعل بعد. افتح رسالة التفعيل في بريدك واضغط «تفعيل الحساب».",
  ...extra,
}, 403);

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
  // a member's own picture, for anyone (each upload its own address, so it's kept for good)
  const own = path.match(/^\/pic\/(\d+)\/([a-f0-9]{16})\.(webp|jpg|png)$/);
  if (own && request.method === "GET") {
    const obj = env.MEDIA ? await env.MEDIA.get(`members/${own[1]}/${own[2]}.${own[3]}`) : null;
    if (!obj) return new Response("not found", { status: 404, headers: CORS });
    return new Response(obj.body, { headers: { "Content-Type": own[3] === "jpg" ? "image/jpeg" : `image/${own[3]}`, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", ...CORS } });
  }
  const ip = String(request.headers.get("CF-Connecting-IP") || "");
  const body: any = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (path === "/captcha" && request.method === "GET") return reply(await newCaptcha(env.PUSH_KV));

  if (path === "/signup" && request.method === "POST") {
    if (String(body.website || "")) return reply({ ok: false, error: "تعذر إنشاء الحساب." }, 400);
    if (await tooMany(env.PUSH_KV, `su:${ip}`, 5, 3600)) return reply({ ok: false, error: "أنشأت حسابات كثيرة من هذا الجهاز، حاول بعد ساعة." }, 429);
    const username = String(body.username || "").normalize("NFC").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const first = cleanPersonName(body.first_name, "first"), last = cleanPersonName(body.last_name, "last");
    if (first.problem) return reply({ ok: false, error: first.problem, field: "first_name" }, 400);
    if (last.problem) return reply({ ok: false, error: last.problem, field: "last_name" }, 400);
    const bad = usernameProblem(username) || (!EMAIL.test(email) ? "اكتب بريدا إلكترونيا صحيحا." : null) || passwordProblem(password, username);
    if (bad) return reply({ ok: false, error: bad }, 400);
    if (!(await checkCaptcha(env.PUSH_KV, body.captcha))) return reply({ ok: false, error: "رمز التحقق غير صحيح، جرب الرمز الجديد.", captcha: true }, 400);
    // an account never activated (a mistyped address…) gives its name and address back after a day
    await ensureComments(db);
    // (only while activation is required: without mail no account is ever activated, so none may be taken over;
    // and never an account that has paid or been given the membership)
    if (mustVerify(env)) await db.prepare(`DELETE FROM members WHERE (ukey = ?1 OR email = ?2) AND verified = 0 AND official = 0 AND created < ?3
      AND premium_until = 0 AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.member = members.id)`).bind(ukeyOf(username), email, now - DAY).run();
    const taken = await db.prepare("SELECT ukey = ?1 AS u, email = ?2 AS e FROM members WHERE ukey = ?1 OR email = ?2 LIMIT 1").bind(ukeyOf(username), email).first<{ u: number; e: number }>();
    if (taken?.u) return reply({ ok: false, error: "اسم المستخدم مستخدم من قبل، اختر اسما آخر.", field: "username" }, 409);
    if (taken?.e) return reply({ ok: false, error: "هذا البريد له حساب بالفعل، سجل دخولك.", field: "email" }, 409);
    const { salt, hash, iterations } = await hashPassword(password);
    const code = recoveryCode();
    const country = String((request as any).cf?.country || "").slice(0, 2).toUpperCase();
    // no blue badge to begin with: the owner gives it (owner 2026-10-14: «تشيل موضوع ان اي حد يسجل ياخد العلامة الزرقاء»)
    // the name shown with their comments starts as their real name (they can change it on their page)
    const fullName = `${first.name} ${last.name}`.slice(0, 30);
    const display = isReservedName(fullName) ? username : fullName;
    const ins = await db.prepare(`INSERT INTO members (username, ukey, email, salt, hash, iterations, recovery, display, created, last_seen, ip, country, badge, first_name, last_name)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?11, ?8, ?8, ?9, ?10, 0, ?12, ?13) RETURNING *`).bind(username, ukeyOf(username), email, salt, hash, iterations, await sha(cleanCode(code)), now, ip, country, display, first.name, last.name).first<Member>();
    if (!ins) return reply({ ok: false, error: "تعذر إنشاء الحساب، حاول مرة أخرى." }, 500);
    await count(env.PUSH_KV, `su:${ip}`, 3600);
    const mailed = await sendVerify(env, db, ins, now).catch(() => false);
    // the account opens from the link in the mail
    if (mustVerify(env)) {
      await count(env.PUSH_KV, `va:${ins.id}`, 3600);
      return reply({ ok: true, pending: true, email: ins.email, recovery: code, mailed });
    }
    const token = await startSession(db, ins.id, request, now);
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
    // not activated yet: the link again (the right password asks for it), no session
    if (mustVerify(env) && !m.verified) return pendingReply(m, await resendVerify(env, db, m, now));
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
    if (mustVerify(env) && !m!.verified) {
      const sent = await resendVerify(env, db, m!, now);
      return reply({ ok: true, pending: true, email: maskEmail(m!.email), recovery: code, mailed: sent });
    }
    const token = await startSession(db, m!.id, request, now);
    return reply({ ok: true, token, member: mine(m!), recovery: code });
  }

  if (path === "/forgot" && request.method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!env.RESEND_API_KEY) return reply({ ok: false, error: "استرجاع الحساب بالبريد غير متاح الآن، حاول بعد قليل أو تواصل معنا.", nomail: true }, 503);
    if (await tooMany(env.PUSH_KV, `fg:${ip}`, 5, 3600)) return reply({ ok: false, error: "طلبات كثيرة، حاول بعد ساعة." }, 429);
    await count(env.PUSH_KV, `fg:${ip}`, 3600);
    // and per address, whoever asks: an inbox is never flooded, nor its link replaced over and over
    const fa = `fga:${(await sha(email)).slice(0, 24)}`;
    if (await tooMany(env.PUSH_KV, fa, 3, 3600)) return reply({ ok: true });
    await count(env.PUSH_KV, fa, 3600);
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
    if (!row || row.expires < now) return reply({ ok: false, error: "الرابط انتهت صلاحيته، اطلب رابطا جديدا." }, 400);
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
    if (!row || row.expires < now) return reply({ ok: false, error: "رابط التفعيل انتهت صلاحيته. سجل دخولك وسنرسل لك رابطا جديدا." }, 400);
    await db.batch([
      db.prepare("UPDATE members SET verified = 1, last_seen = ?2 WHERE id = ?1").bind(row.member, now),
      db.prepare("DELETE FROM member_tokens WHERE member = ?1 AND kind = 'verify'").bind(row.member),
    ]);
    // the link opens the account: signed in on this device
    const m = await db.prepare("SELECT * FROM members WHERE id = ?1 AND banned = 0").bind(row.member).first<Member>();
    if (!m) return reply({ ok: true });
    return reply({ ok: true, token: await startSession(db, m.id, request, now), member: mine(m) });
  }

  // a new e-mail address, confirmed from the new inbox (the link may open on any device, so no session is needed)
  if (path === "/email-confirm" && request.method === "POST") {
    const key = `members:email:${await sha(String(body.token || ""))}`;
    const want: any = JSON.parse(await env.PUSH_KV.get(key) || "null");
    if (!want) return reply({ ok: false, error: "رابط تأكيد البريد انتهت صلاحيته. غير البريد مرة أخرى من الإعدادات." }, 400);
    const taken = await db.prepare("SELECT id FROM members WHERE email = ?1 AND id != ?2").bind(want.email, want.member).first();
    if (taken) { await env.PUSH_KV.delete(key); return reply({ ok: false, error: "هذا البريد مستخدم في حساب آخر." }, 409); }
    await db.prepare("UPDATE members SET email = ?1, verified = 1 WHERE id = ?2").bind(want.email, want.member).run();
    await env.PUSH_KV.delete(key);
    return reply({ ok: true, email: want.email });
  }

  if (path.startsWith("/u/") && request.method === "GET") {
    let u = "";
    try { u = decodeURIComponent(path.slice(3)).trim(); } catch { return reply({ ok: false, error: "لا يوجد عضو بهذا الاسم." }, 404); }
    const m = await db.prepare("SELECT id, username, display, pic, fav_fed, fav_star, bio, created, official, badge, premium_until FROM members WHERE ukey = ?1 AND banned = 0").bind(ukeyOf(u)).first<any>();
    if (!m) return reply({ ok: false, error: "لا يوجد عضو بهذا الاسم." }, 404);
    await ensureComments(db);
    const c = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE member = ?1 AND deleted = 0").bind(m.id).first<{ n: number }>();
    return reply({ ok: true, member: { username: m.username, display: m.official ? OFFICIAL_NAME : (m.display || m.username), pic: m.official ? "official" : m.pic, official: !!m.official, premium: !!m.official || Number(m.premium_until) > Date.now(), blue: !m.official && (m.badge !== 0 || Number(m.premium_until) > Date.now()), gold: !m.official && m.badge === 2, fav_fed: m.fav_fed, fav_star: m.fav_star, bio: m.bio, created: m.created, comments: c?.n || 0 } });
  }

  // ── the member's own ──
  const me = await memberOf(request, env, now);
  if (!me) return reply({ ok: false, error: "سجل دخولك أولا.", signedOut: true }, 401);

  if (path === "/me" && request.method === "GET") {
    // no free trial (owner 2026-10-15: «مفيش اشتراك مجاني خالص»): pages that read «trial» never offer one
    return reply({ ok: true, member: { ...mine(me), trial: false }, mail: !!env.RESEND_API_KEY });
  }

  if (path === "/logout" && request.method === "POST") {
    const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    await db.prepare("DELETE FROM member_sessions WHERE token = ?1").bind(await sha(t)).run();
    return reply({ ok: true });
  }

  // their own picture from their device: the page sends a square of at most 400px; the old upload goes
  if (path === "/pic" && request.method === "POST") {
    if (me.official) return reply({ ok: false, error: "صورة الحساب الرسمي هي شعار الموقع." }, 400);
    if (!env.MEDIA) return reply({ ok: false, error: "رفع الصور غير متاح الآن." }, 503);
    if (await tooMany(env.PUSH_KV, `pic:${me.id}`, 10, 3600)) return reply({ ok: false, error: "غيرت صورتك كثيرا، حاول بعد ساعة." }, 429);
    const pic = picBytes(body.image);
    if ("error" in pic) return reply({ ok: false, error: pic.error }, pic.status);
    await count(env.PUSH_KV, `pic:${me.id}`, 3600);
    const url2 = await putPic(env.MEDIA, me.id, pic);
    const old = picKey(me.pic);
    await db.prepare("UPDATE members SET pic = ?1 WHERE id = ?2").bind(url2, me.id).run();
    if (old) await env.MEDIA.delete(old).catch(() => {});
    const m = await db.prepare("SELECT * FROM members WHERE id = ?1").bind(me.id).first<Member>();
    return reply({ ok: true, member: mine(m!) });
  }

  if (path === "/profile" && request.method === "POST") {
    if (me.official) { body.display = me.display; body.pic = me.pic; }
    const display = String(body.display ?? me.display).normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 30);
    if (display.length < 2) return reply({ ok: false, error: "الاسم الظاهر حرفان على الأقل." }, 400);
    if (isReservedName(display) && !me.official) return reply({ ok: false, error: "هذا الاسم خاص بالحساب الرسمي للموقع، اختر اسما آخر." }, 400);
    const pic = String(body.pic ?? me.pic);
    // a star's picture, nothing, or the member's own upload (theirs only)
    const okPic = pic === "" || WRESTLER_PIC.test(pic) || /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(pic) || (MEMBER_PIC.test(pic) && pic.match(MEMBER_PIC)![1] === String(me.id));
    const fav_fed = /^(WWE|AEW|NJPW|TNA|ROH|MLP|MLW|CMLL|AAA|UFC|STARDOM|NOAH|)$/.test(String(body.fav_fed ?? me.fav_fed)) ? String(body.fav_fed ?? me.fav_fed) : me.fav_fed;
    const fav_star = String(body.fav_star ?? me.fav_star).replace(/\s+/g, " ").trim().slice(0, 40);
    const bio = String(body.bio ?? me.bio).replace(/\s+/g, " ").trim().slice(0, 160);
    await db.prepare("UPDATE members SET display = ?1, pic = ?2, fav_fed = ?3, fav_star = ?4, bio = ?5 WHERE id = ?6")
      .bind(display, okPic ? pic : me.pic, fav_fed, fav_star, bio, me.id).run();
    // an own picture left behind goes from the store
    if (okPic && pic !== me.pic && picKey(me.pic) && env.MEDIA) await env.MEDIA.delete(picKey(me.pic)).catch(() => {});
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

  // changing the e-mail: the password first; with mail on, the new address gets a link and the old one stays until then
  if (path === "/email" && request.method === "POST") {
    if (!(await verifyPassword(String(body.current || ""), me))) return reply({ ok: false, error: "كلمة المرور الحالية غير صحيحة." }, 400);
    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) return reply({ ok: false, error: "اكتب بريدا صحيحا." }, 400);
    if (email === me.email) return reply({ ok: false, error: "هذا هو بريدك الحالي." }, 400);
    if (await tooMany(env.PUSH_KV, `emq:${me.id}`, 10, 3600)) return reply({ ok: false, error: "طلبات كثيرة، حاول بعد ساعة." }, 429);
    await count(env.PUSH_KV, `emq:${me.id}`, 3600);
    if (await db.prepare("SELECT id FROM members WHERE email = ?1").bind(email).first()) return reply({ ok: false, error: "هذا البريد مستخدم في حساب آخر." }, 409);
    if (!mustVerify(env)) {
      await db.prepare("UPDATE members SET email = ?1 WHERE id = ?2").bind(email, me.id).run();
      const m = await db.prepare("SELECT * FROM members WHERE id = ?1").bind(me.id).first<Member>();
      return reply({ ok: true, member: mine(m!) });
    }
    if (await tooMany(env.PUSH_KV, `em:${me.id}`, 3, 3600)) return reply({ ok: false, error: "طلبات كثيرة، حاول بعد ساعة." }, 429);
    await count(env.PUSH_KV, `em:${me.id}`, 3600);
    const t = randomToken();
    await env.PUSH_KV.put(`members:email:${await sha(t)}`, JSON.stringify({ member: me.id, email }), { expirationTtl: 86400 });
    const sent = await sendMail(env, email, "أكد بريدك الجديد في عرب راسلنج", mailHtml(`أهلا يا ${esc(me.display || me.username)}`, [
      "طلبت تغيير بريد حسابك في عرب راسلنج إلى هذا البريد.",
      "اضغط على الزر لتأكيد البريد الجديد. بريدك القديم يبقى كما هو حتى تضغط.",
      "الرابط صالح لمدة يوم واحد. إن لم تطلب هذا، تجاهل الرسالة.",
    ], { text: "تأكيد البريد الجديد", href: `${SITE}/account/?email=${t}` }));
    return sent ? reply({ ok: true, pending: true, email: maskEmail(email) }) : reply({ ok: false, error: "إرسال البريد غير متاح الآن، حاول بعد قليل." }, 503);
  }

  if (path === "/verify-again" && request.method === "POST") {
    if (me.verified) return reply({ ok: true, already: true });
    if (await tooMany(env.PUSH_KV, `va:${me.id}`, 3, 3600)) return reply({ ok: false, error: "أرسلنا رسائل كثيرة، انتظر قليلا." }, 429);
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
  // the payments' table (each member's kind of membership); imported here, premium.ts imports this file
  const premium = await import("./premium");
  await premium.ensurePremium(db);
  // memberships left from the old free trial end as soon as the owner opens the list
  await premium.endTrials(env as any, now).catch(() => 0);
  const [rows, total, week, active] = await db.batch([
    // each member's comments counted in one pass over the comments (a count per member read them all once for each)
    db.prepare(`SELECT m.id, m.username, m.display, m.first_name, m.last_name, m.email, m.pic, m.verified, m.banned, m.created, m.last_seen, m.country, m.ip, m.official, m.badge, m.premium_until, m.premium_since,
      CASE WHEN m.premium_until > ?1 THEN (SELECT p.granted_by FROM premium_payments p WHERE p.member = m.id AND p.status = 'paid' ORDER BY p.paid_at DESC, p.id DESC LIMIT 1) END AS premium_by,
      COALESCE(c.n, 0) AS comments FROM members m
      LEFT JOIN (SELECT member, COUNT(*) AS n FROM comments WHERE member > 0 AND deleted = 0 GROUP BY member) c ON c.member = m.id
      ORDER BY m.created DESC LIMIT 2000`).bind(now),
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
  const m = await db.prepare(`SELECT id, username, email, display, first_name, last_name, pic, fav_fed, fav_star, bio, verified, banned, created, last_seen, ip, country, official, badge, premium_until, premium_since
    FROM members WHERE id = ?1`).bind(Number(id) || 0).first<any>();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  await (await import("./premium")).ensurePremium(db);
  const [comments, sessions, hearts, payments] = await db.batch([
    db.prepare("SELECT id, path, title, text, at, parent, hearted, deleted FROM comments WHERE member = ?1 ORDER BY at DESC LIMIT 200").bind(m.id),
    db.prepare("SELECT created, expires, ua FROM member_sessions WHERE member = ?1 AND expires > ?2 ORDER BY created DESC LIMIT 20").bind(m.id, now),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE member = ?1 AND hearted = 1 AND deleted = 0").bind(m.id),
    // every payment, trial and gift, and the invoices opened and not paid (owner 2026-10-15: «سجل الدفع بتاعه وكل حاجة»)
    db.prepare("SELECT id, invoice_id, currency, amount, status, method, reference, created, paid_at, days, granted_by FROM premium_payments WHERE member = ?1 ORDER BY id DESC LIMIT 100").bind(m.id),
  ]) as any[];
  const pays = payments.results || [];
  const last = pays.find((p: any) => p.status === "paid");
  return { success: true, member: { ...m, premium_by: Number(m.premium_until) > now && last ? last.granted_by : null }, comments: comments.results || [], sessions: sessions.results || [], hearts: hearts.results?.[0]?.n || 0, payments: pays };
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
/** The badge the owner gives or takes: 0 none, 1 blue, 2 gold (`on` is the old yes/no for the blue one) */
export async function studioBadgeMember(env: MembersEnv, id: unknown, on: unknown, level?: unknown) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const lv = level === undefined || level === null ? (on ? 1 : 0) : Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
  const r = await db.prepare("UPDATE members SET badge = ?1 WHERE id = ?2 AND official = 0").bind(lv, Number(id) || 0).run();
  if (!r.meta?.changes) return { success: false, error: "العضو ده مش موجود." };
  return { success: true };
}
/** The panel activates an account by hand (a member whose mail never came) */
export async function studioVerifyMember(env: MembersEnv, id: unknown) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const r = await db.prepare("UPDATE members SET verified = 1 WHERE id = ?1").bind(Number(id) || 0).run();
  if (!r.meta?.changes) return { success: false, error: "العضو ده مش موجود." };
  await db.prepare("DELETE FROM member_tokens WHERE member = ?1 AND kind = 'verify'").bind(Number(id)).run();
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

/** The owner corrects a member's page: the name shown, the line about them, their favourites, or takes the picture off
 *  (owner 2026-10-15: «يكون ليا تحكم في كل حاجة تخص الاعضاء») */
/** Once (owner 2026-10-15: «اعمل ال انت شايفه صح»): the blue badge every member got on signing up before
 *  2026-10-14 goes; the owner's own (from the panel's history) and the gold ones stay; a live subscription shows it anyway.
 *  Returns the members changed (their rooms are told), or null when it was done before. */
export async function resetAutoBadges(env: MembersEnv, ownerGiven: number[]): Promise<number[] | null> {
  const db = env.ANALYTICS;
  if (!db) return null;
  const FLAG = "members:badge-reset:v1";
  if (await env.PUSH_KV.get(FLAG)) return null;
  await ensureMembers(db);
  const keep = ownerGiven.filter(n => Number.isInteger(n) && n > 0);
  const rows = ((await db.prepare(`SELECT id FROM members WHERE badge = 1 AND official = 0${keep.length ? ` AND id NOT IN (${keep.map(() => "?").join(",")})` : ""}`).bind(...keep).all<{ id: number }>()).results || []).map(r => r.id);
  for (let i = 0; i < rows.length; i += 50) {
    const part = rows.slice(i, i + 50);
    await db.prepare(`UPDATE members SET badge = 0 WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).run();
  }
  await env.PUSH_KV.put(FLAG, JSON.stringify({ at: Date.now(), changed: rows.length, kept: keep }));
  return rows;
}

export async function studioEditMember(env: MembersEnv, id: unknown, b: any) {
  // everything of a member, by the owner only (owner 2026-10-15: «اعدل اي حاجة للاعضاء المتابعين اسمه صورته اي حاجة
  // ايميله باورده»): the shown name, the username, the e-mail, a new password, the picture, the about, the favourites
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "الحسابات مش متاحة دلوقتي." };
  await ensureMembers(db);
  const m: any = await db.prepare("SELECT * FROM members WHERE id = ?1 AND official = 0").bind(Number(id) || 0).first();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  const display = b.display === undefined ? m.display : String(b.display).normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 30);
  if (display.length < 2) return { success: false, error: "الاسم الظاهر حرفين على الأقل." };
  const bio = b.bio === undefined ? m.bio : String(b.bio).replace(/\s+/g, " ").trim().slice(0, 160);
  const fav_star = b.fav_star === undefined ? m.fav_star : String(b.fav_star).replace(/\s+/g, " ").trim().slice(0, 40);
  const fav_fed = b.fav_fed !== undefined && /^(WWE|AEW|NJPW|TNA|ROH|MLP|MLW|CMLL|AAA|UFC|STARDOM|NOAH|)$/.test(String(b.fav_fed)) ? String(b.fav_fed) : m.fav_fed;
  // the username: the same rules as signing up, and nobody else's
  let username = m.username;
  if (b.username !== undefined && String(b.username).normalize("NFC").trim() !== m.username) {
    username = String(b.username).normalize("NFC").trim();
    const bad = usernameProblem(username);
    if (bad) return { success: false, error: bad };
    if (await db.prepare("SELECT id FROM members WHERE ukey = ?1 AND id != ?2").bind(ukeyOf(username), m.id).first()) return { success: false, error: "اسم المستخدم ده مع عضو تاني." };
  }
  // the e-mail: set at once and counted as confirmed (the owner checked it)
  let email = m.email;
  if (b.email !== undefined && String(b.email).trim().toLowerCase() !== m.email) {
    email = String(b.email).trim().toLowerCase();
    if (!EMAIL.test(email)) return { success: false, error: "اكتب بريد صحيح." };
    if (await db.prepare("SELECT id FROM members WHERE email = ?1 AND id != ?2").bind(email, m.id).first()) return { success: false, error: "البريد ده مع عضو تاني." };
  }
  // a new password: the member is signed out everywhere and signs in with it
  const password = b.password === undefined || b.password === "" ? "" : String(b.password);
  if (password) { const bad = passwordProblem(password, username); if (bad) return { success: false, error: bad }; }
  // the picture: a new one (the same checks as the member's own upload), none, or as it is
  let pic = m.pic;
  if (b.image) {
    if (!env.MEDIA) return { success: false, error: "رفع الصور مش متاح دلوقتي." };
    const p = picBytes(b.image);
    if ("error" in p) return { success: false, error: p.error };
    pic = await putPic(env.MEDIA, m.id, p);
  } else if (b.pic === "") pic = "";
  const steps = [db.prepare("UPDATE members SET display = ?1, bio = ?2, fav_star = ?3, pic = ?4, fav_fed = ?5, username = ?6, ukey = ?7, email = ?8, verified = CASE WHEN ?9 THEN 1 ELSE verified END WHERE id = ?10")
    .bind(display, bio, fav_star, pic, fav_fed, username, ukeyOf(username), email, email !== m.email ? 1 : 0, m.id)];
  if (password) {
    const { salt, hash, iterations } = await hashPassword(password);
    steps.push(db.prepare("UPDATE members SET salt = ?1, hash = ?2, iterations = ?3 WHERE id = ?4").bind(salt, hash, iterations, m.id));
  }
  if (password || email !== m.email || b.signout) steps.push(db.prepare("DELETE FROM member_sessions WHERE member = ?1").bind(m.id));
  // a reset link or a new-address link sent before this stops working
  if (password || email !== m.email) steps.push(db.prepare("DELETE FROM member_tokens WHERE member = ?1").bind(m.id));
  await db.batch(steps);
  if (pic !== m.pic && picKey(m.pic) && env.MEDIA) await env.MEDIA.delete(picKey(m.pic)).catch(() => {});
  return { success: true, changed: { username: username !== m.username, email: email !== m.email, password: !!password, pic: pic !== m.pic } };
}
