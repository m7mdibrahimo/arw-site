// «المتابعة» (owner 2026-10-15): a member follows a program or a promotion, and each new full show reaches them:
// in their inbox (the bell), and on their devices if they allowed it. D1 is a real SQLite here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMembers } from '../worker/src/members';
import { handleFollows, runFollowNotify, runFollowPush, followKeyOk, MAX_FOLLOWS } from '../worker/src/follows';

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
const env = (): any => ({ ANALYTICS: d1(), PUSH_KV: kv(), SITE_ORIGIN: 'https://arab-wrestling.com' });
async function member(e: any, username: string) {
  const cap: any = await (await handleMembers(new Request('https://w/members/captcha'), e, new URL('https://w/members/captcha'))).json();
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'raw2026night', first_name: 'كريم', last_name: 'محمد', captcha: { id: cap.id, answer: e.PUSH_KV.m.get(`members:cap:${cap.id}`) } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${username.length}` } }), e, new URL('https://w/members/signup'));
  return (await r.json() as any) as { token: string; member: any };
}
const call = async (e: any, path: string, body?: any, token = '', now?: number) => {
  const r = await handleFollows(new Request(`https://w${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL(`https://w${path}`), now);
  return { status: r.status, body: await r.json() as any };
};
const NOW = Date.parse('2026-10-15T20:00:00Z');
const show = (url: string, program: string, fed: string, mins = 5) => ({ url, title: url.split('/')[2], headline: 'عرض ' + url.split('/')[2] + ' مترجم', program, program_name: program.toUpperCase(), fed, image: '/x.webp', date: new Date(NOW - mins * 60_000).toISOString() });
const site = (items: any[]) => (async (u: any) => /follow-feed\.json/.test(String(u)) ? new Response(JSON.stringify(items)) : new Response('', { status: 404 })) as any;

test('following: a program or a promotion, on and off, from anywhere; checked keys; a limit', async () => {
  const e = env();
  const s = await member(e, 'kareem_10');
  assert.equal((await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' })).status, 401);
  assert.equal((await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' }, s.token)).body.on, true);
  assert.equal((await call(e, '/follow', { kind: 'fed', key: 'aew', label: 'AEW' }, s.token)).body.on, true);
  // the same twice is still one
  await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' }, s.token);
  let mine = (await call(e, '/follow', undefined, s.token)).body;
  assert.deepEqual(mine.follows.map((f: any) => `${f.kind}:${f.key}:${f.label}`).sort(), ['fed:aew:AEW', 'program:wwe-raw:WWE RAW']);
  assert.equal((await call(e, '/follow', { kind: 'program', key: 'wwe-raw', on: false }, s.token)).body.on, false);
  mine = (await call(e, '/follow', undefined, s.token)).body;
  assert.equal(mine.follows.length, 1);
  for (const [k, key] of [['program', '../x'], ['program', ''], ['fed', 'WWE RAW'], ['news', 'wwe'], ['fed', '<b>']]) assert.equal((await call(e, '/follow', { kind: k, key }, s.token)).status, 400, `${k}:${key}`);
  assert.ok(followKeyOk('program', 'wwe-raw') && followKeyOk('program', 'nwa-powerrr') && followKeyOk('fed', 'indie'));
  for (let i = 0; i < MAX_FOLLOWS; i++) await call(e, '/follow', { kind: 'program', key: `p${i}` }, s.token);
  assert.equal((await call(e, '/follow', { kind: 'program', key: 'one-more' }, s.token)).status, 400);
});

test('a new full show reaches the followers of its program and of its promotion, once; nothing else, nobody else', async () => {
  const e = env();
  const a = await member(e, 'raw_fan'), b = await member(e, 'wwe_fan'), c = await member(e, 'aew_fan');
  await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' }, a.token);
  await call(e, '/follow', { kind: 'fed', key: 'wwe', label: 'WWE' }, b.token);
  await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' }, b.token); // both: still one notice
  await call(e, '/follow', { kind: 'fed', key: 'aew', label: 'AEW' }, c.token);
  const old = [show('/shows/raw-06-10-2026/', 'wwe-raw', 'wwe', 60 * 24 * 7)];
  // the first time, what's on the site is not news
  await runFollowNotify(e, NOW, site(old));
  assert.equal((await call(e, '/follow/inbox', undefined, a.token)).body.items.length, 0);
  const feed = [show('/shows/raw-13-10-2026/', 'wwe-raw', 'wwe'), ...old];
  const r = await runFollowNotify(e, NOW, site(feed));
  assert.deepEqual(r, { added: 2, items: 1 });
  const ia = (await call(e, '/follow/inbox', undefined, a.token)).body;
  assert.equal(ia.items.length, 1);
  assert.equal(ia.unread, 1);
  assert.equal(ia.items[0].url, '/shows/raw-13-10-2026/');
  assert.equal(ia.items[0].title, 'عرض raw-13-10-2026 مترجم');
  assert.equal((await call(e, '/follow/inbox', undefined, b.token)).body.items.length, 1);
  assert.equal((await call(e, '/follow/inbox', undefined, c.token)).body.items.length, 0);
  // the next minute: nothing again
  assert.deepEqual(await runFollowNotify(e, NOW + 60_000, site(feed)), { added: 0, items: 0 });
  // a show set for later isn't news before its time; a recap or a story never is
  const later = [show('/shows/smackdown-17-10-2026/', 'wwe-smackdown', 'wwe', -120), { ...show('/recaps/raw-highlights/', 'wwe-raw', 'wwe') }, ...feed];
  assert.deepEqual(await runFollowNotify(e, NOW + 120_000, site(later)), { added: 0, items: 0 });
  // read: one, then all
  const id = ia.items[0].id;
  assert.equal((await call(e, '/follow/read', { id }, a.token)).body.unread, 0);
  assert.equal((await call(e, '/follow/read', { all: true }, b.token)).body.unread, 0);
  // the site can't be read: nothing breaks
  assert.deepEqual(await runFollowNotify(e, NOW, (async () => new Response('', { status: 500 })) as any), { added: 0, items: 0 });
});

test('the devices: a member allows it, a new show wakes their device, the service worker reads what is new with its own key', async () => {
  const e = env();
  const a = await member(e, 'raw_fan');
  await call(e, '/follow', { kind: 'program', key: 'wwe-raw', label: 'WWE RAW' }, a.token);
  assert.equal((await call(e, '/follow/push', { endpoint: 'https://evil.example/x' }, a.token)).status, 400);
  const reg = await call(e, '/follow/push', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, a.token);
  assert.match(reg.body.pk, /^[A-Za-z0-9_-]{32}$/);
  assert.ok((await call(e, '/follow/push-key')).body.key);
  await runFollowNotify(e, NOW, site([show('/shows/raw-06-10-2026/', 'wwe-raw', 'wwe', 60 * 24 * 7)]));
  await runFollowNotify(e, NOW, site([show('/shows/raw-13-10-2026/', 'wwe-raw', 'wwe')]));
  const woke: string[] = [];
  const pushSvc = (async (u: any) => { woke.push(String(u)); return new Response('', { status: 201 }); }) as any;
  assert.equal(await runFollowPush(e, NOW, pushSvc), 1);
  assert.deepEqual(woke, ['https://fcm.googleapis.com/fcm/send/abc']);
  // once
  assert.equal(await runFollowPush(e, NOW, pushSvc), 0);
  // what the woken service worker reads: the show, with nothing else of the member's
  const peek = (await call(e, '/follow/peek', { pk: reg.body.pk, since: 0 }, '', NOW)).body;
  assert.equal(peek.items.length, 1);
  assert.equal(peek.items[0].url, '/shows/raw-13-10-2026/');
  assert.deepEqual((await call(e, '/follow/peek', { pk: 'x'.repeat(32) }, '', NOW)).body.items, []);
  // a device that's gone is forgotten
  await runFollowNotify(e, NOW + 60_000, site([show('/shows/raw-20-10-2026/', 'wwe-raw', 'wwe'), show('/shows/raw-13-10-2026/', 'wwe-raw', 'wwe')]));
  assert.equal(await runFollowPush(e, NOW + 60_000, (async () => new Response('', { status: 410 })) as any), 0);
  assert.equal((await call(e, '/follow/peek', { pk: reg.body.pk }, '', NOW + 60_000)).body.gone, true);
});

test('every federation of the library can be followed: a new show of it reaches its followers (owner 2026-10-18)', async () => {
  // «العضو المسجل في الموقع يقدر انه يعمل متابعة لكل الاتحاد ال في مكتبة العروض»
  assert.equal(followKeyOk('libfed', 'cmll'), true);
  assert.equal(followKeyOk('libfed', 'وثائقيات'), true);
  assert.equal(followKeyOk('libfed', 'bad key!'), false);
  const e = env();
  const a = await member(e, 'cmll_fan'), b = await member(e, 'aaa_fan');
  assert.equal((await call(e, '/follow', { kind: 'libfed', key: 'cmll', label: 'CMLL' }, a.token)).body.ok, true);
  await call(e, '/follow', { kind: 'libfed', key: 'aaa', label: 'AAA' }, b.token);
  assert.deepEqual((await call(e, '/follow', undefined, a.token)).body.follows.map((f: any) => `${f.kind}:${f.key}`), ['libfed:cmll']);
  const old = [{ ...show('/shows/cmll-old/', 'cmll-domingo', 'indie', 60 * 24 * 7), libfed: 'cmll' }];
  await runFollowNotify(e, NOW, site(old));
  const feed = [{ ...show('/shows/cmll-viernes-16-10-2026/', 'cmll-viernes', 'indie'), libfed: 'cmll' }, ...old];
  await runFollowNotify(e, NOW, site(feed));
  assert.deepEqual((await call(e, '/follow/inbox', undefined, a.token)).body.items.map((i: any) => i.url), ['/shows/cmll-viernes-16-10-2026/']);
  assert.equal((await call(e, '/follow/inbox', undefined, b.token)).body.items.length, 0);
  // the pages: a button on every federation card of the library and on each federation's own page
  const fs = await import('node:fs');
  const lib = fs.readFileSync('pages/library.njk', 'utf-8');
  assert.match(lib, /<div class="promo-follow">\{\{ followBtn\(libFollowKind\(f\.key\), f\.key, f\.mark\) \}\}<\/div>/);
  assert.match(lib, /followBtn\(libFollowKind\(promo\.key\), promo\.key, promo\.mark, true\)/);
  assert.match(lib, /<a class="promo-link" href="\{\{ f\.href \}\}"/);
  assert.match(fs.readFileSync('pages/follow-feed.njk', 'utf-8'), /"libfed": \{\{ \(lp\.promoKey if lp else ""\)/);
});
