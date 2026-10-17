// «المفضلة وشاهد لاحقا على كل أجهزتك» (owner 2026-10-15): a member's saved list, kept with their account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMembers } from '../worker/src/members';
import { handleSaved, cleanSaved, MAX_SAVED } from '../worker/src/saved';

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
const call = async (e: any, body: any, token = '') => {
  const r = await handleSaved(new Request('https://w/saved', { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL('https://w/saved'));
  return { status: r.status, body: await r.json() as any };
};

test('the saved list follows the member: one device adds, the other sees it; a device\'s own list joins on signing in', async () => {
  const e = { ANALYTICS: d1(), PUSH_KV: kv() };
  const t = await member(e, 'kareem_10');
  assert.equal((await call(e, null)).status, 401);
  // the phone, signing in for the first time with two saved
  const merged = await call(e, { op: 'merge', items: [
    { url: '/shows/raw-13-10-2026/', title: 'عرض الرو', image: '/content/images/a.webp', kind: 'show', fed: 'WWE', addedAt: 1000 },
    { url: '/news/خبر-جديد/', title: 'خبر', kind: 'news', addedAt: 2000 },
  ] }, t);
  assert.deepEqual(merged.body.items.map((x: any) => x.url), ['/news/خبر-جديد/', '/shows/raw-13-10-2026/']);
  // the computer adds one, then sees all three
  await call(e, { op: 'add', item: { url: '/recaps/raw-highlights/', title: 'ملخص', kind: 'recap' } }, t);
  const all = (await call(e, null, t)).body.items;
  assert.equal(all.length, 3);
  assert.equal(all[0].url, '/recaps/raw-highlights/');
  // removed on one, gone on both
  assert.equal((await call(e, { op: 'remove', url: '/news/خبر-جديد/' }, t)).body.items.length, 2);
  // the same twice is one
  await call(e, { op: 'add', item: { url: '/recaps/raw-highlights/', title: 'ملخص', kind: 'recap' } }, t);
  assert.equal((await call(e, null, t)).body.items.length, 2);
  // another member sees nothing of it
  const t2 = await member(e, 'sara22');
  assert.equal((await call(e, null, t2)).body.items.length, 0);
});

test('only the site\'s own pages and pictures are kept; a limit', async () => {
  for (const bad of ['https://evil.example/x', 'javascript:alert(1)', '/shows/x" onmouseover="a', '/admin/', '//evil.example/shows/x']) assert.equal(cleanSaved({ url: bad }), null, bad);
  assert.equal(cleanSaved({ url: '/shows/ok/', image: 'javascript:x' })!.image, '');
  assert.equal(cleanSaved({ url: '/en/shows/ok/', image: 'https://i.ibb.co/x.jpg', kind: 'weird' })!.kind, 'show');
  const e = { ANALYTICS: d1(), PUSH_KV: kv() };
  const t = await member(e, 'many_saves');
  await call(e, { op: 'merge', items: Array.from({ length: MAX_SAVED + 20 }, (_, i) => ({ url: `/shows/s-${i}/`, addedAt: i + 1 })) }, t);
  assert.equal((await call(e, { op: 'add', item: { url: '/shows/newest/' } }, t)).body.items.length, MAX_SAVED);
  assert.equal((await call(e, null, t)).body.items[0].url, '/shows/newest/');
});
