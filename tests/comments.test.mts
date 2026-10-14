// Visitors' comments (owner 2026-10-14): published at once, so the worker's guards are what keeps the site clean
// (worker/src/comments.ts). Run against a real SQLite database standing in for D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pushOnce, notifyOwner, ownerOf, vapidKeys } from '../worker/src/comment-push';
import { handleComments, studioComments, studioDeleteComments, studioReplyComment, studioHeartComment, commentNotifications, commentPath, cleanText, HAS_LINK, ensureTable, isReservedName } from '../worker/src/comments';

/** D1's interface over node:sqlite: prepare().bind().all()/first()/run(), and batch() */
function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => Promise.all(list.map((s) => (/^\s*(select)/i.test(s.sql) ? s.all() : s.run()))), raw: db };
}
const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };
const r2 = () => { const m = new Map<string, Uint8Array>(); return { m, put: async (k: string, v: Uint8Array) => { m.set(k, v); }, get: async (k: string) => (m.has(k) ? { body: m.get(k), httpMetadata: { contentType: 'image/webp' } } : null), delete: async (k: string) => { m.delete(k); } }; };
const PERSON = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json' };
const post = (env: any, body: any, headers: Record<string, string> = PERSON, now = Date.now()) =>
  handleComments(new Request('https://w.example/comments', { method: 'POST', body: JSON.stringify({ t: 9000, website: '', ...body }), headers }), env, new URL('https://w.example/comments'), now).then(async (r) => ({ status: r.status, body: await r.json() as any }));
const get = (env: any, p: string) => handleComments(new Request(`https://w.example/comments?p=${encodeURIComponent(p)}`), env, new URL(`https://w.example/comments?p=${encodeURIComponent(p)}`)).then((r) => r.json() as any);
const STORY = '/news/سيث-رولينز-يتحدث/';

test('a comment is on the page at once, newest first, with its picture', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  assert.equal((await post(env, { p: STORY, name: 'أحمد', text: 'كلام مؤثر جدًا.', pic: 'w:cody-rhodes', title: 'سيث رولينز يتحدث' })).body.status, 'published');
  await post(env, { p: STORY, name: '  محمود   الشريف ', text: 'سطر أول\n\n\n\nسطر ثاني' }, { ...PERSON, 'CF-Connecting-IP': '41.9.9.9' });
  const { items } = await get(env, STORY);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'محمود الشريف');
  assert.equal(items[0].text, 'سطر أول\n\nسطر ثاني');
  assert.equal(items[1].pic, 'w:cody-rhodes');
  assert.deepEqual((await get(env, '/news/خبر-آخر/')).items, []);
});

test('a visitor\'s own picture is kept apart and served by the worker', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const png = Buffer.alloc(600, 7).toString('base64');
  const r = await post(env, { p: STORY, name: 'سارة', text: 'صورة', pic: `data:image/webp;base64,${png}` });
  assert.match(r.body.pic, /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/);
  assert.equal(env.MEDIA.m.size, 1);
  const id = r.body.pic.match(/(\d+)\.webp$/)[1];
  const res = await handleComments(new Request(`https://w.example/comments/pic/${id}.webp`), env, new URL(`https://w.example/comments/pic/${id}.webp`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control')!, /immutable/);
  // anything else as a «picture» is dropped
  const r2b = await post(env, { p: STORY, name: 'سارة', text: 'رابط صورة', pic: 'https://evil.example/x.png' }, { ...PERSON, 'CF-Connecting-IP': '8.8.8.8' });
  assert.equal(r2b.body.pic, '');
});

test('the guards: bots, other sites, links, the hidden field, too fast, too many, twice', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  assert.equal((await post(env, { p: STORY, name: 'بوت', text: 'x x' }, { ...PERSON, 'User-Agent': 'curl/8.5' })).status, 403);
  assert.equal((await post(env, { p: STORY, name: 'آخر', text: 'x x' }, { ...PERSON, Origin: 'https://spam.example' })).status, 403);
  assert.equal((await post(env, { p: STORY, name: 'سبام', text: 'ادخل على www.casino.com الآن' })).status, 400);
  assert.equal((await post(env, { p: STORY, name: 'سبام', text: 'تابعنا t.me/xyz' })).status, 400);
  assert.equal((await post(env, { p: STORY, name: 'ا', text: 'قصير الاسم' })).status, 400);
  assert.equal((await post(env, { p: '/about/', name: 'أحمد', text: 'صفحة مش موضوع' })).status, 400);
  // a bot that fills the hidden field, or sends at once: told «done», nothing kept
  await post(env, { p: STORY, name: 'بوت', text: 'مخفي', website: 'x' });
  await post(env, { p: STORY, name: 'بوت', text: 'سريع', t: 300 });
  assert.equal((await get(env, STORY)).items.length, 0);
  // the same visitor: 4 in 10 minutes, then wait
  const now = Date.parse('2026-10-14T12:00:00Z');
  for (let i = 0; i < 4; i++) assert.equal((await post(env, { p: STORY, name: 'كريم', text: `تعليق ${i}` }, PERSON, now + i)).status, 200);
  assert.equal((await post(env, { p: STORY, name: 'كريم', text: 'الخامس' }, PERSON, now + 10)).status, 429);
  // the same comment twice on a page
  assert.equal((await post(env, { p: STORY, name: 'يوسف', text: 'تعليق 0' }, { ...PERSON, 'CF-Connecting-IP': '5.5.5.5' }, now + 20)).status, 409);
});

test('the panel: every comment with its counts, delete takes it off the site and its picture with it, the bell hears of it', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const png = Buffer.alloc(600, 7).toString('base64');
  const a = await post(env, { p: STORY, name: 'أحمد', text: 'أول', title: 'سيث رولينز يتحدث', pic: `data:image/webp;base64,${png}` });
  await post(env, { p: '/shows/wwe-raw-12-10-2026/', name: 'يوسف', text: 'عرض رائع' }, { ...PERSON, 'CF-Connecting-IP': '7.7.7.7' });
  const s = await studioComments(env);
  assert.equal(s.items.length, 2);
  assert.equal(s.counts.total, 2);
  assert.equal(s.counts.today, 2);
  assert.equal(s.items[1].title, 'سيث رولينز يتحدث');
  const bell = await commentNotifications(env, Date.now() - 3600_000);
  assert.equal(bell[0].type, 'comment');
  assert.equal(await studioDeleteComments(env, [a.body.id, 'x', -1]), 1);
  assert.equal((await get(env, STORY)).items.length, 0);
  assert.equal(env.MEDIA.m.size, 0);
  assert.equal((await studioComments(env)).counts.total, 1);
});

test('names and comments are cleaned; links are found', () => {
  assert.equal(cleanText('  أحمد‏  ‮ سامي ', 40), 'أحمد سامي');
  assert.equal(cleanText('a\r\n\r\n\r\nb', 100, true), 'a\n\nb');
  assert.equal(commentPath('/news/%D8%AE%D8%A8%D8%B1/'), '/news/خبر/');
  assert.equal(commentPath('/en/shows/wwe-raw-12-10-2026/'), '/en/shows/wwe-raw-12-10-2026/');
  assert.equal(commentPath('/news/'), null);
  for (const t of ['https://x.co', 'www.site.com', 'example.com', 'wa.me/123', 'زور casino.xyz']) assert.ok(HAS_LINK.test(t), t);
  for (const t of ['رومان رينز هو الأفضل', 'WWE.. AEW', 'نتيجة 3.5 من 5']) assert.ok(!HAS_LINK.test(t), t);
});

test('the table is made once, and only once', async () => {
  const db = d1();
  await ensureTable(db as any);
  await ensureTable(db as any);
  assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'comments'").get());
});

test('the site answers as «عرب راسلنج»: under the comment, never counted, never in the bell, gone with the comment', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const c = await post(env, { p: STORY, name: 'يوسف', text: 'إمتى الملخص؟', title: 'خبر' });
  const r = await studioReplyComment(env, c.body.id, 'خلال ساعة إن شاء الله');
  assert.equal(r.success, true);
  // a reply to the reply answers the same comment
  const again = await studioReplyComment(env, (r as any).item.id, 'نزل الملخص ✓');
  assert.equal((again as any).item.parent, c.body.id);
  const { items } = await get(env, STORY);
  const own = items.filter((x: any) => x.official);
  assert.equal(own.length, 2);
  assert.equal(own[0].name, 'عرب راسلنج');
  assert.equal(own[0].parent, c.body.id);
  const s = await studioComments(env);
  assert.equal(s.counts.total, 1);
  assert.equal((await commentNotifications(env, Date.now() - 3600_000)).length, 1);
  assert.equal((await studioReplyComment(env, 9999, 'x')).success, false);
  await studioDeleteComments(env, [c.body.id]);
  assert.equal((await get(env, STORY)).items.length, 0);
});

test('no visitor can comment as the site', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  for (const [i, name] of ['عرب راسلنج', 'عـرب رسلنج', 'Arab Wrestling', 'ARAB-WRESTLING'].entries()) {
    assert.equal((await post(env, { p: STORY, name, text: `تعليق ${i}` }, { ...PERSON, 'CF-Connecting-IP': `9.9.9.${i}` })).status, 400, name);
  }
  for (const name of ['محمد عرب', 'Arabi', 'راسل']) assert.ok(!isReservedName(name), name);
});

test('the site\'s heart on a comment shows on the page, comes off again, and never goes on its own reply', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const c = await post(env, { p: STORY, name: 'يوسف', text: 'تحليل ممتاز', title: 'خبر' });
  assert.equal((await get(env, STORY)).items[0].hearted, false);
  assert.equal((await studioHeartComment(env, c.body.id, true)).success, true);
  assert.equal((await get(env, STORY)).items[0].hearted, true);
  assert.equal((await studioComments(env)).items[0].hearted, true);
  await studioHeartComment(env, c.body.id, false);
  assert.equal((await get(env, STORY)).items[0].hearted, false);
  const r: any = await studioReplyComment(env, c.body.id, 'شكرًا');
  assert.equal((await studioHeartComment(env, r.item.id, true)).success, false);
  assert.equal((await studioHeartComment(env, 9999, true)).success, false);
});

test('the panel sees who commented from where (address and country); the page never does', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  await post(env, { p: STORY, name: 'سارة', text: 'تعليق' }, { ...PERSON, 'CF-Connecting-IP': '197.32.10.5' });
  const s = await studioComments(env);
  assert.equal(s.items[0].ip, '197.32.10.5');
  const page = (await get(env, STORY)).items[0];
  assert.equal(page.ip, undefined);
  assert.equal(page.country, undefined);
});

const inbox = (env: any, k: string, since = 0) => handleComments(new Request('https://w.example/comments/inbox', { method: 'POST', body: JSON.stringify({ k, since }), headers: { 'Content-Type': 'application/json' } }), env, new URL('https://w.example/comments/inbox')).then((r) => r.json() as any);
const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(32);

test('visitors answer each other: under the same comment, «@» to a reply, and the one answered finds it in their inbox', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const top = await post(env, { p: STORY, name: 'سارة', text: 'رأيي إن رولينز أفضل', k: KEY_A });
  const ans = await post(env, { p: STORY, name: 'كريم', text: 'لا طبعًا', parent: top.body.id, k: KEY_B }, { ...PERSON, 'CF-Connecting-IP': '5.6.7.8' });
  assert.equal(ans.status, 200);
  assert.equal(ans.body.parent, top.body.id);
  // an answer to the answer: still under the comment on top, answering Karim
  const again = await post(env, { p: STORY, name: 'سارة', text: 'ليه؟', parent: ans.body.id, k: KEY_A });
  assert.equal(again.body.parent, top.body.id);
  assert.equal(again.body.reply_to, ans.body.id);
  const items = (await get(env, STORY)).items;
  assert.equal(items.find((x: any) => x.id === again.body.id).reply_to, ans.body.id);
  // Sara's inbox: Karim's answer (not her own); Karim's: Sara's answer to him
  const a = await inbox(env, KEY_A);
  assert.deepEqual(a.items.map((x: any) => x.name), ['كريم']);
  assert.match(a.items[0].url, new RegExp(`#c-${ans.body.id}$`));
  assert.deepEqual((await inbox(env, KEY_B)).items.map((x: any) => x.name), ['سارة']);
  // since: nothing new
  assert.equal((await inbox(env, KEY_A, Date.now() + 1000)).items.length, 0);
  // no inbox without a proper key, no answer to another page's comment
  assert.equal((await inbox(env, 'short')).items.length, 0);
  assert.equal((await post(env, { p: '/news/خبر-آخر/', name: 'كريم', text: 'رد تايه', parent: top.body.id, k: KEY_B }, { ...PERSON, 'CF-Connecting-IP': '5.6.7.9' })).status, 404);
});

test('the site\'s answer reaches the visitor\'s inbox as «عرب راسلنج»', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const c = await post(env, { p: STORY, name: 'سارة', text: 'سؤال؟', k: KEY_A });
  await studioReplyComment(env, c.body.id, 'أهلًا يا سارة');
  const a = await inbox(env, KEY_A);
  assert.equal(a.items[0].name, 'عرب راسلنج');
  assert.equal(a.items[0].official, true);
});

test('push: the site\'s key is made once, a browser\'s address is kept only from a push service, and an answer wakes it', async () => {
  const env: any = { ANALYTICS: d1(), PUSH_KV: kv(), MEDIA: r2() };
  const k1 = await vapidKeys(env.PUSH_KV), k2 = await vapidKeys(env.PUSH_KV);
  assert.equal(k1.pub, k2.pub);
  assert.equal(Buffer.from(k1.pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length, 65);
  const sub = (endpoint: string) => handleComments(new Request('https://w.example/comments/push', { method: 'POST', body: JSON.stringify({ k: KEY_A, endpoint }), headers: { 'Content-Type': 'application/json' } }), env, new URL('https://w.example/comments/push'));
  assert.equal((await sub('https://evil.example/x')).status, 400);
  assert.equal((await sub('https://fcm.googleapis.com/fcm/send/abc')).status, 200);
  // the push itself: an empty POST signed with the site's key (ES256 JWT for the push service's origin)
  const calls: any[] = [];
  const fake: any = async (url: string, init: any) => { calls.push({ url, init }); return new Response(null, { status: 201 }); };
  assert.equal(await notifyOwner(env.PUSH_KV, await ownerOf(KEY_A), fake), 1);
  assert.equal(calls[0].url, 'https://fcm.googleapis.com/fcm/send/abc');
  const auth = calls[0].init.headers.Authorization as string;
  const [, jwt, pub] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.equal(pub, k1.pub);
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  const key = await crypto.subtle.importKey('raw', Buffer.from(pub, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const [h, p, sig] = jwt.split('.');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`)));
  // a browser that's gone (410): forgotten
  const gone: any = async () => new Response(null, { status: 410 });
  assert.equal(await notifyOwner(env.PUSH_KV, await ownerOf(KEY_A), gone), 0);
  assert.equal(await notifyOwner(env.PUSH_KV, await ownerOf(KEY_A), fake), 0);
});
