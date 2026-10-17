// The site's members (owner 2026-10-14): sign-up with a captcha, sign-in, profile, recovery, and comments as a member.
// Run against a real SQLite database standing in for D1 (as tests/comments.test.mts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleMembers, captchaSvg, usernameProblem, passwordProblem, latinDigits, studioMembers, studioBanMember, studioMemberDetail, studioOfficialAccount, studioBadgeMember } from '../worker/src/members';
import { handleComments } from '../worker/src/comments';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => { const out = []; for (const s of list) out.push(/^\s*(select)/i.test(s.sql) ? await s.all() : await s.run()); return out; }, raw: db };
}
const kv = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };
const env = (): any => ({ ANALYTICS: d1(), PUSH_KV: kv() });
const call = async (e: any, path: string, body?: any, token = '', ip = '41.1.2.3') => {
  const r = await handleMembers(new Request(`https://w.example/members${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL(`https://w.example/members${path}`));
  return { status: r.status, body: await r.json() as any };
};
/** A captcha, answered right (read back from the store, as the test can) */
const solved = async (e: any) => { const c = (await call(e, '/captcha')).body; return { id: c.id, answer: e.PUSH_KV.m.get(`members:cap:${c.id}`) }; };
const signup = async (e: any, over: any = {}, ip?: string) => call(e, '/signup', { first_name: 'كريم', last_name: 'محمد', username: 'kareem_10', email: 'Kareem@Example.com', password: 'raw2026night', captcha: await solved(e), ...over }, '', ip);

test('the captcha: four digits drawn as strokes (no text to read), one try, Arabic digits accepted', async () => {
  const svg = captchaSvg('2795');
  assert.doesNotMatch(svg, /<text|2795/);
  assert.equal((svg.match(/<polyline/g) || []).length, 4);
  assert.equal(latinDigits('٢٧٩٥'), '2795');
  const e = env();
  const c = await solved(e);
  const wrong = await call(e, '/signup', { first_name: 'سارة', last_name: 'علي', username: 'sara22', email: 's@x.co', password: 'abc12345', captcha: { id: c.id, answer: '0000' } });
  assert.equal(wrong.body.captcha, true);
  // the same picture can't be tried again, even with the right answer
  assert.equal((await call(e, '/signup', { first_name: 'سارة', last_name: 'علي', username: 'sara22', email: 's@x.co', password: 'abc12345', captcha: c })).body.captcha, true);
  const arabic = await solved(e);
  arabic.answer = arabic.answer.replace(/\d/g, (d: string) => String.fromCharCode(0x660 + Number(d)));
  assert.equal((await call(e, '/signup', { first_name: 'سارة', last_name: 'علي', username: 'sara22', email: 's@x.co', password: 'abc12345', captcha: arabic })).status, 200);
});

test('usernames and passwords: plain rules, said simply', () => {
  assert.equal(usernameProblem('كريم_الشريف'), null);
  assert.equal(usernameProblem('Kareem.10'), null);
  assert.ok(usernameProblem('ab'));
  assert.ok(usernameProblem('1abc'));
  assert.ok(usernameProblem('عرب راسلنج'));
  assert.ok(usernameProblem('admin'));
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletters'));
  assert.ok(passwordProblem('kareem123', 'kareem'));
  assert.equal(passwordProblem('raw2026night'), null);
});

test('sign-up gives a session and a recovery code; the name and the e-mail are each taken once', async () => {
  const e = env();
  const r = await signup(e);
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^m_/);
  assert.match(r.body.recovery, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(r.body.member.email, 'kareem@example.com');
  assert.equal(r.body.mailed, false);
  // never the password, its hash, or the code kept
  const row: any = e.ANALYTICS.raw.prepare('SELECT * FROM members').get();
  assert.notEqual(row.hash, 'raw2026night');
  assert.ok(!JSON.stringify(row).includes(r.body.recovery));
  assert.equal((await signup(e, { email: 'other@example.com' }, '9.9.9.9')).body.field, 'username');
  assert.equal((await signup(e, { username: 'KAREEM_10', email: 'x@y.co' }, '9.9.9.8')).body.field, 'username');
  assert.equal((await signup(e, { username: 'someone' }, '9.9.9.7')).body.field, 'email');
  assert.equal((await call(e, '/me', undefined, r.body.token)).body.member.username, 'kareem_10');
});

test('sign-in by name or e-mail; wrong passwords are counted and stopped', async () => {
  const e = env();
  await signup(e);
  assert.equal((await call(e, '/login', { login: 'KAREEM_10', password: 'raw2026night' })).status, 200);
  assert.equal((await call(e, '/login', { login: 'kareem@example.com', password: 'raw2026night' })).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'nope1234' }, '', `5.5.5.${i}`)).status, 401);
  // the account is held a while, even with the right password from elsewhere
  assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' }, '', '6.6.6.6')).status, 429);
});

test('the recovery code sets a new password, signs the other devices out, and is replaced', async () => {
  const e = env();
  const s = await signup(e);
  const r = await call(e, '/recover', { login: 'kareem_10', code: s.body.recovery.toLowerCase().replace(/-/g, ' '), password: 'smackdown99' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.recovery, s.body.recovery);
  assert.equal((await call(e, '/me', undefined, s.body.token)).status, 401);
  assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'smackdown99' })).status, 200);
  assert.equal((await call(e, '/recover', { login: 'kareem_10', code: s.body.recovery, password: 'another123' })).status, 400);
});

test('the profile: a name to show, a picture from the stars, a favourite promotion', async () => {
  const e = env();
  const s = await signup(e);
  const p = await call(e, '/profile', { display: 'كريم', pic: 'w:cm-punk', fav_fed: 'AEW', fav_star: 'Will Ospreay', bio: 'من مصر' }, s.body.token);
  assert.equal(p.body.member.display, 'كريم');
  assert.equal(p.body.member.pic, 'w:cm-punk');
  assert.equal((await call(e, '/profile', { pic: 'https://evil.example/x.png' }, s.body.token)).body.member.pic, 'w:cm-punk');
  assert.equal((await call(e, '/profile', { display: 'عرب راسلنج' }, s.body.token)).status, 400);
  const pub = await call(e, '/u/KAREEM_10');
  assert.equal(pub.body.member.display, 'كريم');
  assert.equal(pub.body.member.email, undefined);
});

test('a member comments as themselves (name, picture, badge); no visitor can use their name; a stopped member can\'t sign in', async () => {
  const e = env();
  e.MEDIA = null;
  e.COMMENTS_OPEN = '1'; // visitors' comments, for the impersonation check
  const s = await signup(e);
  await call(e, '/profile', { display: 'كريم', pic: 'w:cm-punk' }, s.body.token);
  const STORY = '/news/خبر/';
  const headers = { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json' };
  const post = (body: any, extra: any = {}) => handleComments(new Request('https://w.example/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', ...body }), headers: { ...headers, ...extra } }), e, new URL('https://w.example/comments')).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  const mine = await post({ name: 'أي اسم', text: 'تعليقي كعضو' }, { Authorization: `Bearer ${s.body.token}` });
  assert.equal(mine.body.name, 'كريم');
  assert.equal(mine.body.member, 'kareem_10');
  const list = await handleComments(new Request(`https://w.example/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w.example/comments?p=${encodeURIComponent(STORY)}`)).then((r) => r.json() as any);
  assert.equal(list.items[0].member, 'kareem_10');
  assert.equal(list.items[0].pic, 'w:cm-punk');
  assert.equal((await post({ name: 'كريم', text: 'انتحال' }, { 'CF-Connecting-IP': '7.7.7.7' })).body.member, true);
  assert.equal((await post({ name: 'Kareem_10', text: 'انتحال 2' }, { 'CF-Connecting-IP': '7.7.7.8' })).status, 400);
  // the panel sees them; a stopped member is signed out and can't come back
  const panel = await studioMembers(e);
  assert.equal(panel.items[0].comments, 1);
  // everything about one member, for the panel's members page
  const one: any = await studioMemberDetail(e, s.body.member.id);
  assert.equal(one.member.email, 'kareem@example.com');
  assert.equal(one.member.country, '');
  assert.equal(one.comments[0].text, 'تعليقي كعضو');
  assert.equal(one.sessions.length, 1);
  assert.equal(one.member.hash, undefined);
  assert.equal((await studioMemberDetail(e, 999)).success, false);
  await studioBanMember(e, s.body.member.id, true);
  assert.equal((await call(e, '/me', undefined, s.body.token)).status, 401);
  assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' })).status, 403);
});

test('with the site\'s mail key: activation by e-mail is required, the link opens the account; «forgot my password» sends a link that works once', async () => {
  const e = env();
  e.RESEND_API_KEY = 're_test';
  const sent: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }) as any;
  try {
    const s = await signup(e);
    assert.equal(s.status, 200);
    assert.equal(s.body.pending, true);
    assert.equal(s.body.token, undefined);
    assert.match(s.body.recovery, /^[A-Z0-9]{4}-/);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(sent[0].body.to, ['kareem@example.com']);
    assert.match(sent[0].body.subject, /فعل حسابك/);
    // no way in before the link: the right password only sends the link again
    const early = await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' });
    assert.equal(early.status, 403);
    assert.equal(early.body.unverified, true);
    assert.equal(early.body.sent, true);
    assert.match(early.body.email, /^k•+@example\.com$/);
    assert.equal(sent.length, 2);
    // a wrong password learns nothing
    assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'nope1234' })).body.unverified, undefined);
    const verify = sent[1].body.html.match(/verify=([A-Za-z0-9_-]+)/)[1];
    const v = await call(e, '/verify', { token: verify });
    assert.equal(v.status, 200);
    assert.match(v.body.token, /^m_/);
    assert.equal((await call(e, '/me', undefined, v.body.token)).body.member.verified, true);
    assert.equal((await call(e, '/verify', { token: verify })).status, 400);
    assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' })).status, 200);
    // the same answer for an address with no account
    const before = sent.length;
    assert.equal((await call(e, '/forgot', { email: 'nobody@example.com' })).status, 200);
    assert.equal(sent.length, before);
    await call(e, '/forgot', { email: 'KAREEM@example.com' });
    const reset = sent[before].body.html.match(/reset=([A-Za-z0-9_-]+)/)[1];
    assert.equal((await call(e, '/reset', { token: reset, password: 'dynamite77' })).status, 200);
    assert.equal((await call(e, '/reset', { token: reset, password: 'dynamite88' })).status, 400);
    assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'dynamite77' })).status, 200);
  } finally { globalThis.fetch = real; }
});

test('activation: a session from before it is not signed in; the link mail at most 3 an hour; a name never activated is free again after a day', async () => {
  const e = env();
  const real = globalThis.fetch;
  let mails = 0;
  globalThis.fetch = (async () => { mails++; return new Response('{}', { status: 200 }); }) as any;
  try {
    // signed up before mail was on: a session, not activated
    const old = await signup(e);
    assert.match(old.body.token, /^m_/);
    e.RESEND_API_KEY = 're_test';
    assert.equal((await call(e, '/me', undefined, old.body.token)).status, 401);
    for (let i = 0; i < 3; i++) assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' })).body.sent, true);
    assert.equal((await call(e, '/login', { login: 'kareem_10', password: 'raw2026night' })).body.sent, false);
    assert.equal(mails, 3);
    // a typo in the address: the name comes back a day later (not before)
    const t0 = Date.now();
    const u2 = { first_name: 'سارة', last_name: 'علي', username: 'sara22', email: 'sara@exmaple.com', password: 'abc12345' };
    assert.equal((await handleMembers(new Request('https://w.example/members/signup', { method: 'POST', body: JSON.stringify({ ...u2, captcha: await solved(e) }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.8.1' } }), e, new URL('https://w.example/members/signup'), t0)).status, 200);
    const again = async (at: number, ip: string) => (await handleMembers(new Request('https://w.example/members/signup', { method: 'POST', body: JSON.stringify({ ...u2, email: 'sara@example.com', captcha: await solved(e) }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip } }), e, new URL('https://w.example/members/signup'), at)).status;
    assert.equal(await again(t0 + 3600e3, '8.8.8.2'), 409);
    assert.equal(await again(t0 + 25 * 3600e3, '8.8.8.3'), 200);
  } finally { globalThis.fetch = real; }
});

test('the site\'s own account: made from the panel, signs in on the site, comments as «عرب راسلنج» (official, gold), can\'t be renamed or stopped', async () => {
  const e = env();
  e.MEDIA = null;
  assert.equal((await studioOfficialAccount(e)).account, null);
  // a name members can't take is fine here, a weak password isn't
  assert.equal((await studioOfficialAccount(e, { username: 'ArabWrestling', email: 'contact@arab-wrestling.com', password: 'short' })).success, false);
  const made: any = await studioOfficialAccount(e, { username: 'ArabWrestling', email: 'Contact@Arab-Wrestling.com', password: 'ringside2026' });
  assert.equal(made.success, true);
  assert.equal(made.account.email, 'contact@arab-wrestling.com');
  const s = await call(e, '/login', { login: 'arabwrestling', password: 'ringside2026' });
  assert.equal(s.status, 200);
  assert.equal(s.body.member.official, true);
  assert.equal(s.body.member.display, 'عرب راسلنج');
  assert.equal(s.body.member.pic, 'official');
  // its name and picture stay
  assert.equal((await call(e, '/profile', { display: 'محمد', pic: 'w:cm-punk', bio: 'صاحب الموقع' }, s.body.token)).body.member.display, 'عرب راسلنج');
  const STORY = '/news/خبر/';
  const headers = { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json', Authorization: `Bearer ${s.body.token}` };
  const r = await handleComments(new Request('https://w.example/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'أهلًا بكم في عرب راسلنج' }), headers }), e, new URL('https://w.example/comments')).then((x) => x.json() as any);
  assert.equal(r.ok, true);
  assert.equal(r.official, true);
  const list = await handleComments(new Request(`https://w.example/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w.example/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json() as any);
  assert.equal(list.items[0].official, true);
  assert.equal(list.items[0].name, 'عرب راسلنج');
  // a second one isn't made: the same account is changed (a new password signs it out everywhere)
  const again: any = await studioOfficialAccount(e, { password: 'mainevent2027' });
  assert.equal(again.account.id, made.account.id);
  assert.equal((await call(e, '/me', undefined, s.body.token)).status, 401);
  assert.equal((await call(e, '/login', { login: 'contact@arab-wrestling.com', password: 'mainevent2027' })).status, 200);
  assert.equal((await studioBanMember(e, made.account.id, true)).success, false);
  // members still can't take the name
  assert.ok(usernameProblem('ArabWrestling'));
});

test('the blue badge: a new member starts without it; the owner gives it and takes it away (on the site and on the account)', async () => {
  const e = env();
  e.MEDIA = null;
  const s = await signup(e);
  assert.equal(s.body.member.blue, false);
  const STORY = '/news/خبر/';
  const headers = { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json', Authorization: `Bearer ${s.body.token}` };
  const posted = await handleComments(new Request('https://w.example/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'تعليق' }), headers }), e, new URL('https://w.example/comments')).then((x) => x.json() as any);
  assert.equal(posted.blue, false);
  const list = async () => (await handleComments(new Request(`https://w.example/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w.example/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json() as any)).items[0];
  assert.equal((await list()).blue, false);
  assert.equal((await list()).member, 'kareem_10');
  assert.equal((await studioBadgeMember(e, s.body.member.id, true)).success, true);
  assert.equal((await list()).blue, true);
  assert.equal((await call(e, '/me', undefined, s.body.token)).body.member.blue, true);
  assert.equal((await studioMemberDetail(e, s.body.member.id) as any).member.badge, 1);
  await studioBadgeMember(e, s.body.member.id, false);
  assert.equal((await list()).blue, false);
  // the site's own account keeps its gold one, never the blue
  const off: any = await studioOfficialAccount(e, { username: 'ArabWrestling', email: 'contact@arab-wrestling.com', password: 'ringside2026' });
  assert.equal((await studioBadgeMember(e, off.account.id, true)).success, false);
  assert.equal((await studioBadgeMember(e, 999, true)).success, false);
});

test('comments are the members\' only; the site\'s own account hearts or removes any comment from the page', async () => {
  const e = env();
  e.MEDIA = null;
  const STORY = '/news/خبر/';
  const headers = { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json' };
  const post = (body: any, token = '') => handleComments(new Request('https://w.example/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'زائر', ...body }), headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e, new URL('https://w.example/comments')).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  const v = await post({ text: 'تعليق زائر' });
  assert.equal(v.status, 401);
  assert.equal(v.body.signedOut, true);
  const s = await signup(e);
  const c = await post({ text: 'تعليق عضو' }, s.body.token);
  assert.equal(c.status, 200);
  const mod = (body: any, token: string) => handleComments(new Request('https://w.example/comments/mod', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }), e, new URL('https://w.example/comments/mod')).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  // a member can't
  assert.equal((await mod({ op: 'delete', id: c.body.id }, s.body.token)).status, 403);
  await studioOfficialAccount(e, { username: 'ArabWrestling', email: 'contact@arab-wrestling.com', password: 'ringside2026' });
  const off = await call(e, '/login', { login: 'arabwrestling', password: 'ringside2026' }, '', '8.8.4.4');
  assert.equal(off.body.member.premium > Date.now(), true); // every privilege, premium included
  assert.equal((await mod({ op: 'heart', id: c.body.id }, off.body.token)).body.ok, true);
  const list = async () => (await handleComments(new Request(`https://w.example/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w.example/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json() as any)).items;
  assert.equal((await list())[0].hearted, true);
  assert.equal((await mod({ op: 'delete', id: c.body.id }, off.body.token)).body.ok, true);
  assert.equal((await list()).length, 0);
});

test('without mail, no account is ever freed for someone else: a day-old name and address stay their owner\'s', async () => {
  const e = env();
  const first = await signup(e);
  assert.equal(first.status, 200);
  e.ANALYTICS.raw.prepare('UPDATE members SET created = ? WHERE username = ?').run(Date.now() - 3 * 86400e3, 'kareem_10');
  const again = await signup(e, { email: 'other@example.com' }, '41.9.9.9');
  assert.equal(again.status, 409);
  const byMail = await signup(e, { username: 'someone_else' }, '41.9.9.8');
  assert.equal(byMail.status, 409);
  assert.equal((e.ANALYTICS.raw.prepare('SELECT COUNT(*) n FROM members').get() as any).n, 1);
  // a bad address in a member's link is a plain «no one by that name», never a crash
  assert.equal((await call(e, '/u/%E0')).status, 404);
});

test('the panel: the site\'s members list never takes the team list\'s address; a page\'s click handler ends with the page', async () => {
  const { readFileSync } = await import('node:fs');
  const idx = readFileSync(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../studio/js/api.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../studio/js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(idx, /path === "\/api\/studio\/members" &&/);
  assert.match(idx, /path === "\/api\/studio\/site-members" && request\.method === "GET"/);
  assert.match(api, /members: \(\) => call\('\/api\/studio\/members'\)/);
  assert.match(api, /siteMembers: \(\) => call\('\/api\/studio\/site-members'\)/);
  assert.match(app, /page\.onclick = null;/);
});

test('a member\'s own picture: a real image only, theirs only, the old one removed, and their comments show the new one', async () => {
  const e = env();
  const store = new Map<string, Uint8Array>();
  e.MEDIA = { put: async (k: string, v: Uint8Array) => { store.set(k, v); }, get: async (k: string) => store.has(k) ? { body: store.get(k), httpMetadata: {} } : null, delete: async (k: string) => { store.delete(k); } };
  const s = (await signup(e)).body;
  const png = new Uint8Array(600); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  // a file that only says it's a picture is refused
  const fake = new Uint8Array(600); fake.set([0x3c, 0x73, 0x76, 0x67]);
  assert.equal((await call(e, '/pic', { image: 'data:image/png;base64,' + b64(fake) }, s.token)).status, 400);
  assert.equal((await call(e, '/pic', { image: 'data:image/svg+xml;base64,' + b64(fake) }, s.token)).status, 400);
  const up = await call(e, '/pic', { image: 'data:image/png;base64,' + b64(png) }, s.token);
  assert.equal(up.status, 200);
  const first = up.body.member.pic;
  assert.match(first, /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/members\/pic\/\d+\/[a-f0-9]{16}\.png$/);
  assert.equal(store.size, 1);
  // served to anyone, kept for good
  const key = first.replace('https://arw-site-bot.m7mdibrahimpc.workers.dev/members', '');
  const got = await handleMembers(new Request('https://w.example/members' + key), e, new URL('https://w.example/members' + key));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('Content-Type'), 'image/png');
  // a comment, then a new picture: the old file goes, the comment shows the new one
  const STORY = '/news/صورة/';
  await handleComments(new Request('https://w/comments', { method: 'POST', body: JSON.stringify({ p: STORY, t: 9000, website: '', name: 'x', text: 'تعليق بصورتي' }), headers: { 'User-Agent': 'Mozilla/5.0 Safari', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3', 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` } }), e, new URL('https://w/comments'));
  const second = (await call(e, '/pic', { image: 'data:image/png;base64,' + b64(png) }, s.token)).body.member.pic;
  assert.notEqual(second, first);
  assert.equal(store.size, 1);
  const list: any = await handleComments(new Request(`https://w/comments?p=${encodeURIComponent(STORY)}`), e, new URL(`https://w/comments?p=${encodeURIComponent(STORY)}`)).then((x) => x.json());
  assert.equal(list.items[0].pic, second);
  // another member can't take this picture as theirs
  const other = (await signup(e, { username: 'sara22', email: 'sara@example.com' }, '41.7.7.7')).body;
  const steal = await call(e, '/profile', { pic: second }, other.token);
  assert.equal(steal.body.member.pic, '');
  // a star's picture instead: the upload goes too
  await call(e, '/profile', { pic: 'w:cody-rhodes' }, s.token);
  assert.equal(store.size, 0);
});

test('once: the blue badge every early member got goes; the owner\'s own and the gold ones stay; never twice', async () => {
  const { resetAutoBadges } = await import('../worker/src/members');
  const e = env();
  const a = (await signup(e, { username: 'early_one', email: 'e1@example.com' }, '41.1.1.1')).body;
  const b = (await signup(e, { username: 'early_two', email: 'e2@example.com' }, '41.1.1.2')).body;
  const c = (await signup(e, { username: 'gold_one', email: 'e3@example.com' }, '41.1.1.3')).body;
  const db = e.ANALYTICS.raw;
  const idOf = (u: string) => (db.prepare('SELECT id FROM members WHERE username = ?').get(u) as any).id;
  db.prepare('UPDATE members SET badge = 1').run();
  db.prepare('UPDATE members SET badge = 2 WHERE username = ?').run('gold_one');
  const changed = await resetAutoBadges(e, [idOf('early_two')]);
  assert.deepEqual(changed, [idOf('early_one')]);
  const badge = (u: string) => (db.prepare('SELECT badge FROM members WHERE username = ?').get(u) as any).badge;
  assert.deepEqual([badge('early_one'), badge('early_two'), badge('gold_one')], [0, 1, 2]);
  assert.equal((await call(e, '/me', undefined, a.token)).body.member.blue, false);
  assert.equal((await call(e, '/me', undefined, b.token)).body.member.blue, true);
  assert.equal((await call(e, '/me', undefined, c.token)).body.member.gold, true);
  // done once: a badge given afterwards is never taken
  db.prepare('UPDATE members SET badge = 1 WHERE username = ?').run('early_one');
  assert.equal(await resetAutoBadges(e, []), null);
  assert.equal(badge('early_one'), 1);
});

test('the account page asks for no recovery code: sign-up goes straight on, a forgotten password comes back by mail (owner 2026-10-16)', async () => {
  // «في ناس كتير مش فاهمه ده ايه اصلا وبتوقف عن مرحلة التسجيل فا شيلها خالص»
  const fs = await import('node:fs');
  const page = fs.readFileSync('pages/account.njk', 'utf-8'), js = fs.readFileSync('assets/account.js', 'utf-8');
  for (const gone of ['data-view="welcome"', 'data-form="code"', 'data-act="recovery"', 'كود الاسترجاع', 'كود استرجاع', 'acct-code']) {
    assert.ok(!page.includes(gone), `account page: ${gone}`);
  }
  assert.ok(!/welcome\(|forms\.code|كود الاسترجاع|\/recover'/.test(js));
  assert.match(js, /if \(d\.pending\) \{ pending\(\{ login: u, password: p \}, d\.email, true\); return; \}\n\s*signedIn\(d\);\n\s*done\(\);/);
  assert.match(page, /data-form="mail"/);
});

test('sign-up asks the first and second names first; they become the shown name and the panel sees them (owner 2026-10-18)', async () => {
  // «زود في التسجيل في الموقع لما حد يسجل بتكتب اسم الاول والاسم الثاني اول حاجة»
  const { cleanPersonName } = await import('../worker/src/members');
  assert.deepEqual(cleanPersonName('  محمد  ', 'first'), { name: 'محمد', problem: null });
  assert.equal(cleanPersonName('Abdel Rahman', 'first').problem, null);
  assert.equal(cleanPersonName("O'Neil-Smith", 'last').problem, null);
  assert.match(cleanPersonName('', 'first').problem!, /اكتب الاسم الأول/);
  assert.match(cleanPersonName('م', 'last').problem!, /الاسم الثاني من حرفين/);
  assert.match(cleanPersonName('محمد2', 'first').problem!, /حروف فقط/);
  assert.match(cleanPersonName('a'.repeat(21), 'first').problem!, /إلى 20/);
  const e = env();
  const none = await signup(e, { first_name: '', last_name: '' });
  assert.equal(none.status, 400);
  assert.equal(none.body.field, 'first_name');
  assert.equal((await signup(e, { last_name: '' })).body.field, 'last_name');
  const r = await signup(e, { first_name: 'محمد', last_name: 'إبراهيم' });
  assert.equal(r.status, 200);
  const row = e.ANALYTICS.raw.prepare("SELECT first_name, last_name, display FROM members WHERE username = 'kareem_10'").get() as any;
  assert.deepEqual({ ...row }, { first_name: 'محمد', last_name: 'إبراهيم', display: 'محمد إبراهيم' });
  // the page: both boxes first in the sign-up form, sent with the rest
  const fs = await import('node:fs');
  const page = fs.readFileSync('pages/account.njk', 'utf-8');
  const form = page.slice(page.indexOf('data-form="up"'));
  assert.ok(form.indexOf('name="first_name"') < form.indexOf('name="username"'));
  assert.ok(form.indexOf('name="last_name"') < form.indexOf('name="username"'));
  assert.match(fs.readFileSync('assets/account.js', 'utf-8'), /api\('\/signup', \{ first_name: fn, last_name: ln,/);
  assert.match(fs.readFileSync('studio/js/views/site-members.js', 'utf-8'), /fact\('الاسم', realName\(m\)/);
});
