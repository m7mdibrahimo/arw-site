// «تابع المشاهدة» and «سجل المشاهدة» (owner 2026-10-15)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMembers } from '../worker/src/members';
import { handleWatch, cleanWatch, durationSecs } from '../worker/src/watch';

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
async function member(e: any, username: string) {
  const cap: any = await (await handleMembers(new Request('https://w/members/captcha'), e, new URL('https://w/members/captcha'))).json();
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'raw2026night', first_name: 'كريم', last_name: 'محمد', captcha: { id: cap.id, answer: e.PUSH_KV.m.get(`members:cap:${cap.id}`) } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${username.length}` } }), e, new URL('https://w/members/signup'));
  return (await r.json() as any).token as string;
}
const T0 = Date.parse('2026-10-15T20:00:00Z');
const call = async (e: any, q: string, body: any, token: string, now = T0) => {
  const r = await handleWatch(new Request(`https://w/watch${q}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }), e, new URL(`https://w/watch${q}`), now);
  return { status: r.status, body: await r.json() as any };
};
const RAW = { url: '/shows/raw-13-10-2026/', title: 'عرض الرو 13.10.2026 مترجم', image: '/content/images/raw.webp', fed: 'WWE', duration: '02:00:00' };

test('what a member started comes back on the home page with how much they watched; finished ones leave it; the history keeps all', async () => {
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const t = await member(e, 'kareem_10');
  assert.equal((await handleWatch(new Request('https://w/watch'), e, new URL('https://w/watch'))).status, 401);
  await call(e, '', { op: 'start', item: RAW }, t);
  await call(e, '', { op: 'tick', url: RAW.url, secs: 3000 }, t, T0 + 60e3); // capped at 10 minutes a tick
  await call(e, '', { op: 'tick', url: RAW.url, secs: 600 }, t, T0 + 120e3);
  await call(e, '', { op: 'start', item: { url: '/recaps/raw-highlights/', title: 'ملخص', duration: '15:00' } }, t, T0 + 180e3);
  await call(e, '', { op: 'start', item: { url: '/nostalgia/wm-19/', title: 'رسلمانيا 19' } }, t, T0 + 240e3);
  let cont = (await call(e, '?continue=1', null, t, T0 + 300e3)).body.items;
  assert.deepEqual(cont.map((x: any) => [x.url, x.kind]), [['/nostalgia/wm-19/', 'nostalgia'], ['/recaps/raw-highlights/', 'recap'], ['/shows/raw-13-10-2026/', 'show']]);
  assert.deepEqual([cont[2].watched, cont[2].duration], [1200, 7200]);
  // the recap watched to the end: out of «تابع المشاهدة», still in the history
  await call(e, '', { op: 'tick', url: '/recaps/raw-highlights/', secs: 600 }, t, T0 + 400e3);
  await call(e, '', { op: 'tick', url: '/recaps/raw-highlights/', secs: 600 }, t, T0 + 500e3);
  cont = (await call(e, '?continue=1', null, t, T0 + 600e3)).body.items;
  assert.equal(cont.some((x: any) => x.url === '/recaps/raw-highlights/'), false);
  const hist = (await call(e, '', null, t, T0 + 600e3)).body;
  assert.equal(hist.total, 3);
  assert.equal(hist.items.find((x: any) => x.url === '/recaps/raw-highlights/').done, true);
  // hidden from the home page, still in the history; watching again brings it back
  await call(e, '', { op: 'hide', url: '/nostalgia/wm-19/' }, t);
  assert.equal((await call(e, '?continue=1', null, t, T0 + 700e3)).body.items.some((x: any) => x.url === '/nostalgia/wm-19/'), false);
  await call(e, '', { op: 'start', item: { url: '/nostalgia/wm-19/', title: 'رسلمانيا 19' } }, t, T0 + 800e3);
  assert.equal((await call(e, '?continue=1', null, t, T0 + 900e3)).body.items[0].url, '/nostalgia/wm-19/');
  // a month later it's no longer «continue»; removed and cleared from the history
  assert.equal((await call(e, '?continue=1', null, t, T0 + 40 * 86400e3)).body.items.length, 0);
  await call(e, '', { op: 'remove', url: RAW.url }, t);
  assert.equal((await call(e, '', null, t)).body.total, 2);
  await call(e, '', { op: 'clear' }, t);
  assert.equal((await call(e, '', null, t)).body.total, 0);
  // someone else sees nothing of it
  const t2 = await member(e, 'sara22');
  await call(e, '', { op: 'start', item: RAW }, t);
  assert.equal((await call(e, '', null, t2)).body.total, 0);
});

test('only the site\'s watch pages; durations read as the pages write them', () => {
  for (const bad of ['/news/x/', 'https://evil.example/shows/x', '/shows/x" onerror="y', '/account/']) assert.equal(cleanWatch({ url: bad }), null, bad);
  assert.equal(cleanWatch({ url: '/shows/a/', image: 'javascript:x' })!.image, '');
  assert.deepEqual([durationSecs('02:37:11'), durationSecs('15:30'), durationSecs(''), durationSecs('abc'), durationSecs('99:00:00')], [9431, 930, 0, 0, 0]);
});
