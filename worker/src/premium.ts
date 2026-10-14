// «العضوية المميزة» (owner 2026-10-14): a monthly membership, 50 EGP or 1 USD, paid on Fawaterk and on at once, with
// no one switching it on by hand. Nothing on the site is locked by it: a member gets the blue badge, a name that stands
// out, the shows earlier and on the site's own servers, and the right to ask for a show to be translated for them.
//
// How a payment turns into a membership:
//   1. POST /premium/checkout {currency}       the member's own Fawaterk invoice (createInvoiceLink, the member in payLoad)
//   2. they pay on Fawaterk, and come back to /premium/?paid=1
//   3. POST /premium/webhook                   Fawaterk tells the worker (its hashKey checked), and the worker asks Fawaterk
//      POST /premium/check                     again (getInvoiceData); the page asks too, so a late webhook doesn't matter
//   4. 30 days are added (to what's left, when renewing). Each invoice counts once.
// With no FAWATERK_API_KEY yet, the owner's two fixed Fawaterk links are used and the panel turns the membership on.
//
//   GET  /premium/requests      the member's own requests        POST /premium/requests {kind, text}
// The panel (worker/src/index.ts): GET /api/studio/premium, POST /api/studio/premium/grant {id, days},
//   POST /api/studio/premium/request {id, status, reply, link}
import { memberOf, ensureMembers } from "./members";
import { readRepoFile } from "./studio";

export interface PremiumEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; FAWATERK_API_KEY?: string; FAWATERK_VENDOR_KEY?: string; RESEND_API_KEY?: string;
  GITHUB_OWNER?: string; GITHUB_REPO?: string; GITHUB_BRANCH?: string; GITHUB_TOKEN?: string }

export const PLANS = { EGP: { price: 50, link: "https://app.fawaterk.com/invoices/item/16781/alaadoy-almmyz-gny-msry" }, USD: { price: 1, link: "https://app.fawaterk.com/invoices/item/16782/alaadoy-almmyz-dolar-amryky" } } as const;
export const DAYS = 30;
const DAY = 86_400_000;
const FAWATERK = "https://app.fawaterk.com/api/v2";
const SITE = "https://arab-wrestling.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

const ready = new WeakMap<D1Database, Promise<unknown>>();
export function ensurePremium(db: D1Database) {
  let p = ready.get(db);
  if (!p) ready.set(db, p = ensureMembers(db).then(() => db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL, invoice_id TEXT NOT NULL DEFAULT '',
      invoice_key TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', method TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, paid_at INTEGER NOT NULL DEFAULT 0, days INTEGER NOT NULL DEFAULT ${DAYS}, granted_by TEXT NOT NULL DEFAULT '')`),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_payments_invoice ON premium_payments (invoice_id)"),
    // a show's own premium servers and downloads (never in its file, never in its page): «للأعضاء المميزين» in the editor
    db.prepare("CREATE TABLE IF NOT EXISTS premium_media (k TEXT PRIMARY KEY, servers TEXT NOT NULL DEFAULT '[]', downloads TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', reply TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL)`),
  ]))
    .catch((e) => { ready.delete(db); throw e; }));
  return p;
}

/** A member's membership, as their pages see it */
export const premiumOf = (m: any, now = Date.now()) => (m?.official ? 4102444800000 : Number(m?.premium_until) > now ? Number(m.premium_until) : 0);

/** Days added to a member (renewing adds to what's left), once per payment */
export async function grant(db: D1Database, member: number, days: number, now = Date.now()) {
  await ensurePremium(db);
  const m = await db.prepare("SELECT premium_until, premium_since FROM members WHERE id = ?1").bind(member).first<{ premium_until: number; premium_since: number }>();
  if (!m) return 0;
  const from = Math.max(now, Number(m.premium_until) || 0);
  const until = from + days * DAY;
  await db.prepare("UPDATE members SET premium_until = ?1, premium_since = CASE WHEN premium_until > ?2 THEN premium_since ELSE ?2 END WHERE id = ?3").bind(until, now, member).run();
  return until;
}

// ── Fawaterk ────────────────────────────────────────────────────────────────
async function hmac(key: string, text: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
}
/** Fawaterk signs «InvoiceId=…&InvoiceKey=…&PaymentMethod=…» with HMAC-SHA256 (the vendor key, or the API key) */
export async function validHash(env: PremiumEnv, b: any): Promise<boolean> {
  const got = String(b?.hashKey || "").toLowerCase();
  if (!got) return false;
  const text = `InvoiceId=${b.invoice_id}&InvoiceKey=${b.invoice_key}&PaymentMethod=${b.payment_method}`;
  for (const key of [env.FAWATERK_VENDOR_KEY, env.FAWATERK_API_KEY]) if (key && (await hmac(key, text)) === got) return true;
  return false;
}
/** Is this invoice paid? Fawaterk itself says (its answer, not the webhook's word) */
export async function invoicePaid(env: PremiumEnv, invoiceId: string): Promise<{ paid: boolean; method?: string; reference?: string } | null> {
  if (!env.FAWATERK_API_KEY || !invoiceId) return null;
  try {
    const r = await fetch(`${FAWATERK}/getInvoiceData/${encodeURIComponent(invoiceId)}`, { headers: { Authorization: `Bearer ${env.FAWATERK_API_KEY}`, Accept: "application/json" } });
    const d: any = await r.json().catch(() => null);
    const x = d?.data || {};
    const paid = x.paid === 1 || x.paid === true || x.paid === "1" || /^paid$/i.test(String(x.status_text || x.invoice_status || x.status || ""));
    return { paid, method: String(x.payment_method || x.paymentMethod || ""), reference: String(x.referenceNumber || x.reference_number || "") };
  } catch { return null; }
}
/** A pending payment found paid: the days go to its member, once */
async function settle(db: D1Database, pay: any, how: { method?: string; reference?: string }, now: number) {
  const r = await db.prepare("UPDATE premium_payments SET status = 'paid', paid_at = ?1, method = ?2, reference = ?3 WHERE id = ?4 AND status != 'paid'")
    .bind(now, String(how.method || "").slice(0, 40), String(how.reference || "").slice(0, 60), pay.id).run();
  if (!r.meta?.changes) return 0; // already counted
  return grant(db, pay.member, Number(pay.days) || DAYS, now);
}

// ── a show for premium members: its own servers, and the whole show before its time ──
/** A content file's key: «shows/<file>», «recaps/<file>», «nostalgia/<file>» (no folders, no way out) */
export const contentKey = (k: unknown) => { const v = String(k || ""); return /^(shows|recaps|nostalgia)\/[^/\\]{1,200}$/.test(v) && !v.includes("..") ? v : ""; };
const urls = (list: unknown) => (Array.isArray(list) ? list : []).map(x => String(x || "").trim()).filter(x => /^https?:\/\/[^\s<>"']+$/.test(x)).slice(0, 30);
/** What a show's file says about watching and downloading (its frontmatter: servers, downloads_*), and when it's public */
export function showLinks(text: string): { servers: string[]; downloads: string[]; date: number } {
  const fm = (String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
  const lines = fm.split(/\r?\n/);
  const servers: string[] = [], downloads: string[] = [];
  let date = 0, key = "";
  for (const line of lines) {
    const top = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      if (key === "date") date = Date.parse(top[2].replace(/^['"]|['"]$/g, "")) || 0;
      if (/^downloads(_\w+)?$/.test(key)) for (const u of top[2].match(/https?:\/\/\S+/g) || []) downloads.push(u);
      continue;
    }
    if (key === "servers") { const m = line.match(/url:\s*['"]?(https?:\/\/[^'"\s]+)/); if (m) servers.push(m[1]); }
    else if (/^downloads(_\w+)?$/.test(key)) for (const u of line.match(/https?:\/\/\S+/g) || []) downloads.push(u);
  }
  return { servers, downloads, date };
}

export async function handlePremium(request: Request, env: PremiumEnv, url: URL, now = Date.now()): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = env.ANALYTICS;
  if (!db) return reply({ ok: false, error: "العضوية المميزة غير متاحة الآن." }, 503);
  await ensurePremium(db);
  const path = url.pathname;
  const body: any = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  // Fawaterk → the worker (no member session here: the invoice is ours, and Fawaterk confirms it)
  if (path === "/premium/webhook" && request.method === "POST") {
    const pay: any = await db.prepare("SELECT * FROM premium_payments WHERE invoice_id = ?1 ORDER BY id DESC LIMIT 1").bind(String(body.invoice_id || "")).first();
    if (!pay) return reply({ ok: true, unknown: true });
    const signed = await validHash(env, body);
    const asked = await invoicePaid(env, pay.invoice_id);
    // paid when Fawaterk says so when asked; without that, a signed «paid» is enough
    const paid = asked ? asked.paid : signed && /^paid$/i.test(String(body.invoice_status || ""));
    if (!paid) return reply({ ok: true, paid: false });
    await settle(db, pay, { method: asked?.method || body.payment_method, reference: asked?.reference || body.referenceNumber }, now);
    return reply({ ok: true, paid: true });
  }

  const me: any = await memberOf(request, env as any, now);

  // a show page asks: how many premium links it has (anyone), and the links themselves (a premium member)
  if (path === "/premium/media" && request.method === "GET") {
    const k = contentKey(url.searchParams.get("k"));
    if (!k) return reply({ ok: false }, 400);
    const row: any = await db.prepare("SELECT servers, downloads FROM premium_media WHERE k = ?1").bind(k).first();
    const sv: string[] = row ? JSON.parse(row.servers) : [], dl: string[] = row ? JSON.parse(row.downloads) : [];
    const out: any = { ok: true, servers: sv.length, downloads: dl.length };
    if (premiumOf(me, now)) { out.links = { servers: sv, downloads: dl }; out.premium = true; }
    return reply(out);
  }
  // a show scheduled for later: a premium member watches it now (its links read from the repo, never in the page)
  if (path === "/premium/early" && request.method === "GET") {
    const k = contentKey(url.searchParams.get("k"));
    if (!k) return reply({ ok: false }, 400);
    const cacheKey = `pm:early:${k}`;
    // before its time only for a premium member; after it, anyone (the page waits for the site's next build)
    const premium = !!premiumOf(me, now);
    const known: any = JSON.parse(await env.PUSH_KV.get(cacheKey) || "null");
    let links: any = known;
    if (!links) {
      let file: { content: string } | null;
      try { file = await readRepoFile(env as any, `content/${k}.md`); } catch { return reply({ ok: false, error: "تعذّر التحميل، حاول بعد قليل." }, 503); }
      links = file ? showLinks(file.content) : { missing: true };
      await env.PUSH_KV.put(cacheKey, JSON.stringify(links), { expirationTtl: 120 });
    }
    if (links.missing) return reply({ ok: false, error: "العرض غير موجود." }, 404);
    if (!premium && (!links.date || links.date > now)) return reply({ ok: false, premium: false, pub: links.date, error: "العرض متاح الآن للأعضاء المميزين فقط." }, 403);
    return reply({ ok: true, premium, servers: links.servers, downloads: links.downloads, pub: links.date });
  }

  if (!me) return reply({ ok: false, signedOut: true, error: "سجّل دخولك أولًا." }, 401);

  if (path === "/premium/checkout" && request.method === "POST") {
    const currency = String(body.currency || "EGP").toUpperCase() === "USD" ? "USD" : "EGP";
    const plan = PLANS[currency];
    const back = `${SITE}${body.en ? "/en" : ""}/premium/`; // back to the page in the member's language
    if (!env.FAWATERK_API_KEY) return reply({ ok: true, url: plan.link, manual: true });
    const open = await db.prepare("SELECT COUNT(*) AS n FROM premium_payments WHERE member = ?1 AND created > ?2").bind(me.id, now - 3_600_000).first<{ n: number }>();
    if ((open?.n || 0) >= 8) return reply({ ok: false, error: "طلبات دفع كثيرة، حاول بعد قليل." }, 429);
    const name = String(me.display || me.username).trim().split(/\s+/);
    const res = await fetch(`${FAWATERK}/createInvoiceLink`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.FAWATERK_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        cartTotal: String(plan.price), currency,
        customer: { first_name: name[0] || me.username, last_name: name.slice(1).join(" ") || "Member", email: me.email },
        redirectionUrls: { successUrl: `${back}?paid=1`, failUrl: `${back}?failed=1`, pendingUrl: `${back}?pending=1` },
        cartItems: [{ name: currency === "USD" ? "Arab Wrestling Premium (1 month)" : "العضوية المميزة - عرب راسلنج (شهر)", price: String(plan.price), quantity: "1" }],
        payLoad: JSON.stringify({ member: me.id }),
      }),
    }).catch(() => null);
    const d: any = res ? await res.json().catch(() => null) : null;
    const inv = d?.data || {};
    if (!res || !res.ok || d?.status !== "success" || !inv.url) return reply({ ok: false, error: "تعذّر فتح صفحة الدفع الآن، حاول بعد قليل." }, 502);
    await db.prepare("INSERT INTO premium_payments (member, invoice_id, invoice_key, currency, amount, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(me.id, String(inv.invoiceId ?? inv.invoice_id ?? ""), String(inv.invoiceKey ?? inv.invoice_key ?? ""), currency, plan.price, now).run();
    return reply({ ok: true, url: String(inv.url) });
  }

  if (path === "/premium/check" && request.method === "POST") {
    // back from Fawaterk: the member's recent invoices, asked again
    const rows = (await db.prepare("SELECT * FROM premium_payments WHERE member = ?1 AND status = 'pending' AND created > ?2 ORDER BY id DESC LIMIT 5").bind(me.id, now - 3 * DAY).all<any>()).results || [];
    for (const pay of rows) {
      const asked = await invoicePaid(env, pay.invoice_id);
      if (asked?.paid) await settle(db, pay, asked, now);
    }
    const m: any = await db.prepare("SELECT premium_until FROM members WHERE id = ?1").bind(me.id).first();
    return reply({ ok: true, premium: premiumOf(m, now) });
  }

  if (path === "/premium/requests" && request.method === "GET") {
    const rows = (await db.prepare("SELECT id, kind, text, status, reply, link, created, updated FROM premium_requests WHERE member = ?1 ORDER BY id DESC LIMIT 50").bind(me.id).all()).results || [];
    return reply({ ok: true, items: rows });
  }
  if (path === "/premium/requests" && request.method === "POST") {
    if (!premiumOf(me, now)) return reply({ ok: false, error: "طلبات الترجمة الخاصة للأعضاء المميزين." }, 403);
    const kind = ["nostalgia", "series", "show", "other"].includes(body.kind) ? body.kind : "other";
    const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (text.length < 5) return reply({ ok: false, error: "اكتب طلبك بوضوح: اسم العرض أو السلسلة وتاريخها إن عرفته." }, 400);
    const open = await db.prepare("SELECT COUNT(*) AS n FROM premium_requests WHERE member = ?1 AND status IN ('new', 'working')").bind(me.id).first<{ n: number }>();
    if ((open?.n || 0) >= 3) return reply({ ok: false, error: "لديك 3 طلبات قيد التنفيذ. انتظر حتى ننتهي من أحدها." }, 429);
    const r = await db.prepare("INSERT INTO premium_requests (member, kind, text, created, updated) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id").bind(me.id, kind, text, now).first<{ id: number }>();
    return reply({ ok: true, id: r?.id || 0 });
  }

  return reply({ ok: false, error: "not found" }, 404);
}

// ── the panel ────────────────────────────────────────────────────────────────
export async function studioPremium(env: PremiumEnv, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: true, members: [], payments: [], requests: [], live: false };
  await ensurePremium(db);
  const month = now - 30 * DAY;
  const [members, payments, requests, sums] = await db.batch([
    db.prepare("SELECT id, username, display, pic, email, premium_until, premium_since FROM members WHERE premium_until > ?1 ORDER BY premium_until ASC").bind(now),
    db.prepare(`SELECT p.*, m.username, m.display FROM premium_payments p LEFT JOIN members m ON m.id = p.member WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 200`),
    db.prepare(`SELECT r.*, m.username, m.display, m.pic, m.premium_until FROM premium_requests r LEFT JOIN members m ON m.id = r.member ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'working' THEN 1 ELSE 2 END, r.id DESC LIMIT 300`),
    db.prepare("SELECT currency, SUM(amount) AS total, COUNT(*) AS n FROM premium_payments WHERE status = 'paid' AND paid_at > ?1 AND granted_by = '' GROUP BY currency").bind(month),
  ]) as any[];
  return { success: true, members: members.results || [], payments: payments.results || [], requests: requests.results || [], month: sums.results || [], live: !!env.FAWATERK_API_KEY };
}
/** The editor's «للأعضاء المميزين»: a show's premium servers and downloads */
export async function studioPremiumMedia(env: PremiumEnv, key: unknown, body: any = null, now = Date.now()) {
  const db = env.ANALYTICS;
  const k = contentKey(key);
  if (!db || !k) return { success: false, error: "مش متاح." };
  await ensurePremium(db);
  if (body) {
    const sv = urls(body.servers), dl = urls(body.downloads);
    if (!sv.length && !dl.length) await db.prepare("DELETE FROM premium_media WHERE k = ?1").bind(k).run();
    else await db.prepare("INSERT INTO premium_media (k, servers, downloads, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET servers = excluded.servers, downloads = excluded.downloads, updated = excluded.updated").bind(k, JSON.stringify(sv), JSON.stringify(dl), now).run();
    return { success: true, servers: sv, downloads: dl };
  }
  const row: any = await db.prepare("SELECT servers, downloads FROM premium_media WHERE k = ?1").bind(k).first();
  return { success: true, servers: row ? JSON.parse(row.servers) : [], downloads: row ? JSON.parse(row.downloads) : [] };
}
/** The owner gives (or takes back) membership days by hand: a payment made before the automatic one was set up, a gift */
export async function studioPremiumGrant(env: PremiumEnv, id: unknown, days: unknown, who = "", now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const member = Number(id) || 0, d = Math.round(Number(days) || 0);
  const m = await db.prepare("SELECT id FROM members WHERE id = ?1").bind(member).first();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  if (d <= 0) { await db.prepare("UPDATE members SET premium_until = 0 WHERE id = ?1").bind(member).run(); return { success: true, until: 0 }; }
  const until = await grant(db, member, Math.min(d, 3650), now);
  await db.prepare("INSERT INTO premium_payments (member, currency, amount, status, created, paid_at, days, granted_by) VALUES (?1, 'EGP', 0, 'paid', ?2, ?2, ?3, ?4)").bind(member, now, d, who.slice(0, 40) || "panel").run();
  return { success: true, until };
}
export async function studioPremiumRequest(env: PremiumEnv, b: any, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const status = ["new", "working", "done", "declined"].includes(b.status) ? b.status : "working";
  const link = /^\/[^\s]*$|^https:\/\/arab-wrestling\.com\/[^\s]*$/.test(String(b.link || "")) ? String(b.link) : "";
  const r = await db.prepare("UPDATE premium_requests SET status = ?1, reply = ?2, link = ?3, updated = ?4 WHERE id = ?5")
    .bind(status, String(b.reply || "").trim().slice(0, 500), link, now, Number(b.id) || 0).run();
  return r.meta?.changes ? { success: true } : { success: false, error: "الطلب ده مش موجود." };
}
