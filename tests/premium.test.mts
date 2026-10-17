// «العضوية المميزة» (owner 2026-10-14): paid on Fawaterk, on at once, 30 days a payment, each invoice once.
// D1 is a real SQLite here; Fawaterk is a stand-in fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { handleMembers } from '../worker/src/members';
import { handleComments } from '../worker/src/comments';
import { handlePremium, studioPremium, studioPremiumGrant, studioPremiumKind, studioPremiumRequest, studioPremiumMedia, showLinks, contentKey, premiumNotifications, PLANS, OFFERS, runPremiumReminders } from '../worker/src/premium';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (l: any[]) => { const o = []; for (const s of l) o.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return o; }, raw: db };
}
const kv = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };
const env = (over: any = {}): any => ({ ANALYTICS: d1(), PUSH_KV: kv(), ...over });
async function member(e: any, username = 'kareem_10') {
  const cap: any = await (await handleMembers(new Request('https://w/members/captcha'), e, new URL('https://w/members/captcha'))).json();
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'raw2026night', first_name: 'كريم', last_name: 'محمد', captcha: { id: cap.id, answer: e.PUSH_KV.m.get(`members:cap:${cap.id}`) } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${username.length}` } }), e, new URL('https://w/members/signup'));
  return (await r.json() as any) as { token: string; member: any };
}
const call = async (e: any, path: string, body?: any, token = '', now?: number) => {
  const r = await handlePremium(new Request(`https://w${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL(`https://w${path}`), now);
  return { status: r.status, body: await r.json() as any };
};
const me = async (e: any, token: string) => (await (await handleMembers(new Request('https://w/members/me', { headers: { Authorization: `Bearer ${token}` } }), e, new URL('https://w/members/me'))).json() as any).member;
/** A stand-in Fawaterk: invoices it made, and which of them were paid */
function fawaterk() {
  const made: any[] = []; const paid = new Set<string>(); const asked: Record<string, any> = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/createInvoiceLink')) { const b = JSON.parse(init.body); const id = String(1000 + made.length); made.push({ id, b, auth: init.headers.Authorization }); return new Response(JSON.stringify({ status: 'success', data: { url: `https://app.fawaterk.com/link/${id}`, invoiceId: Number(id), invoiceKey: `k${id}` } })); }
    const g = u.match(/getInvoiceData\/(\d+)/);
    if (g) return new Response(JSON.stringify({ status: 'success', data: { invoice_id: Number(g[1]), paid: paid.has(g[1]) ? 1 : 0, payment_method: 'Card', referenceNumber: 'R' + g[1], ...(asked[g[1]] || {}) } }));
    return new Response('{}', { status: 404 });
  }) as any;
  return { made, paid, asked, restore: () => { globalThis.fetch = real; } };
}

test('without the Fawaterk key yet: the fixed links for each currency (the panel turns the membership on)', async () => {
  const e = env();
  const s = await member(e);
  assert.equal(PLANS.EGP.price, 50);
  assert.equal(PLANS.USD.price, 1);
  const r = await call(e, '/premium/checkout', { currency: 'USD' }, s.token);
  assert.equal(r.body.manual, true);
  assert.equal(r.body.url, PLANS.USD.link);
  assert.equal((await call(e, '/premium/checkout', { currency: 'EGP' })).status, 401);
});

test('a payment turns the membership on at once (the page asks Fawaterk), once per invoice, 30 days added to what is left', async () => {
  const e = env({ PREMIUM_AUTO: '1', FAWATERK_API_KEY: 'fk_test' });
  const s = await member(e);
  const f = fawaterk();
  try {
    const c = await call(e, '/premium/checkout', { currency: 'EGP' }, s.token);
    assert.equal(c.body.url, 'https://app.fawaterk.com/link/1000');
    assert.equal(f.made[0].auth, 'Bearer fk_test');
    assert.equal(f.made[0].b.cartTotal, '50');
    assert.equal(f.made[0].b.currency, 'EGP');
    assert.equal(f.made[0].b.customer.email, 'kareem_10@example.com');
    assert.equal(JSON.parse(f.made[0].b.payLoad).member, s.member.id);
    // not paid yet
    assert.equal((await call(e, '/premium/check', {}, s.token)).body.premium, 0);
    assert.equal((await me(e, s.token)).premium, 0);
    f.paid.add('1000');
    const t0 = Date.now();
    const until = (await call(e, '/premium/check', {}, s.token, t0)).body.premium;
    assert.ok(Math.abs(until - (t0 + 30 * 864e5)) < 5000);
    // the same invoice again: nothing more
    assert.equal((await call(e, '/premium/check', {}, s.token, t0 + 1000)).body.premium, until);
    // the member: premium, and the blue badge with it (a new member has none otherwise)
    const m = await me(e, s.token);
    assert.ok(m.premium > Date.now());
    assert.equal(m.blue, true);
    // renewing early adds a month to what is left
    await call(e, '/premium/checkout', { currency: 'USD' }, s.token);
    assert.equal(f.made[1].b.cartTotal, '1');
    f.paid.add('1001');
    assert.ok(Math.abs((await call(e, '/premium/check', {}, s.token, t0 + 2000)).body.premium - (until + 30 * 864e5)) < 5000);
  } finally { f.restore(); }
});

test('the webhook only says «go and ask»: paid when Fawaterk, asked, says paid in full in the right currency; unknown or unpaid invoices change nothing', async () => {
  const e = env({ PREMIUM_AUTO: '1', FAWATERK_API_KEY: 'fk_test', FAWATERK_VENDOR_KEY: 'vendor_secret' });
  const s = await member(e);
  const f = fawaterk();
  try {
    await call(e, '/premium/checkout', { currency: 'EGP' }, s.token);
    const hook = (id: string, status = 'paid', key = 'vendor_secret') => {
      const b: any = { invoice_id: Number(id), invoice_key: `k${id}`, payment_method: 'Card', invoice_status: status, pay_load: JSON.stringify({ member: s.member.id }), referenceNumber: 'R1' };
      b.hashKey = createHmac('sha256', key).update(`InvoiceId=${b.invoice_id}&InvoiceKey=${b.invoice_key}&PaymentMethod=${b.payment_method}`).digest('hex');
      return call(e, '/premium/webhook', b);
    };
    // signed «paid», but Fawaterk says not yet: nothing
    assert.equal((await hook('1000')).body.paid, false);
    assert.equal((await me(e, s.token)).premium, 0);
    f.paid.add('1000');
    assert.equal((await hook('1000')).body.paid, true);
    const until = (await me(e, s.token)).premium;
    assert.ok(until > Date.now());
    // again (Fawaterk retries): once only
    await hook('1000');
    assert.equal((await me(e, s.token)).premium, until);
    // an invoice the site never made
    assert.equal((await hook('9999')).body.unknown, true);
    // «paid» for less than the plan's price, or in another currency: not paid (owner: «مليون في المية انه دفع»)
    await call(e, '/premium/checkout', { currency: 'EGP' }, s.token);
    f.paid.add('1001'); f.asked['1001'] = { total: 5, currency: 'EGP' };
    assert.equal((await hook('1001')).body.paid, false);
    f.asked['1001'] = { total: 50, currency: 'USD' };
    assert.equal((await hook('1001')).body.paid, false);
    assert.equal((await me(e, s.token)).premium, until);
    // in full: counted; and the hourly sweep finds one the webhook missed
    f.asked['1001'] = { total: 50, currency: 'EGP' };
    const { sweepPending } = await import('../worker/src/premium');
    assert.equal(await sweepPending(e), 1);
    assert.ok((await me(e, s.token)).premium > until);
  } finally { f.restore(); }
  // without the API key nothing can ask Fawaterk: a webhook's word, even signed, never turns a membership on
  const e2 = env({ FAWATERK_VENDOR_KEY: 'vendor_secret' });
  const s2 = await member(e2);
  await studioPremium(e2); // the tables
  await e2.ANALYTICS.prepare("INSERT INTO premium_payments (member, invoice_id, invoice_key, currency, amount, created) VALUES (?1, '77', 'k77', 'EGP', 50, ?2)").bind(s2.member.id, Date.now()).run();
  const signed = (key: string) => { const b: any = { invoice_id: 77, invoice_key: 'k77', payment_method: 'Fawry', invoice_status: 'paid' }; b.hashKey = createHmac('sha256', key).update(`InvoiceId=77&InvoiceKey=k77&PaymentMethod=Fawry`).digest('hex'); return call(e2, '/premium/webhook', b); };
  assert.equal((await signed('wrong')).body.paid, false);
  assert.equal((await signed('vendor_secret')).body.paid, false);
  assert.equal((await me(e2, s2.token)).premium, 0);
});

test('premium members ask for a show to be translated (3 open at most); the panel answers; the panel can give or take days', async () => {
  const e = env();
  const s = await member(e);
  assert.equal((await call(e, '/premium/requests', { kind: 'nostalgia', text: 'رسلمينيا 17 كاملة' }, s.token)).status, 403);
  const g = await studioPremiumGrant(e, s.member.id, 30, 'mohamed');
  assert.ok(g.until! > Date.now());
  for (let i = 0; i < 3; i++) assert.equal((await call(e, '/premium/requests', { kind: 'nostalgia', text: `رسلمينيا ${17 + i} كاملة` }, s.token)).status, 200);
  assert.equal((await call(e, '/premium/requests', { kind: 'series', text: 'سلسلة أخرى' }, s.token)).status, 429);
  const mine = (await call(e, '/premium/requests', undefined, s.token)).body.items;
  assert.equal(mine.length, 3);
  assert.equal((await studioPremiumRequest(e, { id: mine[0].id, status: 'done', reply: 'تمت الترجمة', link: '/nostalgia/wrestlemania-19/' })).success, true);
  const after = (await call(e, '/premium/requests', undefined, s.token)).body.items.find((x: any) => x.id === mine[0].id);
  assert.equal(after.status, 'done');
  assert.equal(after.link, '/nostalgia/wrestlemania-19/');
  // a link elsewhere is not kept
  await studioPremiumRequest(e, { id: mine[1].id, status: 'done', link: 'https://evil.example/x' });
  assert.equal((await call(e, '/premium/requests', undefined, s.token)).body.items.find((x: any) => x.id === mine[1].id).link, '');
  const p: any = await studioPremium(e);
  assert.equal(p.members.length, 1);
  assert.equal(p.requests.length, 3);
  // taken back
  await studioPremiumGrant(e, s.member.id, 0);
  assert.equal((await me(e, s.token)).premium, 0);
});

test('a premium member\'s comments carry the blue badge and the premium mark', async () => {
  const e = env();
  e.MEDIA = null;
  const s = await member(e);
  await studioPremiumGrant(e, s.member.id, 30);
  const STORY = '/news/خبر/';
  const r = await handleComments(new Request('https://w/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'تعليق مميز' }), headers: { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` } }), e, new URL('https://w/comments')).then((x) => x.json() as any);
  assert.equal(r.prem, true);
  assert.equal(r.blue, true);
  const list: any = await handleComments(new Request(`https://w/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json());
  assert.equal(list.items[0].prem, true);
});

test('a show file\'s links and time are read from its frontmatter; keys stay inside the three folders', () => {
  const file = `---\ntitle: RAW 13.10.2026\ndate: 2026-10-14T20:00:00.000+03:00\nservers:\n  - name: سيرفر 1\n    url: https://ok.ru/videoembed/123\n  - name: سيرفر 2\n    url: "https://vidmoly.to/embed-abc.html"\ndownloads_high: |-\n  https://pixeldrain.com/u/x1\n  https://gofile.io/d/y2\ndownloads_low: https://pixeldrain.com/u/low\nimage: /content/images/raw.webp\n---\nنص`;
  const l = showLinks(file);
  assert.deepEqual(l.servers, ['https://ok.ru/videoembed/123', 'https://vidmoly.to/embed-abc.html']);
  assert.deepEqual(l.downloads, ['https://pixeldrain.com/u/x1', 'https://gofile.io/d/y2', 'https://pixeldrain.com/u/low']);
  assert.equal(l.date, Date.parse('2026-10-14T20:00:00.000+03:00'));
  assert.equal(contentKey('shows/2026-10-14-raw'), 'shows/2026-10-14-raw');
  assert.equal(contentKey('nostalgia/wm-19'), 'nostalgia/wm-19');
  for (const bad of ['news/x', 'shows/../secrets', 'shows/a/b', '../shows/x', 'shows/', '']) assert.equal(contentKey(bad), '', bad);
});

test('premium servers: a count for anyone, the links only for a premium member (and the owner\'s account)', async () => {
  const e = env();
  const s = await member(e);
  const k = 'shows/2026-10-14-raw';
  const saved: any = await studioPremiumMedia(e, k, { servers: ['https://vip.example/e/1', 'javascript:alert(1)', 'https://vip.example/e/2'], downloads: ['https://dl.example/f'] });
  assert.deepEqual(saved.servers, ['https://vip.example/e/1', 'https://vip.example/e/2']);
  const anon = await call(e, `/premium/media?k=${k}`);
  assert.deepEqual([anon.body.servers, anon.body.downloads, anon.body.links], [2, 1, undefined]);
  assert.equal((await call(e, `/premium/media?k=${k}`, undefined, s.token)).body.links, undefined);
  assert.equal((await call(e, '/premium/media?k=news/x')).status, 400);
  await studioPremiumGrant(e, s.member.id, 30);
  const prem = await call(e, `/premium/media?k=${k}`, undefined, s.token);
  assert.deepEqual(prem.body.links, { servers: ['https://vip.example/e/1', 'https://vip.example/e/2'], downloads: ['https://dl.example/f'] });
  // the official account has every perk
  const o = await member(e, 'arw_owner');
  await e.ANALYTICS.prepare('UPDATE members SET official = 1 WHERE id = ?1').bind(o.member.id).run();
  assert.equal((await call(e, `/premium/media?k=${k}`, undefined, o.token)).body.links.servers.length, 2);
  // emptied in the panel: gone
  await studioPremiumMedia(e, k, { servers: [], downloads: [] });
  assert.deepEqual((await call(e, `/premium/media?k=${k}`)).body, { ok: true, servers: 0, downloads: 0 });
});

test('a show before its time: a premium member gets its links now, everyone else only after its time', async () => {
  const pub = Date.now() + 2 * 3600e3;
  const file = `---\ntitle: RAW\ndate: ${new Date(pub).toISOString()}\nservers:\n  - url: https://ok.ru/videoembed/9\ndownloads: https://pixeldrain.com/u/z\n---\n`;
  let reads = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes('/contents/content/shows/2026-10-14-raw.md')) { reads++; return new Response(JSON.stringify({ content: Buffer.from(file).toString('base64'), sha: 's1' })); }
    if (u.includes('/contents/')) { reads++; return new Response('{}', { status: 404 }); }
    return new Response('{}', { status: 404 });
  }) as any;
  try {
    const e = env({ GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 't' });
    const s = await member(e);
    const k = 'shows/2026-10-14-raw';
    const anon = await call(e, `/premium/early?k=${k}`);
    assert.equal(anon.status, 403);
    assert.equal(anon.body.servers, undefined);
    assert.equal(anon.body.pub, pub);
    assert.equal((await call(e, `/premium/early?k=${k}`, undefined, s.token)).status, 403);
    await studioPremiumGrant(e, s.member.id, 30);
    const early = await call(e, `/premium/early?k=${k}`, undefined, s.token);
    assert.deepEqual([early.body.servers, early.body.downloads, early.body.premium], [['https://ok.ru/videoembed/9'], ['https://pixeldrain.com/u/z'], true]);
    assert.equal(reads, 1); // read once, then kept for two minutes
    // after its time: anyone (the page waits for the next build)
    const after = await call(e, `/premium/early?k=${k}`, undefined, '', pub + 1000);
    assert.equal(after.status, 200);
    assert.deepEqual(after.body.servers, ['https://ok.ru/videoembed/9']);
    // a file that isn't there: 404, and asked once only
    assert.equal((await call(e, '/premium/early?k=shows/nothing')).status, 404);
    assert.equal((await call(e, '/premium/early?k=shows/nothing')).status, 404);
    assert.equal(reads, 2);
  } finally { globalThis.fetch = real; }
});

test('Fawaterk by its OAuth client: a token asked once and kept, a refused one asked again; the panel sees the site as live', async () => {
  const e = env({ PREMIUM_AUTO: '1', FAWATERK_CLIENT_ID: 'cid', FAWATERK_CLIENT_SECRET: 'csec' });
  const s = await member(e);
  const real = globalThis.fetch;
  let tokens = 0, refuseNext = false;
  const auths: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/oauth/token')) {
      const b = new URLSearchParams(init.body);
      assert.equal(b.get('grant_type'), 'client_credentials');
      assert.equal(b.get('client_id'), 'cid');
      tokens++;
      return new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 3600, access_token: `tok${tokens}` }));
    }
    if (u.endsWith('/createInvoiceLink')) {
      auths.push(init.headers.Authorization);
      if (refuseNext) { refuseNext = false; return new Response('{"message":"Unauthenticated."}', { status: 401 }); }
      return new Response(JSON.stringify({ status: 'success', data: { url: 'https://app.fawaterk.com/link/1', invoiceId: 1, invoiceKey: 'k1' } }));
    }
    return new Response('{}', { status: 404 });
  }) as any;
  try {
    assert.equal((await call(e, '/premium/checkout', { currency: 'EGP' }, s.token)).body.url, 'https://app.fawaterk.com/link/1');
    assert.equal((await call(e, '/premium/checkout', { currency: 'EGP' }, s.token)).body.url, 'https://app.fawaterk.com/link/1');
    assert.equal(tokens, 1); // kept between calls
    refuseNext = true;
    assert.equal((await call(e, '/premium/checkout', { currency: 'USD' }, s.token)).body.url, 'https://app.fawaterk.com/link/1');
    assert.equal(tokens, 2); // refused: a new one
    assert.deepEqual(auths, ['Bearer tok1', 'Bearer tok1', 'Bearer tok1', 'Bearer tok2']);
    assert.equal((await studioPremium(e) as any).live, true);
  } finally { globalThis.fetch = real; }
  // Fawaterk down: the member still gets a way to pay (the fixed link)
  const e2 = env({ PREMIUM_AUTO: '1', FAWATERK_CLIENT_ID: 'cid', FAWATERK_CLIENT_SECRET: 'csec' });
  const s2 = await member(e2);
  globalThis.fetch = (async () => new Response('down', { status: 500 })) as any;
  try { const r = await call(e2, '/premium/checkout', { currency: 'USD' }, s2.token); assert.equal(r.body.manual, true); assert.equal(r.body.url, PLANS.USD.link); }
  finally { globalThis.fetch = real; }
});

test('the panel\'s bell: a new subscriber and a new translation request', async () => {
  const e = env();
  const s = await member(e);
  const t0 = Date.now();
  await studioPremiumGrant(e, s.member.id, 30, 'mohamed');
  await call(e, '/premium/requests', { kind: 'series', text: 'سلسلة عروض الأتيتيود كاملة' }, s.token);
  const n = await premiumNotifications(e, t0 - 1000);
  const pay = n.find((x: any) => x.type === 'premium-pay'), req = n.find((x: any) => x.type === 'premium-req');
  assert.equal(pay.by, 'mohamed');
  assert.equal(pay.name, s.member.display);
  assert.equal(req.text, 'سلسلة عروض الأتيتيود كاملة');
  assert.equal((await premiumNotifications(e, Date.now() + 1000)).length, 0);
});

test('changing the e-mail: the password first; with mail on, only once the new address confirms it', async () => {
  // mail off: at once
  const e = env();
  const s = await member(e);
  const post = (ee: any, path: string, body: any, token = '') => handleMembers(new Request(`https://w/members${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), ee, new URL(`https://w/members${path}`)).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  assert.equal((await post(e, '/email', { email: 'new@example.com', current: 'wrong' }, s.token)).status, 400);
  assert.equal((await post(e, '/email', { email: 'not-an-email', current: 'raw2026night' }, s.token)).status, 400);
  const o = await member(e, 'other_one');
  assert.equal((await post(e, '/email', { email: 'other_one@example.com', current: 'raw2026night' }, s.token)).status, 409);
  const ok = await post(e, '/email', { email: 'new@example.com', current: 'raw2026night' }, s.token);
  assert.equal(ok.body.member.email, 'new@example.com');
  assert.ok(o.token);
  // mail on: a link to the new address; the old one stays until it is pressed
  const sent: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { if (String(url).includes('resend.com')) { sent.push(JSON.parse(init.body)); return new Response('{}'); } return new Response('{}', { status: 404 }); }) as any;
  try {
    const base = env();
    const s2 = await member(base, 'mail_on'); // signed up before mail was on (with it, sign-up waits for activation)
    const e2 = { ...base, RESEND_API_KEY: 're_test' };
    await e2.ANALYTICS.prepare('UPDATE members SET verified = 1').run();
    const r = await post(e2, '/email', { email: 'fresh@example.com', current: 'raw2026night' }, s2.token);
    assert.equal(r.body.pending, true);
    const mail = sent.find((m) => m.to[0] === 'fresh@example.com');
    const token = mail.html.match(/\?email=([A-Za-z0-9_-]+)/)[1];
    assert.equal((await me(e2, s2.token)).email, 'mail_on@example.com');
    assert.equal((await post(e2, '/email-confirm', { token })).body.ok, true);
    assert.equal((await me(e2, s2.token)).email, 'fresh@example.com');
    assert.equal((await post(e2, '/email-confirm', { token })).status, 400); // once
  } finally { globalThis.fetch = real; }
});

test('«اشتراكي»: since when, until when, and the payments (a gift from the panel too); others never see them', async () => {
  const e = env();
  const s = await member(e);
  const o = await member(e, 'someone_else');
  assert.equal((await call(e, '/premium/mine')).status, 401);
  let d = (await call(e, '/premium/mine', undefined, s.token)).body;
  assert.deepEqual([d.until, d.payments.length, d.official], [0, 0, false]);
  await studioPremiumGrant(e, s.member.id, 30, 'mohamed');
  d = (await call(e, '/premium/mine', undefined, s.token)).body;
  assert.ok(d.until > Date.now() && d.since > 0);
  assert.equal(d.payments.length, 1);
  assert.deepEqual([d.payments[0].paid, d.payments[0].gift, d.payments[0].days], [true, true, 30]);
  assert.equal((await call(e, '/premium/mine', undefined, o.token)).body.payments.length, 0);
});

test('the owner\'s badges: none, blue or gold for any member; a member\'s page corrected from the panel', async () => {
  const { studioBadgeMember, studioEditMember } = await import('../worker/src/members');
  const e = env();
  e.MEDIA = null;
  const s = await member(e);
  assert.equal((await me(e, s.token)).blue, false);
  await studioBadgeMember(e, s.member.id, true, 2);
  const m = await me(e, s.token);
  assert.deepEqual([m.gold, m.blue], [true, true]);
  const STORY = '/news/خبر/';
  await handleComments(new Request('https://w/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'تعليق ذهبي' }), headers: { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` } }), e, new URL('https://w/comments'));
  const list: any = await handleComments(new Request(`https://w/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json());
  assert.equal(list.items[0].gold, true);
  await studioBadgeMember(e, s.member.id, false, 0);
  assert.deepEqual([(await me(e, s.token)).gold, (await me(e, s.token)).blue], [false, false]);
  // the owner corrects the member's page
  assert.equal((await studioEditMember(e, s.member.id, { display: 'ا' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { display: 'كريم المصري', bio: 'نبذة جديدة', pic: '' })).success, true);
  const after = await me(e, s.token);
  assert.deepEqual([after.display, after.bio, after.pic], ['كريم المصري', 'نبذة جديدة', '']);
});

test('a subscription that ran out: the ten-minute sweep tells every room, grants and badge changes tell them at once', async () => {
  const { chatExpirySweep, chatRebadge } = await import('../worker/src/chat');
  const sent: any[] = [];
  const CHAT = { idFromName: (n: string) => n, get: (room: string) => ({ fetch: async (_u: string, init: any) => { sent.push({ room, ...JSON.parse(init.body) }); return new Response('{"ok":true}'); } }) };
  const e = env({ CHAT });
  const a = await member(e, 'ended_sub');
  const b = await member(e, 'still_on');
  const now = Date.now();
  const db = e.ANALYTICS.raw;
  const idOf = (u: string) => (db.prepare('SELECT id FROM members WHERE username = ?').get(u) as any).id;
  db.prepare('UPDATE members SET premium_until = ?, badge = 0 WHERE id = ?').run(now - 3 * 60e3, idOf('ended_sub'));
  db.prepare('UPDATE members SET premium_until = ?, badge = 0 WHERE id = ?').run(now + 20 * 86400e3, idOf('still_on'));
  await chatExpirySweep(e, now);
  assert.ok(sent.length > 0);
  assert.ok(sent.every(x => x.op === 'badge' && x.uid === idOf('ended_sub') && x.badge === ''));
  assert.equal(new Set(sent.map(x => x.room)).size, sent.length);
  sent.length = 0;
  await chatRebadge(e, idOf('still_on'));
  assert.ok(sent.length > 0 && sent.every(x => x.badge === 'premium'));
  assert.ok(a.token && b.token);
});

test('the whole life of a membership: nothing on signing up, everything on subscribing, gone when it ends, back on renewing', async () => {
  const e = env();
  e.MEDIA = null;
  const s = await member(e, 'life_cycle');
  const id = s.member.id;
  const db = e.ANALYTICS.raw;
  const STORY = '/news/دورة/';
  const comments = async () => (await handleComments(new Request(`https://w/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json()) as any).items[0];
  const look = async () => { const m = await me(e, s.token); const c = await comments(); return { blue: m.blue, premium: Number(m.premium) > Date.now(), gold: m.gold, cBlue: !!c.blue, cPrem: !!c.prem, cGold: !!c.gold }; };
  const NONE = { blue: false, premium: false, gold: false, cBlue: false, cPrem: false, cGold: false };
  const ON = { blue: true, premium: true, gold: false, cBlue: true, cPrem: true, cGold: false };
  await handleComments(new Request('https://w/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'أول تعليق ليا' }), headers: { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.9', 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` } }), e, new URL('https://w/comments'));
  assert.deepEqual(await look(), NONE, 'a new member: no badge, no premium look');
  await studioPremiumGrant(e, id, 30);
  assert.deepEqual(await look(), ON, 'subscribed: the badge and the premium look, old comments included');
  db.prepare('UPDATE members SET premium_until = ? WHERE id = ?').run(Date.now() - 1000, id);
  assert.deepEqual(await look(), NONE, 'ended: all of it gone');
  await studioPremiumGrant(e, id, 30);
  assert.deepEqual(await look(), ON, 'renewed: all of it back');
  const mine = (await call(e, '/premium/mine', undefined, s.token)).body;
  assert.ok(mine.until > Date.now() + 29 * 86400e3 && mine.payments.length === 2);
});

test('longer plans: 3 months or a year, cheaper a month, the right days credited', async () => {
  const e = env({ PREMIUM_AUTO: '1', FAWATERK_API_KEY: 'fk_test' });
  const s = await member(e, 'year_fan');
  const f = fawaterk();
  try {
    await call(e, '/premium/checkout', { currency: 'EGP', plan: 'm12' }, s.token);
    assert.equal(f.made[0].b.cartTotal, String(OFFERS.m12.EGP));
    assert.match(f.made[0].b.cartItems[0].name, /سنة/);
    f.paid.add('1000');
    const t0 = Date.now();
    const until = (await call(e, '/premium/check', {}, s.token, t0)).body.premium;
    assert.ok(Math.abs(until - (t0 + 365 * 864e5)) < 5000);
    await call(e, '/premium/checkout', { currency: 'USD', plan: 'm3' }, s.token);
    assert.equal(f.made[1].b.cartTotal, '2.5');
    f.paid.add('1001');
    assert.ok(Math.abs((await call(e, '/premium/check', {}, s.token, t0 + 1000)).body.premium - (until + 90 * 864e5)) < 5000);
    // an unknown plan is a month
    await call(e, '/premium/checkout', { currency: 'EGP', plan: 'forever' }, s.token);
    assert.equal(f.made[2].b.cartTotal, '50');
  } finally { f.restore(); }
  // without Fawaterk's key, each plan opens its own fixed link (the owner's, 2026-10-15)
  const e2 = env();
  const s2 = await member(e2, 'no_key');
  for (const [plan, cur, item] of [['m1', 'EGP', 16781], ['m1', 'USD', 16782], ['m3', 'EGP', 16788], ['m12', 'EGP', 16789], ['m3', 'USD', 16790], ['m12', 'USD', 16791]] as const) {
    const r = await call(e2, '/premium/checkout', { currency: cur, plan }, s2.token);
    assert.equal(r.body.manual, true);
    assert.match(r.body.url, new RegExp(`^https://app\\.fawaterk\\.com/invoices/item/${item}/`), `${plan} ${cur}`);
  }
});

test('no free trial (owner 2026-10-15: «مفيش اشتراك مجاني خالص»): never offered, refused, and memberships from the old trial ended; paid and given ones stay', async () => {
  const { endTrials } = await import('../worker/src/premium');
  const e = env();
  const db = e.ANALYTICS.raw;
  const s = await member(e, 'no_trial');
  assert.equal((await me(e, s.token)).trial, false);
  assert.equal((await call(e, '/premium/mine', undefined, s.token)).body.trial, false);
  const r = await call(e, '/premium/trial', {}, s.token);
  assert.equal(r.status, 410);
  assert.equal((await me(e, s.token)).premium, 0);
  // members who took the old trial: one with the trial only, one who paid after it, one given days by the owner after it
  const now = Date.now();
  const only = await member(e, 'trial_only'), paid = await member(e, 'trial_then_paid'), gift = await member(e, 'trial_then_gift');
  for (const m of [only, paid, gift]) {
    db.prepare('UPDATE members SET premium_until = ? WHERE id = ?').run(now + 2 * 864e5, m.member.id);
    db.prepare("INSERT INTO premium_payments (member, currency, amount, status, created, paid_at, days, granted_by) VALUES (?, 'EGP', 0, 'paid', ?, ?, 3, 'trial')").run(m.member.id, now - 864e5, now - 864e5);
  }
  db.prepare("INSERT INTO premium_payments (member, currency, amount, status, created, paid_at, days, granted_by) VALUES (?, 'EGP', 50, 'paid', ?, ?, 30, '')").run(paid.member.id, now, now);
  await studioPremiumGrant(e, gift.member.id, 10, 'mohamed');
  assert.equal(await endTrials(e, now), 1);
  assert.equal((await me(e, only.token)).premium, 0);
  assert.ok((await me(e, paid.token)).premium > now);
  assert.ok((await me(e, gift.token)).premium > now);
  // the history still shows the trial
  const pays = (await call(e, '/premium/mine', undefined, only.token)).body.payments;
  assert.equal(pays[0].trial, true);
});

test('a membership about to end and one that just ended: the member is told once each', async () => {
  const e = env();
  const s = await member(e, 'renew_me');
  const db = e.ANALYTICS.raw;
  const now = Date.now();
  db.prepare('UPDATE members SET premium_until = ? WHERE id = ?').run(now + 2 * 864e5, s.member.id);
  assert.equal(await runPremiumReminders(e, now), 1);
  await runPremiumReminders(e, now + 3600e3);
  const inbox = () => db.prepare('SELECT title, url FROM member_inbox WHERE member = ?').all(s.member.id) as any[];
  assert.equal(inbox().length, 1);
  assert.match(inbox()[0].title, /تنتهي بعد 2 أيام|تنتهي بعد يوم/);
  // the end passes
  await runPremiumReminders(e, now + 2 * 864e5 + 3600e3);
  assert.equal(inbox().length, 2);
  assert.match(inbox()[1].title, /انتهت عضويتك/);
  await runPremiumReminders(e, now + 2 * 864e5 + 7200e3);
  assert.equal(inbox().length, 2);
});

test('the owner turns a membership on by hand: the member found by email or username, any number of days', async () => {
  const { studioPremiumFind } = await import('../worker/src/premium');
  const e = env();
  const s = await member(e, 'paid_by_hand');
  const row: any = await e.ANALYTICS.prepare("SELECT id, email FROM members WHERE username = 'paid_by_hand'").first();
  // the email as the follower sends it on Messenger: other case, spaces, an invisible mark
  const byMail = await studioPremiumFind(e as any, `  ${row.email.toUpperCase()}‎ `);
  assert.equal(byMail.success, true);
  assert.equal((byMail as any).member.id, row.id);
  assert.equal(((await studioPremiumFind(e as any, '@Paid_By_Hand')) as any).member.id, row.id);
  assert.equal((await studioPremiumFind(e as any, 'nobody@example.com')).success, false);
  // 45 days, then 10 more on top of what's left
  const t0 = Date.now();
  const g1: any = await studioPremiumGrant(e as any, row.id, 45, 'owner', t0);
  assert.ok(Math.abs(g1.until - (t0 + 45 * 864e5)) < 5000);
  const g2: any = await studioPremiumGrant(e as any, row.id, 10, 'owner', t0);
  assert.ok(Math.abs(g2.until - (t0 + 55 * 864e5)) < 5000);
  assert.equal(((await studioPremiumFind(e as any, row.email)) as any).member.premium, true);
  assert.ok(s.token);
});

test('the owner turns paid memberships on by hand (owner 2026-10-15): with Fawaterk\'s key but no PREMIUM_AUTO, the fixed links, and nothing turns on by itself', async () => {
  const e = env({ FAWATERK_API_KEY: 'fk_test' });
  const s = await member(e, 'by_hand_only');
  const f = fawaterk();
  try {
    const r = await call(e, '/premium/checkout', { currency: 'EGP', plan: 'm3' }, s.token);
    assert.equal(r.body.manual, true);
    assert.match(r.body.url, /invoices\/item\/16788\//);
    assert.equal(f.made.length, 0, 'no invoice of the site\'s own');
    assert.equal((await studioPremium(e)).live, false);
    // and no free trial
    assert.equal((await call(e, '/premium/trial', {}, s.token)).status, 410);
  } finally { f.restore(); }
});

test('the owner edits anything of a member: username, e-mail, password and picture, with the same rules as the member', async () => {
  const { studioEditMember } = await import('../worker/src/members');
  const e = env();
  const files = new Map<string, any>();
  e.MEDIA = { put: async (k: string, v: any) => { files.set(k, v); }, delete: async (k: string) => { files.delete(k); }, get: async (k: string) => files.get(k) ?? null };
  const s = await member(e);
  const other = await member(e, 'samir_22');
  const login = async (who: string, password: string) => (await (await handleMembers(new Request('https://w/members/login', { method: 'POST', body: JSON.stringify({ login: who, password }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' } }), e, new URL('https://w/members/login'))).json() as any);
  // someone else's name or address, or a bad one, is refused and nothing changes
  assert.equal((await studioEditMember(e, s.member.id, { username: 'Samir_22' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { email: 'samir_22@example.com' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { username: '1abc' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { email: 'not-mail' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { password: 'short' })).success, false);
  assert.equal((await studioEditMember(e, s.member.id, { image: 'data:image/png;base64,AAAA' })).success, false);
  assert.equal((await me(e, s.token)).username, 'kareem_10');
  // a picture: a real one is kept in the member's folder
  const webp = new Uint8Array(400); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const image = 'data:image/webp;base64,' + Buffer.from(webp).toString('base64');
  const r1: any = await studioEditMember(e, s.member.id, { image });
  assert.equal(r1.success, true);
  const pic = (await me(e, s.token)).pic;
  assert.match(pic, new RegExp(`/members/pic/${s.member.id}/[a-f0-9]{16}\\.webp$`));
  assert.equal(files.size, 1);
  // username and e-mail: the member stays signed in while the password is unchanged… until the e-mail changes
  const r2: any = await studioEditMember(e, s.member.id, { username: 'kareem_new', email: 'New@Example.com' });
  assert.deepEqual([r2.success, r2.changed.username, r2.changed.email], [true, true, true]);
  assert.equal(await me(e, s.token), undefined);
  // a new password: signs in with it under the new name and the new address, never with the old one
  const r3: any = await studioEditMember(e, s.member.id, { password: 'fresh2026pass' });
  assert.equal(r3.changed.password, true);
  assert.equal((await login('kareem_10', 'raw2026night')).ok, false);
  assert.equal((await login('kareem_new', 'raw2026night')).ok, false);
  const ok = await login('new@example.com', 'fresh2026pass');
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.member.username, ok.member.email, ok.member.pic], ['kareem_new', 'new@example.com', pic]);
  // the picture taken off: the file goes too
  assert.equal((await studioEditMember(e, s.member.id, { pic: '' })).success, true);
  assert.equal(files.size, 0);
  // the other member is untouched
  assert.equal((await me(e, other.token)).username, 'samir_22');
});

test('a show page comes with its premium line, and a Google Drive link plays and downloads as Google Drive (owner 2026-10-16, INCIDENTS #630)', async () => {
  // «عايز … تكون ظاهرة علطول لانها بتاخد وقت علي ما بتظهر»: the build knows which shows have premium links (counts only)
  const { premiumSummary } = await import('../worker/src/premium.ts');
  assert.deepEqual(premiumSummary([
    { k: 'shows/a', servers: '["https://x/1"]', downloads: '[]' },
    { k: 'shows/b', servers: '[]', downloads: '[]' },
    { k: 'shows/c', servers: 'not json', downloads: '[]' },
    { k: 'shows/d', servers: '["u","v"]', downloads: '["w"]' },
  ]), { 'shows/a': [1, 0], 'shows/d': [2, 1] });
  const fs = await import('node:fs');
  const layout = fs.readFileSync('_includes/post-layout.njk', 'utf-8');
  assert.match(layout, /set pm = premiumMedia\[pk\]/);
  assert.match(layout, /class="wd-prem" id="wdPrem"/);
  assert.match(layout, /window\.__arwPrem=fetch\(/);
  const player = fs.readFileSync('assets/post-player.js', 'utf-8');
  assert.match(player, /window\.__arwPrem/);
  assert.match(player, /getElementById\('wdPrem'\)/);
  assert.match(fs.readFileSync('assets/post-layout.css', 'utf-8'), /\.wd-prem\[hidden\]\{ display:none; \}/);
  // «اني احط فقط اللينك وهو يتحول ل سيرفر امبيد لوحده»
  const { toEmbedUrl } = (await import('../lib/embed.cjs')).default;
  const id = '1M18MIZ5Yc0uDL1G3V9eVXfE81Y_zduXA', want = `https://drive.google.com/file/d/${id}/preview`;
  for (const u of [`https://drive.google.com/file/d/${id}/view?usp=sharing`, `https://drive.google.com/file/d/${id}/view`, want,
    `https://drive.google.com/open?id=${id}`, `https://drive.google.com/file/u/0/d/${id}/view`, `https://docs.google.com/uc?export=download&id=${id}`]) {
    assert.equal(toEmbedUrl(u), want, u);
  }
  // the same rule in the page's player, which turns a premium member's links into players
  const rule = player.match(/url = url\.replace\(\/\^https\?:\\\/\\\/\(\?:drive\|docs\)[^\n]*/);
  assert.ok(rule, 'Drive rule in assets/post-player.js');
  // the download card: «Google Drive» and its logo, not «drive.google.com»
  const config = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.match(config, /"drive\.google\.com": "Google Drive"/);
  assert.match(config, /"drive\.google\.com": "\/assets\/hosts\/google-drive\.svg"/);
  assert.ok(fs.existsSync('assets/hosts/google-drive.svg'));
  assert.match(player, /'drive\.google\.com': \['Google Drive', '\/assets\/hosts\/google-drive\.svg'\]/);
});

test('a membership turned on by hand is told as paid or as a gift, and the member sees which (owner 2026-10-16)', async () => {
  // «يكون في تفريق بين اني مديله العضوية او الاشتراك هدية من الموقع وبين ان هو دافع فا ميتكتبش عنده انه هدية من الموقع»
  const e = env();
  const s = await member(e);
  await studioPremiumGrant(e, s.member.id, 30, 'mohamed', Date.now(), { kind: 'paid', amount: 50, currency: 'EGP', method: 'فودافون كاش', reference: '123' });
  let pays = (await call(e, '/premium/mine', undefined, s.token)).body.payments;
  assert.equal(pays[0].gift, false);
  assert.equal(pays[0].amount, 50);
  assert.equal(pays[0].method, 'فودافون كاش');
  // the panel: «مدفوع», counted in the month's money
  let p: any = await studioPremium(e);
  assert.equal(p.members[0].premium_by, 'paid:mohamed');
  assert.equal(p.month.find((x: any) => x.currency === 'EGP').total, 50);
  // a gift stays a gift
  await studioPremiumGrant(e, s.member.id, 7, 'mohamed', Date.now() + 1, { kind: 'gift' });
  pays = (await call(e, '/premium/mine', undefined, s.token)).body.payments;
  const gift = pays.find((x: any) => x.days === 7);
  assert.equal(gift.gift, true);
  assert.equal(gift.amount, 0);
  // an old one told again: paid after all, with no amount → the member sees «اشتراك مدفوع», never «هدية»
  p = await studioPremium(e);
  const giftRow = p.payments.find((x: any) => x.days === 7);
  assert.equal((await studioPremiumKind(e, giftRow.id, { kind: 'paid' })).success, true);
  pays = (await call(e, '/premium/mine', undefined, s.token)).body.payments;
  assert.equal(pays.find((x: any) => x.days === 7).gift, false);
  // a trial or a Fawaterk payment can't be told again by hand
  await e.ANALYTICS.prepare("INSERT INTO premium_payments (member, currency, amount, status, created, paid_at, days, granted_by) VALUES (?1, 'EGP', 50, 'paid', 1, 1, 30, '')").bind(s.member.id).run();
  const online: any = await e.ANALYTICS.prepare("SELECT id FROM premium_payments WHERE granted_by = ''").first();
  assert.equal((await studioPremiumKind(e, online.id, { kind: 'gift' })).success, false);
  // the member's page writes «اشتراك مدفوع» for a paid one with no amount
  const fs = await import('node:fs');
  assert.match(fs.readFileSync('assets/account.js', 'utf-8'), /p\.gift \? 'هدية من الموقع' : !Number\(p\.amount\) \? 'اشتراك مدفوع'/);
  const panel = fs.readFileSync('studio/js/views/premium.js', 'utf-8');
  assert.match(panel, /data-kind="paid">دفع<\/button><button type="button" class="chip" data-kind="gift">هدية من الموقع/);
  assert.match(panel, /q\('go'\)\.disabled = !ok \|\| !kind;/);
});
