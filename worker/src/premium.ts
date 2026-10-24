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
// With no Fawaterk key yet (FAWATERK_API_KEY, or FAWATERK_CLIENT_ID + FAWATERK_CLIENT_SECRET), the owner's two fixed Fawaterk links are used and the panel turns the membership on.
//
//   GET  /premium/requests      the member's own requests        POST /premium/requests {kind, text}
// The panel (worker/src/index.ts): GET /api/studio/premium, POST /api/studio/premium/grant {id, days},
//   POST /api/studio/premium/request {id, status, reply, link}
import { chatRebadge } from "./chat";
import { memberOf, ensureMembers } from "./members";
import { readRepoFile } from "./studio";

export interface PremiumEnv { ANALYTICS?: D1Database; PUSH_KV: KVNamespace; PREMIUM_AUTO?: string; FAWATERK_API_KEY?: string; FAWATERK_VENDOR_KEY?: string; FAWATERK_CLIENT_ID?: string; FAWATERK_CLIENT_SECRET?: string; RESEND_API_KEY?: string;
  GITHUB_OWNER?: string; GITHUB_REPO?: string; GITHUB_BRANCH?: string; GITHUB_TOKEN?: string }

export const PLANS = { EGP: { price: 50, link: "https://app.fawaterk.com/invoices/item/16781/alaadoy-almmyz-gny-msry" }, USD: { price: 1, link: "https://app.fawaterk.com/invoices/item/16782/alaadoy-almmyz-dolar-amryky" } } as const;
export const DAYS = 30;
// the plans (owner 2026-10-15: «اعمل اي حاجة تجبر … يشترك … ولو حبيت تعمل عروض اعمل»): longer is cheaper a month
export const OFFERS = {
  m1: { days: 30, EGP: 50, USD: 1, ar: "شهر", en: "1 month" },
  m3: { days: 90, EGP: 135, USD: 2.5, ar: "3 شهور", en: "3 months" },
  m12: { days: 365, EGP: 450, USD: 9, ar: "سنة", en: "1 year" },
} as const;
export type OfferId = keyof typeof OFFERS;
/** The owner's fixed Fawaterk links, one a plan and a currency (the 3 months and the year: owner 2026-10-15): used
 *  while there's no Fawaterk key, or when Fawaterk won't make the member's own invoice; the panel turns those on */
export const LINKS: Record<OfferId, { EGP: string; USD: string }> = {
  m1: { EGP: PLANS.EGP.link, USD: PLANS.USD.link },
  m3: { EGP: "https://app.fawaterk.com/invoices/item/16788/alaadoy-almmyz-3-shhor-gny-msry", USD: "https://app.fawaterk.com/invoices/item/16790/alaadoy-almmyz-3-shhor-dolar-amryky" },
  m12: { EGP: "https://app.fawaterk.com/invoices/item/16789/alaadoy-almmyz-sn-gny-msry", USD: "https://app.fawaterk.com/invoices/item/16791/alaadoy-almmyz-sn-dolar-amryky" },
};
export const TRIAL_DAYS = 3;
/** A member may try the membership free once: never premium before, never paid (an invoice left unpaid doesn't count),
 *  not the site's account */
// No free trial any more (owner 2026-10-15: «شيل موضوع الاشتراك المجاني لمدة 3 ايام … كله مدفوع»): never open
export async function trialOpen(_db: D1Database, _m: any): Promise<boolean> { return false; }
/** Memberships that came from the old free trial alone (nothing paid or given by hand): ended (owner 2026-10-15: «ولو في
 *  اشترك بالتجربة المجانية شيله»). Their history keeps the trial. Each member's rooms show them as they are now. */
export async function endTrials(env: PremiumEnv, now = Date.now()): Promise<number> {
  const db = env.ANALYTICS;
  if (!db) return 0;
  await ensurePremium(db);
  const ended = (await db.prepare(`UPDATE members SET premium_until = 0 WHERE premium_until > ?1 AND official = 0
    AND EXISTS (SELECT 1 FROM premium_payments p WHERE p.member = members.id AND p.status = 'paid' AND p.granted_by = 'trial')
    AND NOT EXISTS (SELECT 1 FROM premium_payments p WHERE p.member = members.id AND p.status = 'paid' AND p.granted_by != 'trial')
    RETURNING id`).bind(now).all<{ id: number }>()).results || [];
  for (const m of ended) await chatRebadge(env as any, m.id).catch(() => {});
  return ended.length;
}
const DAY = 86_400_000;
const FAWATERK = "https://app.fawaterk.com/api/v2";
const SITE = "https://arab-wrestling.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

// remembered only once it worked (as ensureMembers: a pending one from a request cut off never settles)
const ready = new WeakSet<D1Database>();
export async function ensurePremium(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await ensureMembers(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL, invoice_id TEXT NOT NULL DEFAULT '',
      invoice_key TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', method TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, paid_at INTEGER NOT NULL DEFAULT 0, days INTEGER NOT NULL DEFAULT ${DAYS}, granted_by TEXT NOT NULL DEFAULT '')`),
    db.prepare("CREATE INDEX IF NOT EXISTS premium_payments_invoice ON premium_payments (invoice_id)"),
    // a member's history (the panel's member page, the kind of their membership)
    db.prepare("CREATE INDEX IF NOT EXISTS premium_payments_member ON premium_payments (member, status, paid_at)"),
    // a show's own premium servers and downloads (never in its file, never in its page): «للأعضاء المميزين» in the editor
    db.prepare("CREATE TABLE IF NOT EXISTS premium_media (k TEXT PRIMARY KEY, servers TEXT NOT NULL DEFAULT '[]', downloads TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS premium_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', reply TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL)`),
  ]);
  ready.add(db);
}

/** What turned a member's membership on last, for the panel (owner 2026-10-15: «تجربة 3 ايام … ولا هدية من الموقع …
 *  ولا دافع»): «trial», a name (given by hand from the panel) or «» (paid on Fawaterk) */
/** granted_by on a payment: «trial», «» (paid on Fawaterk), «paid:<who>» (paid the owner directly and turned on by hand:
 *  Vodafone Cash, InstaPay…), «<who>» (a gift from the site). Owner 2026-10-16: «يكون في تفريق بين اني مديله العضوية …
 *  هدية من الموقع وبين ان هو دافع فا ميتكتبش عنده انه هدية من الموقع». */
export const handPaid = (by: unknown) => /^paid:/.test(String(by || ""));
export const isGift = (by: unknown) => !!by && by !== "trial" && !handPaid(by);
export const PREMIUM_BY = "(SELECT p.granted_by FROM premium_payments p WHERE p.member = m.id AND p.status = 'paid' ORDER BY p.paid_at DESC, p.id DESC LIMIT 1) AS premium_by";
/** A member's membership, as their pages see it */
export const premiumOf = (m: any, now = Date.now()) => (m?.official ? 4102444800000 : Number(m?.premium_until) > now ? Number(m.premium_until) : 0);

/** Days added to a member (renewing adds to what's left), once per payment */
export async function grant(db: D1Database, member: number, days: number, now = Date.now()) {
  await ensurePremium(db);
  // one statement: two payments settled at the same moment both count (SET reads the row as it was)
  const r = await db.prepare(`UPDATE members SET premium_since = CASE WHEN premium_until > ?1 THEN premium_since ELSE ?1 END,
    premium_until = MAX(premium_until, ?1) + ?2 WHERE id = ?3 RETURNING premium_until`).bind(now, days * DAY, member).first<{ premium_until: number }>();
  return r ? Number(r.premium_until) : 0;
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
/** Fawaterk's API key: a fixed token (FAWATERK_API_KEY), or one asked for with the OAuth client the owner made in
 *  Fawaterk («التكامل البرمجي» → «بيانات اعتماد عميل OAuth»), kept in KV until shortly before it ends */
/** A paid membership turns on by itself only when the owner switches it on (PREMIUM_AUTO = "1") and Fawaterk's key is
 *  there. Off by default (owner 2026-10-15: «افضل خاجة ان انا ال افعل الاشتراك ب ايديا للناس عشان ممكن الناس تعمل
 *  ثغرات»): the member pays on the plan's fixed link and sends the owner their email, the owner turns it on in the panel
 *  (views/premium.js). There's no free trial (endTrials). */
export const fawaterkLive = (env: PremiumEnv) => env.PREMIUM_AUTO === "1" && !!(env.FAWATERK_API_KEY || (env.FAWATERK_CLIENT_ID && env.FAWATERK_CLIENT_SECRET));
export async function fawaterkToken(env: PremiumEnv, fresh = false): Promise<string> {
  if (env.FAWATERK_API_KEY) return env.FAWATERK_API_KEY;
  if (!env.FAWATERK_CLIENT_ID || !env.FAWATERK_CLIENT_SECRET) return "";
  const KEY = "pm:fawaterk:token";
  if (!fresh) { const t = await env.PUSH_KV.get(KEY); if (t) return t; }
  try {
    const r = await fetch("https://app.fawaterk.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.FAWATERK_CLIENT_ID, client_secret: env.FAWATERK_CLIENT_SECRET, scope: "" }).toString(),
    });
    const d: any = await r.json().catch(() => null);
    const token = String(d?.access_token || d?.data?.access_token || "");
    if (!r.ok || !token) return "";
    const life = Number(d?.expires_in || d?.data?.expires_in) || 3600;
    await env.PUSH_KV.put(KEY, token, { expirationTtl: Math.max(60, Math.min(life - 300, 30 * 86400)) });
    return token;
  } catch { return ""; }
}
/** A call to Fawaterk's API with its token; a refused token is asked for again once */
async function fawaterk(env: PremiumEnv, path: string, init: RequestInit = {}): Promise<Response | null> {
  for (const fresh of [false, true]) {
    const token = await fawaterkToken(env, fresh);
    if (!token) return null;
    const r = await fetch(`${FAWATERK}${path}`, { ...init, headers: { ...(init.headers as any || {}), Authorization: `Bearer ${token}`, Accept: "application/json" } }).catch(() => null);
    if (!r || r.status !== 401 || env.FAWATERK_API_KEY) return r;
  }
  return null;
}
/** Is this invoice paid? Fawaterk itself says (its answer, not the webhook's word); and paid in full, in the currency
 *  the site asked for (owner 2026-10-15: «يتاكد مليون في الميه انه دفع») */
export async function invoicePaid(env: PremiumEnv, invoiceId: string, expect?: { amount?: number; currency?: string }): Promise<{ paid: boolean; method?: string; reference?: string } | null> {
  if (!fawaterkLive(env) || !invoiceId) return null;
  try {
    const r = await fawaterk(env, `/getInvoiceData/${encodeURIComponent(invoiceId)}`);
    if (!r) return null;
    const d: any = await r.json().catch(() => null);
    const x = d?.data || {};
    let paid = x.paid === 1 || x.paid === true || x.paid === "1" || /^paid$/i.test(String(x.status_text || x.invoice_status || x.status || ""));
    // what Fawaterk says was asked of the member: never less than the plan's price, never another currency
    const total = Number(x.total ?? x.cart_total ?? x.cartTotal ?? x.invoice_total ?? NaN);
    const cur = String(x.currency || "").toUpperCase();
    if (expect && Number(expect.amount) > 0 && Number.isFinite(total) && total + 0.01 < Number(expect.amount)) paid = false;
    if (expect && expect.currency && /^[A-Z]{3}$/.test(cur) && cur !== String(expect.currency).toUpperCase()) paid = false;
    return { paid, method: String(x.payment_method || x.paymentMethod || ""), reference: String(x.referenceNumber || x.reference_number || "") };
  } catch { return null; }
}
/** A pending payment found paid: the days go to its member, once */
async function settle(db: D1Database, pay: any, how: { method?: string; reference?: string }, now: number) {
  const r = await db.prepare("UPDATE premium_payments SET status = 'paid', paid_at = ?1, method = ?2, reference = ?3 WHERE id = ?4 AND status != 'paid'")
    .bind(now, String(how.method || "").slice(0, 40), String(how.reference || "").slice(0, 60), pay.id).run();
  if (!r.meta?.changes) return 0; // already counted
  try { return await grant(db, pay.member, Number(pay.days) || DAYS, now); }
  catch (e) { await db.prepare("UPDATE premium_payments SET status = 'pending' WHERE id = ?1").bind(pay.id).run().catch(() => {}); throw e; } // counted next time
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

/** {k: [premium servers, premium downloads]} for every show that has any — counts only, never a link */
export function premiumSummary(rows: { k: string; servers: string; downloads: string }[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const r of rows) {
    let s = 0, d = 0;
    try { s = JSON.parse(r.servers).length; d = JSON.parse(r.downloads).length; } catch { continue; }
    if (s || d) out[r.k] = [s, d];
  }
  return out;
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
    // the webhook only says «go and ask»: paid only when Fawaterk, asked by the site with its own key, says this very
    // invoice is paid in full (a webhook's own word, even signed, never turns a membership on: its signature doesn't
    // cover the status). Not answered now: asked again by the member's page and every hour (sweepPending).
    const asked = await invoicePaid(env, pay.invoice_id, pay);
    if (!asked?.paid) return reply({ ok: true, paid: false });
    await settle(db, pay, { method: asked.method || body.payment_method, reference: asked.reference || body.referenceNumber }, now);
    await chatRebadge(env as any, pay.member).catch(() => {});
    return reply({ ok: true, paid: true });
  }

  // the build asks which shows have premium links, and how many — never the links: each show page then comes out with
  // its premium line or rows already in it, instead of popping in after the page asked (owner 2026-10-16: «عايز … تكون
  // ظاهرة علطول لانها بتاخد وقت علي ما بتظهر»)
  if (path === "/premium/summary" && request.method === "GET") {
    const rows: any = await db.prepare("SELECT k, servers, downloads FROM premium_media").all();
    return new Response(JSON.stringify({ ok: true, media: premiumSummary(rows.results || []) }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60", ...CORS } });
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
      try { file = await readRepoFile(env as any, `content/${k}.md`); } catch { return reply({ ok: false, error: "تعذر التحميل، حاول بعد قليل." }, 503); }
      links = file ? showLinks(file.content) : { missing: true };
      await env.PUSH_KV.put(cacheKey, JSON.stringify(links), { expirationTtl: 120 });
    }
    if (links.missing) return reply({ ok: false, error: "العرض غير موجود." }, 404);
    if (!premium && (!links.date || links.date > now)) return reply({ ok: false, premium: false, pub: links.date, error: "العرض متاح الآن للأعضاء المميزين فقط." }, 403);
    return reply({ ok: true, premium, servers: links.servers, downloads: links.downloads, pub: links.date });
  }

  if (!me) return reply({ ok: false, signedOut: true, error: "سجل دخولك أولا." }, 401);

  // «اشتراكي» on the member's page: since when, until when, and every payment (owner 2026-10-15)
  if (path === "/premium/mine" && request.method === "GET") {
    const pays = await db.prepare("SELECT id, currency, amount, status, method, reference, created, paid_at, days, granted_by FROM premium_payments WHERE member = ?1 ORDER BY COALESCE(paid_at, created) DESC LIMIT 60").bind(me.id).all<any>();
    const items = (pays.results || []).filter((p: any) => p.status === "paid" || now - p.created < 3 * 86_400_000).map((p: any) => ({
      at: p.paid_at || p.created, paid: p.status === "paid", currency: p.currency, amount: isGift(p.granted_by) || p.granted_by === "trial" ? 0 : p.amount,
      method: p.method || "", reference: p.reference || "", days: Number(p.days) || DAYS, gift: isGift(p.granted_by), trial: p.granted_by === "trial",
    }));
    return reply({ ok: true, official: !!me.official, until: premiumOf(me, now), since: Number(me.premium_since) || 0, days: DAYS, plans: { EGP: PLANS.EGP.price, USD: PLANS.USD.price }, offers: OFFERS, trial: await trialOpen(db, me), payments: items });
  }

  if (path === "/premium/checkout" && request.method === "POST") {
    const currency = String(body.currency || "EGP").toUpperCase() === "USD" ? "USD" : "EGP";
    const offerId: OfferId = (Object.keys(OFFERS) as OfferId[]).includes(body.plan) ? body.plan : "m1";
    const offer = OFFERS[offerId];
    const plan = { price: offer[currency], link: LINKS[offerId][currency] };
    const back = `${SITE}${body.en ? "/en" : ""}/premium/`; // back to the page in the member's language
    // no key yet: the plan's fixed link (each plan has its own)
    if (!fawaterkLive(env)) return reply({ ok: true, url: plan.link, manual: true });
    const open = await db.prepare("SELECT COUNT(*) AS n FROM premium_payments WHERE member = ?1 AND created > ?2").bind(me.id, now - 3_600_000).first<{ n: number }>();
    if ((open?.n || 0) >= 8) return reply({ ok: false, error: "طلبات دفع كثيرة، حاول بعد قليل." }, 429);
    const name = String(me.display || me.username).trim().split(/\s+/);
    const res = await fawaterk(env, "/createInvoiceLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartTotal: String(plan.price), currency,
        customer: { first_name: name[0] || me.username, last_name: name.slice(1).join(" ") || "Member", email: me.email },
        redirectionUrls: { successUrl: `${back}?paid=1`, failUrl: `${back}?failed=1`, pendingUrl: `${back}?pending=1` },
        cartItems: [{ name: currency === "USD" ? `Arab Wrestling Premium (${offer.en})` : `العضوية المميزة - عرب راسلنج (${offer.ar})`, price: String(plan.price), quantity: "1" }],
        payLoad: JSON.stringify({ member: me.id }),
      }),
    });
    const d: any = res ? await res.json().catch(() => null) : null;
    const inv = d?.data || {};
    // Fawaterk refused or didn't answer: the fixed link, so the member can still pay (the panel turns it on)
    if (!res || !res.ok || d?.status !== "success" || !inv.url) {
      console.log(`[premium] createInvoiceLink ${res?.status}: ${JSON.stringify(d).slice(0, 300)}`);
      return reply({ ok: true, url: plan.link, manual: true });
    }
    await db.prepare("INSERT INTO premium_payments (member, invoice_id, invoice_key, currency, amount, created, days) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(me.id, String(inv.invoiceId ?? inv.invoice_id ?? ""), String(inv.invoiceKey ?? inv.invoice_key ?? ""), currency, plan.price, now, offer.days).run();
    return reply({ ok: true, url: String(inv.url) });
  }

  // three days free, once (never premium, never paid); a device or network tries it once a month
  if (path === "/premium/trial" && request.method === "POST") {
    // no free trial any more: every membership is paid
    return reply({ ok: false, error: "لا توجد تجربة مجانية، العضوية المميزة بالاشتراك فقط." }, 410);
  }
  if (path === "/premium/check" && request.method === "POST") {
    // back from Fawaterk: the member's recent invoices, asked again
    const rows = (await db.prepare("SELECT * FROM premium_payments WHERE member = ?1 AND status = 'pending' AND created > ?2 ORDER BY id DESC LIMIT 5").bind(me.id, now - 3 * DAY).all<any>()).results || [];
    for (const pay of rows) {
      const asked = await invoicePaid(env, pay.invoice_id, pay);
      if (asked?.paid) { await settle(db, pay, asked, now); await chatRebadge(env as any, pay.member).catch(() => {}); }
    }
    const m: any = await db.prepare("SELECT premium_until, official FROM members WHERE id = ?1").bind(me.id).first();
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
  await endTrials(env, now).catch(() => 0);
  const month = now - 30 * DAY;
  const [members, payments, requests, sums] = await db.batch([
    db.prepare(`SELECT m.id, m.username, m.display, m.pic, m.email, m.premium_until, m.premium_since, ${PREMIUM_BY} FROM members m WHERE m.premium_until > ?1 ORDER BY m.premium_until ASC`).bind(now),
    db.prepare(`SELECT p.*, m.username, m.display FROM premium_payments p LEFT JOIN members m ON m.id = p.member WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 200`),
    db.prepare(`SELECT r.*, m.username, m.display, m.pic, m.premium_until, m.official FROM premium_requests r LEFT JOIN members m ON m.id = r.member ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'working' THEN 1 ELSE 2 END, r.id DESC LIMIT 300`),
    db.prepare("SELECT currency, SUM(amount) AS total, COUNT(*) AS n FROM premium_payments WHERE status = 'paid' AND paid_at > ?1 AND (granted_by = '' OR granted_by LIKE 'paid:%') GROUP BY currency").bind(month),
  ]) as any[];
  return { success: true, members: members.results || [], payments: payments.results || [], requests: requests.results || [], month: sums.results || [], live: fawaterkLive(env) };
}
/** The panel's bell: a new subscriber (paid, or given by hand) and a new translation request */
export async function premiumNotifications(env: PremiumEnv, sinceMs: number): Promise<any[]> {
  const db = env.ANALYTICS;
  if (!db) return [];
  try {
    await ensurePremium(db);
    const [pays, reqs] = await Promise.all([
      db.prepare("SELECT p.id, p.member, p.amount, p.currency, p.paid_at, p.days, p.granted_by, m.username, m.display FROM premium_payments p LEFT JOIN members m ON m.id = p.member WHERE p.status = 'paid' AND p.paid_at > ?1 ORDER BY p.paid_at DESC LIMIT 30").bind(sinceMs).all<any>(),
      db.prepare("SELECT r.id, r.member, r.kind, r.text, r.created, m.username, m.display FROM premium_requests r LEFT JOIN members m ON m.id = r.member WHERE r.created > ?1 ORDER BY r.created DESC LIMIT 30").bind(sinceMs).all<any>(),
    ]);
    return [
      ...(pays.results || []).map(p => ({ id: `premium-pay:${p.id}`, type: "premium-pay", at: p.paid_at, member: p.member, name: p.display || p.username || "", amount: p.amount, currency: p.currency, days: p.days, by: p.granted_by || "" })),
      ...(reqs.results || []).map(r => ({ id: `premium-req:${r.id}`, type: "premium-req", at: r.created, member: r.member, name: r.display || r.username || "", kind: r.kind, text: String(r.text || "").slice(0, 160) })),
    ];
  } catch { return []; }
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
/** The owner turns a membership on by hand (owner 2026-10-15: «لمجرد ما يدفعوا … يبعتوا الايميل ال هما مسجلين بيه»): the
 *  member found by the email they signed up with, or their username (with or without «@») */
export async function studioPremiumFind(env: PremiumEnv, q: unknown, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const s = String(q ?? "").normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\s]/g, "").replace(/^@/, "").toLowerCase().slice(0, 254);
  if (s.length < 3) return { success: false, error: "اكتب إيميل المتابع أو اسم المستخدم بتاعه." };
  const m = await db.prepare(`SELECT id, username, display, email, pic, official, banned, verified, premium_until, premium_since FROM members
    WHERE email = ?1 OR ukey = ?1 LIMIT 1`).bind(s).first<any>();
  if (!m) return { success: false, error: s.includes("@") ? "مفيش عضو مسجّل بالإيميل ده. اتأكد إنه نفس الإيميل اللي عمل بيه الحساب." : "مفيش عضو باسم المستخدم ده." };
  return { success: true, member: { ...m, premium: Number(m.premium_until) > now } };
}
/** The owner gives (or takes back) membership days by hand: a payment made before the automatic one was set up, a gift */
/** How a membership turned on by hand is told: paid to the owner directly (what, how much, how) or a gift */
function handKind(pay: any, who: string) {
  const by = who.slice(0, 40) || "panel";
  if (pay?.kind !== "paid") return { by, amount: 0, currency: "EGP", method: "", reference: "" };
  const amount = Math.max(0, Math.min(100000, Math.round((Number(pay.amount) || 0) * 100) / 100));
  return { by: `paid:${by}`.slice(0, 48), amount, currency: pay.currency === "USD" ? "USD" : "EGP",
    method: String(pay.method || "").replace(/\s+/g, " ").trim().slice(0, 40), reference: String(pay.reference || "").trim().slice(0, 60) };
}
export async function studioPremiumGrant(env: PremiumEnv, id: unknown, days: unknown, who = "", now = Date.now(), pay: any = null) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const member = Number(id) || 0, d = Math.round(Number(days) || 0);
  const m = await db.prepare("SELECT id FROM members WHERE id = ?1").bind(member).first();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  if (d <= 0) { await db.prepare("UPDATE members SET premium_until = 0 WHERE id = ?1").bind(member).run(); return { success: true, until: 0 }; }
  const capped = Math.min(d, 3650);
  const until = await grant(db, member, capped, now);
  const k = handKind(pay, who);
  await db.prepare("INSERT INTO premium_payments (member, currency, amount, status, created, paid_at, days, granted_by, method, reference) VALUES (?1, ?5, ?6, 'paid', ?2, ?2, ?3, ?4, ?7, ?8)")
    .bind(member, now, capped, k.by, k.currency, k.amount, k.method, k.reference).run();
  return { success: true, until };
}
/** The owner corrects how long one membership was given for (owner 2026-10-25: «فعلتله شهر بدل سنة … وعايزك تديني صلاحية
 *  بده»): the payment says the new number of days, and the member's end date moves by the difference */
export async function studioPremiumDays(env: PremiumEnv, payId: unknown, days: unknown, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const d = Math.round(Number(days) || 0);
  if (d < 1 || d > 3650) return { success: false, error: "المدة من يوم لـ10 سنين." };
  const row: any = await db.prepare("SELECT id, member, days, paid_at, granted_by FROM premium_payments WHERE id = ?1 AND status = 'paid'").bind(Number(payId) || 0).first();
  if (!row) return { success: false, error: "الاشتراك ده مش موجود." };
  if (row.granted_by === "trial") return { success: false, error: "دي تجربة مجانية، مدتها ثابتة." };
  const m: any = await db.prepare("SELECT premium_until FROM members WHERE id = ?1").bind(row.member).first();
  if (!m) return { success: false, error: "العضو ده مش موجود." };
  const delta = (d - (Number(row.days) || 0)) * DAY;
  const was = Number(m.premium_until) || 0;
  // still running: the end moves by the difference; already over: counted again from the day it was given
  const until = was > now ? was + delta : Math.max(0, (Number(row.paid_at) || now) + d * DAY);
  await db.batch([
    db.prepare("UPDATE premium_payments SET days = ?1 WHERE id = ?2").bind(d, row.id),
    db.prepare("UPDATE members SET premium_until = ?1 WHERE id = ?2").bind(until > now ? until : 0, row.member),
  ]);
  return { success: true, until: until > now ? until : 0, member: row.member };
}
/** A membership turned on by hand, told again: it was paid after all, or it was a gift (the owner fixes an old one) */
export async function studioPremiumKind(env: PremiumEnv, payId: unknown, pay: any, who = "") {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  const row: any = await db.prepare("SELECT id, granted_by FROM premium_payments WHERE id = ?1 AND status = 'paid'").bind(Number(payId) || 0).first();
  if (!row || !row.granted_by || row.granted_by === "trial") return { success: false, error: "ده مش اشتراك اتفعّل باليد." };
  const k = handKind(pay, String(row.granted_by).replace(/^paid:/, "") || who);
  await db.prepare("UPDATE premium_payments SET granted_by = ?1, amount = ?2, currency = ?3, method = ?4, reference = ?5 WHERE id = ?6")
    .bind(k.by, k.amount, k.currency, k.method, k.reference, row.id).run();
  return { success: true };
}
export async function studioPremiumRequest(env: PremiumEnv, b: any, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return { success: false, error: "مش متاح دلوقتي." };
  await ensurePremium(db);
  // the owner removes a request altogether, or corrects what it says (owner 2026-10-15: «امسح او اعمل اي حاجة في … الطلب»)
  if (b.delete) {
    const d = await db.prepare("DELETE FROM premium_requests WHERE id = ?1").bind(Number(b.id) || 0).run();
    return d.meta?.changes ? { success: true, deleted: true } : { success: false, error: "الطلب ده مش موجود." };
  }
  if (typeof b.text === "string" && b.text.trim().length >= 2) {
    await db.prepare("UPDATE premium_requests SET text = ?1 WHERE id = ?2").bind(b.text.replace(/\s+/g, " ").trim().slice(0, 500), Number(b.id) || 0).run();
  }
  const status = ["new", "working", "done", "declined"].includes(b.status) ? b.status : "working";
  const link = /^\/[^\s]*$|^https:\/\/arab-wrestling\.com\/[^\s]*$/.test(String(b.link || "")) ? String(b.link) : "";
  const r = await db.prepare("UPDATE premium_requests SET status = ?1, reply = ?2, link = ?3, updated = ?4 WHERE id = ?5")
    .bind(status, String(b.reply || "").trim().slice(0, 500), link, now, Number(b.id) || 0).run();
  return r.meta?.changes ? { success: true } : { success: false, error: "الطلب ده مش موجود." };
}

/** Hourly: «تنتهي عضويتك بعد 3 أيام» once before the end, «انتهت عضويتك» once after it, in the member's bell (and on
 *  their devices); each period's notice once (the address carries the end date). A gift or a trial is told too. */
/** Hourly: the invoices of the last 3 days still waiting, asked of Fawaterk again (a webhook that came while Fawaterk
 *  didn't answer, a member who closed the page before coming back) */
export async function sweepPending(env: PremiumEnv, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db || !fawaterkLive(env)) return 0;
  await ensurePremium(db);
  const rows = (await db.prepare("SELECT * FROM premium_payments WHERE status = 'pending' AND invoice_id != '' AND created > ?1 ORDER BY id DESC LIMIT 20").bind(now - 3 * DAY).all<any>()).results || [];
  let n = 0;
  for (const pay of rows) {
    const asked = await invoicePaid(env, pay.invoice_id, pay).catch(() => null);
    if (asked?.paid && (await settle(db, pay, asked, now))) { n++; await chatRebadge(env as any, pay.member).catch(() => {}); }
  }
  return n;
}
export async function runPremiumReminders(env: PremiumEnv, now = Date.now()) {
  const db = env.ANALYTICS;
  if (!db) return 0;
  await ensurePremium(db);
  await sweepPending(env, now).catch(() => 0);
  await endTrials(env, now).catch(() => 0);
  const { ensureFollows } = await import("./follows");
  await ensureFollows(db);
  // members not told yet (the reminder's link is its key in the inbox); a 3-day trial is reminded on its last day only
  const notTold = (kind: string) => `NOT EXISTS (SELECT 1 FROM member_inbox i WHERE i.member = m.id AND i.url = '/premium/?${kind}=' || m.premium_until || '#subscribe')`;
  const soon = ((await db.prepare(`SELECT m.id, m.premium_until, EXISTS (SELECT 1 FROM premium_payments p WHERE p.member = m.id AND p.granted_by = 'trial' AND p.paid_at > ?3) AS trial
      FROM members m WHERE m.official = 0 AND m.banned = 0 AND m.premium_until > ?1 AND m.premium_until <= ?2 AND ${notTold("renew")} ORDER BY m.premium_until LIMIT 200`)
    .bind(now, now + 3 * DAY, now - (TRIAL_DAYS + 1) * DAY).all<any>()).results || []).filter(m => !m.trial || m.premium_until - now <= DAY);
  const ended = (await db.prepare(`SELECT m.id, m.premium_until FROM members m WHERE m.official = 0 AND m.banned = 0 AND m.premium_until > ?1 AND m.premium_until <= ?2 AND ${notTold("ended")} ORDER BY m.premium_until LIMIT 200`).bind(now - 2 * DAY, now).all<any>()).results || [];
  const rows = [
    ...soon.map(m => db.prepare("INSERT OR IGNORE INTO member_inbox (member, url, title, title_en, image, program, fed, at) VALUES (?1, ?2, ?3, ?4, '', 'العضوية المميزة', '', ?5)")
      .bind(m.id, `/premium/?renew=${m.premium_until}#subscribe`, `عضويتك المميزة تنتهي بعد ${Math.max(1, Math.ceil((m.premium_until - now) / DAY))} ${Math.ceil((m.premium_until - now) / DAY) === 1 ? "يوم" : "أيام"}. جددها الآن لتبقى مميزاتك.`, "Your Premium membership ends soon. Renew now to keep your perks.", now)),
    ...ended.map(m => db.prepare("INSERT OR IGNORE INTO member_inbox (member, url, title, title_en, image, program, fed, at) VALUES (?1, ?2, ?3, ?4, '', 'العضوية المميزة', '', ?5)")
      .bind(m.id, `/premium/?ended=${m.premium_until}#subscribe`, "انتهت عضويتك المميزة. جددها لتعود لك العروض قبل الجميع والسيرفرات الخاصة وتوثيق حسابك.", "Your Premium membership has ended. Renew to get your perks back.", now)),
  ];
  for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50));
  return rows.length;
}
