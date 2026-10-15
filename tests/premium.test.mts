// «العضوية المميزة» (owner 2026-10-14): paid on Fawaterk, on at once, 30 days a payment, each invoice once.
// D1 is a real SQLite here; Fawaterk is a stand-in fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { handleMembers } from '../worker/src/members';
import { handleComments } from '../worker/src/comments';
import { handlePremium, studioPremium, studioPremiumGrant, studioPremiumRequest, studioPremiumMedia, showLinks, contentKey, premiumNotifications, PLANS } from '../worker/src/premium';

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
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'raw2026night', captcha: { id: cap.id, answer: e.PUSH_KV.m.get(`members:cap:${cap.id}`) } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${username.length}` } }), e, new URL('https://w/members/signup'));
  return (await r.json() as any) as { token: string; member: any };
}
const call = async (e: any, path: string, body?: any, token = '', now?: number) => {
  const r = await handlePremium(new Request(`https://w${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL(`https://w${path}`), now);
  return { status: r.status, body: await r.json() as any };
};
const me = async (e: any, token: string) => (await (await handleMembers(new Request('https://w/members/me', { headers: { Authorization: `Bearer ${token}` } }), e, new URL('https://w/members/me'))).json() as any).member;
/** A stand-in Fawaterk: invoices it made, and which of them were paid */
function fawaterk() {
  const made: any[] = []; const paid = new Set<string>();
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/createInvoiceLink')) { const b = JSON.parse(init.body); const id = String(1000 + made.length); made.push({ id, b, auth: init.headers.Authorization }); return new Response(JSON.stringify({ status: 'success', data: { url: `https://app.fawaterk.com/link/${id}`, invoiceId: Number(id), invoiceKey: `k${id}` } })); }
    const g = u.match(/getInvoiceData\/(\d+)/);
    if (g) return new Response(JSON.stringify({ status: 'success', data: { invoice_id: Number(g[1]), paid: paid.has(g[1]) ? 1 : 0, payment_method: 'Card', referenceNumber: 'R' + g[1] } }));
    return new Response('{}', { status: 404 });
  }) as any;
  return { made, paid, restore: () => { globalThis.fetch = real; } };
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
  const e = env({ FAWATERK_API_KEY: 'fk_test' });
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

test('the webhook: signed by Fawaterk, then confirmed by asking Fawaterk; unknown or unpaid invoices change nothing', async () => {
  const e = env({ FAWATERK_API_KEY: 'fk_test', FAWATERK_VENDOR_KEY: 'vendor_secret' });
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
  } finally { f.restore(); }
  // without the API key: the signature decides (a wrong key: nothing)
  const e2 = env({ FAWATERK_VENDOR_KEY: 'vendor_secret' });
  const s2 = await member(e2);
  await studioPremium(e2); // the tables
  await e2.ANALYTICS.prepare("INSERT INTO premium_payments (member, invoice_id, invoice_key, currency, amount, created) VALUES (?1, '77', 'k77', 'EGP', 50, ?2)").bind(s2.member.id, Date.now()).run();
  const signed = (key: string) => { const b: any = { invoice_id: 77, invoice_key: 'k77', payment_method: 'Fawry', invoice_status: 'paid' }; b.hashKey = createHmac('sha256', key).update(`InvoiceId=77&InvoiceKey=k77&PaymentMethod=Fawry`).digest('hex'); return call(e2, '/premium/webhook', b); };
  assert.equal((await signed('wrong')).body.paid, false);
  assert.equal((await signed('vendor_secret')).body.paid, true);
  assert.ok((await me(e2, s2.token)).premium > Date.now());
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
  const e = env({ FAWATERK_CLIENT_ID: 'cid', FAWATERK_CLIENT_SECRET: 'csec' });
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
  const e2 = env({ FAWATERK_CLIENT_ID: 'cid', FAWATERK_CLIENT_SECRET: 'csec' });
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
