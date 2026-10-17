// «توقعات العروض الكبرى وترتيب أفضل المتوقعين» (owner 2026-10-15)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMembers } from '../worker/src/members';
import { handleFollows } from '../worker/src/follows';
import { handlePredict, studioPredict, studioPredictPicks, studioPredictSave, studioPredictResult, studioPredictDelete, studioPredictPrize, PRIZE_DAYS } from '../worker/src/predict';

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
const call = async (e: any, path: string, body?: any, token = '', now?: number) => {
  const r = await handlePredict(new Request(`https://w${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL(`https://w${path}`), now);
  return { status: r.status, body: await r.json() as any };
};
const SHOW = Date.now() + 3 * 3600e3;

test('a big show\'s card: members pick until it starts, the results rank them, each is told their score', async () => {
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const a = await member(e, 'pick_master'), b = await member(e, 'second_best'), c = await member(e, 'late_one');
  // the owner's card: two matches, the main event worth 2
  assert.equal((await studioPredictSave(e, { title: 'WrestleMania 43', starts: SHOW, status: 'open', matches: [{ title: 'x', options: ['A'] }] })).success, false);
  const saved = await studioPredictSave(e, { title: 'WrestleMania 43', title_en: 'WrestleMania 43', starts: SHOW, status: 'open', matches: [
    { title: 'كودي رودز ضد جون سينا', options: ['كودي رودز', 'جون سينا'], points: 2 },
    { title: 'نزال الفرق', options: ['ذا يوسوز', 'ذا نيو داي', 'دي آي واي'] },
  ] });
  assert.ok(saved.success);
  const ev = (await call(e, '/predict', undefined, a)).body.events[0];
  assert.equal(ev.matches.length, 2);
  assert.equal(ev.matches[0].share, null, 'what others picked stays hidden until the show starts');
  const [m1, m2] = ev.matches;
  // picks (a member only, a listed name only)
  assert.equal((await call(e, '/predict/pick', { match: m1.id, pick: 'كودي رودز' })).status, 401);
  assert.equal((await call(e, '/predict/pick', { match: m1.id, pick: 'روك' }, a)).status, 400);
  await call(e, '/predict/pick', { match: m1.id, pick: 'جون سينا' }, a);
  await call(e, '/predict/pick', { match: m1.id, pick: 'كودي رودز' }, a); // changed their mind
  await call(e, '/predict/pick', { match: m2.id, pick: 'ذا يوسوز' }, a);
  await call(e, '/predict/pick', { match: m1.id, pick: 'كودي رودز' }, b);
  await call(e, '/predict/pick', { match: m2.id, pick: 'دي آي واي' }, b);
  assert.equal((await call(e, '/predict', undefined, a)).body.events[0].matches[0].mine, 'كودي رودز');
  // the show started: closed
  const late = await call(e, '/predict/pick', { match: m1.id, pick: 'جون سينا' }, c, SHOW + 1000);
  assert.equal(late.body.locked, true);
  const during = (await call(e, '/predict', undefined, '', SHOW + 1000)).body.events[0];
  assert.deepEqual(during.matches[0].share, { 'كودي رودز': 100 });
  // the results
  assert.equal((await studioPredictResult(e, { id: saved.id, winners: { [m1.id]: 'غلط' } })).success, false);
  const res = await studioPredictResult(e, { id: saved.id, winners: { [m1.id]: 'كودي رودز', [m2.id]: 'ذا يوسوز' }, finish: true });
  assert.equal(res.told, 2);
  const after = (await call(e, '/predict', undefined, b)).body;
  assert.deepEqual(after.leaders.map((x: any) => [x.user, x.points, x.right]), [['pick_master', 3, 2], ['second_best', 2, 1]]);
  assert.deepEqual(after.me, { rank: 2, points: 2, right: 1, of: 2 });
  assert.equal(after.events[0].leaders[0].user, 'pick_master');
  assert.equal(after.events[0].matches[1].winner, 'ذا يوسوز');
  // the bell, once
  const inbox = async (t: string) => (await (await handleFollows(new Request('https://w/follow/inbox', { headers: { Authorization: `Bearer ${t}` } }), e, new URL('https://w/follow/inbox'))).json() as any).items;
  assert.match((await inbox(a))[0].title, /أصبت 2 من 2 \(3 نقطة\)/);
  assert.equal((await studioPredictResult(e, { id: saved.id, winners: { [m1.id]: 'كودي رودز', [m2.id]: 'ذا يوسوز' }, finish: true })).told, 0);
  assert.equal((await inbox(a)).length, 1);
  assert.equal((await inbox(c)).length, 0);
  // the panel sees it all; a draft never shows on the site; deleting removes it
  const panel = await studioPredict(e);
  assert.equal(panel.events![0].players, 2);
  await studioPredictSave(e, { title: 'مسودة', starts: SHOW, status: 'draft', matches: [{ title: 'أ ضد ب', options: ['أ', 'ب'] }] });
  assert.equal((await call(e, '/predict')).body.events.length, 1);
  await studioPredictDelete(e, saved.id);
  assert.equal((await call(e, '/predict')).body.leaders.length, 0);
});

test('editing a card keeps the picks of names that stay, and drops the ones whose name went', async () => {
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const a = await member(e, 'kareem_10');
  const s = await studioPredictSave(e, { title: 'Survivor Series', starts: SHOW, status: 'open', matches: [{ title: 'أ ضد ب', options: ['أ', 'ب'] }, { title: 'ج ضد د', options: ['ج', 'د'] }] });
  const ms = (await call(e, '/predict')).body.events[0].matches;
  await call(e, '/predict/pick', { match: ms[0].id, pick: 'أ' }, a);
  await call(e, '/predict/pick', { match: ms[1].id, pick: 'ج' }, a);
  await studioPredictSave(e, { id: s.id, title: 'Survivor Series', starts: SHOW, status: 'open', matches: [{ id: ms[0].id, title: 'أ ضد ب', options: ['أ', 'ب'] }, { id: ms[1].id, title: 'ج ضد هـ', options: ['ج2', 'هـ'] }] });
  const now = (await call(e, '/predict', undefined, a)).body.events[0].matches;
  assert.deepEqual(now.map((m: any) => m.mine), ['أ', '']);
});

test('the cards from the code go up once each, a later match joins its card, and what the owner deletes stays deleted', async () => {
  const { seedPredictions, PRED_SEEDS } = await import('../worker/src/predict-seed');
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const now = Date.UTC(2026, 9, 15, 12);
  assert.equal(await seedPredictions(e.ANALYTICS, PRED_SEEDS, now), 2);
  assert.equal(await seedPredictions(e.ANALYTICS, PRED_SEEDS, now), 0);
  const r = await call(e, '/predict', undefined, '', now);
  // the soonest open card first: WrestleDream (17 October) before Crown Jewel (7 November)
  assert.deepEqual(r.body.events.map((x: any) => x.title_en), ['AEW WrestleDream 2026', 'WWE Crown Jewel 2026']);
  const wd = r.body.events[0];
  assert.equal(wd.starts, Date.UTC(2026, 9, 17, 23));
  assert.equal(wd.matches.length, 10);
  assert.equal(wd.matches[0].options.length, 8);
  assert.equal(wd.matches[0].points, 3);
  assert.match(wd.matches[0].image, /^\/assets\/predictions\/aew-wrestledream-2026-clockwork\.jpg$/);
  assert.match(wd.matches[1].note, /بطولة AEW العالمية للسيدات/);
  // every name in Arabic (the federations and the shows' own names stay as they are)
  for (const ev of r.body.events) for (const m of ev.matches) for (const o of m.options) assert.match(o, /^[؀-ۿ ]+$/, o);
  // every poster is in the repo
  const fs = await import('node:fs');
  for (const s of PRED_SEEDS) for (const img of [s.image, ...s.matches.map(m => m.image)]) assert.ok(fs.existsSync('.' + img), img);
  // a match added to the code later joins its card, once
  const more = PRED_SEEDS.map(s => s.key === 'wwe-crown-jewel-2026' ? { ...s, matches: [...s.matches, { key: 'extra', title: 'كودي رودز ضد جون سينا', note: '', options: ['كودي رودز', 'جون سينا'], points: 1, image: '' }] } : s);
  await seedPredictions(e.ANALYTICS, more, now); await seedPredictions(e.ANALYTICS, more, now);
  const cj = (await call(e, '/predict', undefined, '', now)).body.events[1];
  assert.deepEqual(cj.matches.map((m: any) => m.title), ['رومان رينز ضد سامي زين', 'تشيلسي غرين ضد ليف مورغان', 'كودي رودز ضد جون سينا']);
  // the owner's edits keep each match's poster and line unless the panel changes them
  const list = (await studioPredict(e)).events.find((x: any) => x.id === cj.id);
  await studioPredictSave(e, { ...list, matches: list.matches.map((m: any) => ({ id: m.id, title: m.title, options: m.options, points: m.points })) });
  const kept = (await studioPredict(e)).events.find((x: any) => x.id === cj.id);
  assert.equal(kept.matches[0].image, '/assets/predictions/wwe-crown-jewel-2026-reigns-zayn.jpg');
  await studioPredictSave(e, { ...kept, matches: kept.matches.map((m: any, i: number) => ({ ...m, note: i ? m.note : 'سطر جديد', image: i ? m.image : 'javascript:x' })) });
  const changed = (await studioPredict(e)).events.find((x: any) => x.id === cj.id);
  assert.deepEqual([changed.matches[0].note, changed.matches[0].image], ['سطر جديد', '']);
  // deleted by the owner: never back
  await studioPredictDelete(e, cj.id);
  assert.equal(await seedPredictions(e.ANALYTICS, more, now), 0);
  assert.equal((await call(e, '/predict', undefined, '', now)).body.events.length, 1);
});

test('the show\'s prize: the top of its ranking, given once and only by the owner\'s button, after the results', async () => {
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const a = await member(e, 'pick_master'), b = await member(e, 'second_best');
  const saved = await studioPredictSave(e, { title: 'عرض WWE Crown Jewel 2026', title_en: 'WWE Crown Jewel 2026', starts: SHOW, status: 'open', matches: [
    { title: 'رومان رينز ضد سامي زين', options: ['رومان رينز', 'سامي زين'], points: 2 },
  ] });
  const m = (await call(e, '/predict', undefined, a)).body.events[0].matches[0];
  assert.deepEqual((await call(e, '/predict')).body.events[0].prize, { days: PRIZE_DAYS, winner: null, granted: false }, 'the prize shows before the show');
  await call(e, '/predict/pick', { match: m.id, pick: 'سامي زين' }, a);
  await call(e, '/predict/pick', { match: m.id, pick: 'رومان رينز' }, b);
  // nothing is given before the results, nor by the results themselves
  assert.equal((await studioPredictPrize(e, saved.id, 'owner')).success, false);
  await studioPredictResult(e, { id: saved.id, winners: { [m.id]: 'سامي زين' }, finish: true });
  const until = () => Number((e.ANALYTICS.raw.prepare("SELECT premium_until FROM members WHERE username = 'pick_master'").get() as any).premium_until);
  assert.equal(until(), 0);
  let ev = (await call(e, '/predict')).body.events[0];
  assert.deepEqual([ev.prize.winner.user, ev.prize.winner.points, ev.prize.granted], ['pick_master', 2, false]);
  assert.equal(ev.prize.winner.member, undefined, 'the member\'s id stays in the panel');
  assert.equal((await studioPredict(e)).events![0].champion.user, 'pick_master');
  // the owner's button: a month, once
  const now = Date.now();
  const r = await studioPredictPrize(e, saved.id, 'owner', now);
  assert.equal(r.success, true);
  assert.ok(Math.abs(until() - (now + PRIZE_DAYS * 86_400_000)) < 1000);
  assert.equal((await studioPredictPrize(e, saved.id, 'owner')).success, false);
  assert.ok(Math.abs(until() - (now + PRIZE_DAYS * 86_400_000)) < 1000, 'a second tap gives nothing');
  const pay: any = e.ANALYTICS.raw.prepare("SELECT amount, days, granted_by FROM premium_payments").all();
  assert.deepEqual(pay.map((x: any) => [x.amount, x.days, x.granted_by]), [[0, PRIZE_DAYS, 'prize:owner']]);
  // the winner is told, and the page says it was given (and stays with them if the results are edited later)
  const inbox = async (t: string) => (await (await handleFollows(new Request('https://w/follow/inbox', { headers: { Authorization: `Bearer ${t}` } }), e, new URL('https://w/follow/inbox'))).json() as any).items;
  assert.ok((await inbox(a)).some((x: any) => /مبروك! فزت بجائزة توقعات/.test(x.title)));
  assert.ok(!(await inbox(b)).some((x: any) => /مبروك/.test(x.title)));
  await studioPredictResult(e, { id: saved.id, winners: { [m.id]: 'رومان رينز' }, finish: true });
  ev = (await call(e, '/predict')).body.events[0];
  assert.deepEqual([ev.prize.winner.user, ev.prize.granted], ['pick_master', true]);
});

test('no prize for a show nobody scored in, nor for the site\'s own account', async () => {
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const a = await member(e, 'site_owner'), b = await member(e, 'fan_two');
  const saved = await studioPredictSave(e, { title: 'عرض', starts: SHOW, status: 'open', matches: [{ title: 'أ ضد ب', options: ['أ', 'ب'], points: 1 }] });
  const m = (await call(e, '/predict', undefined, a)).body.events[0].matches[0];
  await call(e, '/predict/pick', { match: m.id, pick: 'ب' }, a);
  await call(e, '/predict/pick', { match: m.id, pick: 'ب' }, b);
  await studioPredictResult(e, { id: saved.id, winners: { [m.id]: 'أ' }, finish: true });
  assert.equal((await call(e, '/predict')).body.events[0].prize.winner, null);
  assert.equal((await studioPredictPrize(e, saved.id, 'owner')).success, false);
  await studioPredictResult(e, { id: saved.id, winners: { [m.id]: 'ب' }, finish: true });
  e.ANALYTICS.raw.prepare("UPDATE members SET official = 1 WHERE username = 'site_owner'").run();
  assert.equal((await call(e, '/predict')).body.events[0].prize.winner.user, 'fan_two');
});

test('who picked what: the panel sees every member\'s card, the site\'s own account sees it on the page, a member never does (owner 2026-10-17)', async () => {
  // «معنديش صلاحية اشوف مين ال توقع لا في اللوحة ولا في الموقع نفسه من فضلك اديني الصلاحية دي كاملة»
  const e: any = { ANALYTICS: d1(), PUSH_KV: kv() };
  const site = await member(e, 'site_account'), a = await member(e, 'fan_one'), b = await member(e, 'fan_two');
  e.ANALYTICS.raw.prepare("UPDATE members SET official = 1 WHERE username = 'site_account'").run();
  const saved = await studioPredictSave(e, { title: 'كراون جول', starts: SHOW, status: 'open', matches: [
    { title: 'أ ضد ب', options: ['أ', 'ب'], points: 2 }, { title: 'ج ضد د', options: ['ج', 'د'] }] });
  const [m1, m2] = (await call(e, '/predict', undefined, a)).body.events[0].matches;
  await call(e, '/predict/pick', { match: m1.id, pick: 'أ' }, a);
  await call(e, '/predict/pick', { match: m2.id, pick: 'د' }, a);
  await call(e, '/predict/pick', { match: m1.id, pick: 'ب' }, b);
  // a member: only their own picks, never who picked what — even after the show starts
  assert.equal((await call(e, '/predict', undefined, a)).body.events[0].matches[0].who, undefined);
  assert.equal((await call(e, '/predict', undefined, b, SHOW + 1000)).body.events[0].matches[0].who, undefined);
  // the site's own account: everyone, open already, no member numbers on the page
  const seen = (await call(e, '/predict', undefined, site)).body.events[0].matches;
  assert.deepEqual(seen[0].who['أ'].map((p: any) => p.user), ['fan_one']);
  assert.deepEqual(seen[0].who['ب'].map((p: any) => p.user), ['fan_two']);
  assert.equal(seen[0].who['أ'][0].member, undefined);
  assert.deepEqual(seen[1].who, { 'د': seen[1].who['د'] });
  // the panel: by match and by member, with the score once the results are out
  let d: any = await studioPredictPicks(e, saved.id);
  assert.equal(d.members.length, 2);
  assert.equal(d.matches[0].by['أ'][0].user, 'fan_one');
  await studioPredictResult(e, { id: saved.id, winners: { [m1.id]: 'أ', [m2.id]: 'ج' }, finish: true });
  d = await studioPredictPicks(e, saved.id);
  assert.equal(d.members[0].user, 'fan_one');
  assert.equal(d.members[0].points, 2);
  assert.equal(d.members[0].right, 1);
  assert.deepEqual(d.members[0].picks, { [m1.id]: 'أ', [m2.id]: 'د' });
  assert.equal(d.members[1].points, 0);
  assert.equal((await studioPredictPicks(e, 999)).success, false);
});
