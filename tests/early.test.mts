// «العرض قبل الجميع» (owner 2026-10-29): the show is published at once, its watch servers and download links for premium
// members only till its time (early_until), then for everyone. They are never in the public repo, page or JSON meanwhile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { splitEarly, joinEarly, earlyUntil, isVaulted, linksOf, timeLeft, earlyOpen, earlyOnSave, earlyOnRead, earlyLinks, releaseEarly, MIN_WINDOW } from '../worker/src/early';
import { handleMembers } from '../worker/src/members';
import { handlePremium, studioPremiumGrant } from '../worker/src/premium';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (l: any[]) => { const o = []; for (const s of l) o.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return o; }, raw: db } as any;
}
const kv = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };

const NOW = Date.parse('2026-10-29T18:00:00.000Z');
const UNTIL = NOW + 3 * 3600e3;
const show = (until: number | null = UNTIL) => `---
show_type: عرض
federation: WWE
title: WWE Raw 26.10.2026
headline: عرض الرو 26.10.2026 مترجم
date: 2026-10-29T21:00:00.000+03:00
duration: 02:51:10
tags:
  - WWE
image: /content/images/raw.jpg
servers:
  - url: https://ok.ru/video/111
  - url: "https://vidmoly.org/embed-abc.html"
downloads_low: https://pixeldrain.com/u/low1
downloads_high: |-
  https://gofile.io/d/high1
  https://1fichier.com/?high2
layout: post-layout.njk
${until ? `early_until: ${new Date(until).toISOString()}\n` : ''}---
نص العرض`;

test('a show\'s links come out of its file and go back byte for byte', () => {
  const file = show();
  const s = splitEarly(file)!;
  assert.ok(s);
  for (const u of ['ok.ru', 'vidmoly', 'pixeldrain', 'gofile', '1fichier']) assert.ok(!s.text.includes(u), u);
  assert.match(s.text, /^early_servers: 2$/m);
  assert.match(s.text, /^early_downloads: 3$/m);
  assert.ok(s.text.includes('layout: post-layout.njk') && s.text.endsWith('نص العرض'));
  assert.equal(isVaulted(s.text), true);
  assert.equal(isVaulted(file), false);
  assert.equal(joinEarly(s.text, s.vault), file);
  // a file without links: nothing to take out
  assert.equal(splitEarly('---\ntitle: x\n---\n'), null);
  // CRLF files stay CRLF
  const crlf = file.replace(/\n/g, '\r\n');
  const c = splitEarly(crlf)!;
  assert.equal(joinEarly(c.text, c.vault), crlf);
  // links written into the vaulted file by hand meanwhile win: never two «servers:» keys
  const both = s.text.replace('early_servers: 2', 'early_servers: 2\nservers:\n  - url: https://ok.ru/video/999');
  const j = joinEarly(both, s.vault);
  assert.equal((j.match(/^servers:/gm) || []).length, 1);
  assert.ok(j.includes('ok.ru/video/999') && !j.includes('early_servers'));
});

test('the links by quality, the window\'s time and the countdown', () => {
  const l = linksOf(show());
  assert.deepEqual(l.servers, ['https://ok.ru/video/111', 'https://vidmoly.org/embed-abc.html']);
  assert.deepEqual(l.groups.low, ['https://pixeldrain.com/u/low1']);
  assert.deepEqual(l.groups.high, ['https://gofile.io/d/high1', 'https://1fichier.com/?high2']);
  assert.equal(earlyUntil(show()), UNTIL);
  assert.equal(earlyUntil(show(null)), 0);
  assert.equal(earlyUntil(`---\nearly_until: "2026-10-29T23:00:00+03:00"\n---\n`), Date.parse('2026-10-29T20:00:00Z'));
  assert.equal(timeLeft(3 * 3600e3), '03:00:00');
  assert.equal(timeLeft(3 * 3600e3 - 1), '02:59:59');
  assert.equal(timeLeft(59_999), '00:00:59');
  assert.equal(timeLeft(-5000), '00:00:00');
  assert.equal(timeLeft(47 * 3600e3 + 59 * 60e3), '47:59:00');
  assert.equal(timeLeft(3 * 86400e3), '3 أيام');
  assert.equal(earlyOpen(UNTIL, false, NOW), false);
  assert.equal(earlyOpen(UNTIL, true, NOW), true);
  assert.equal(earlyOpen(UNTIL, false, UNTIL), true);
  assert.equal(earlyOpen(0, false, NOW), true);
});

test('the panel: saved without its links during the window, opened whole, cancelled = links back once committed', async () => {
  const db = d1();
  const k = 'shows/raw-26-10';
  const saved = await earlyOnSave(db, k, show(), NOW);
  assert.equal(saved.until, UNTIL);
  assert.ok(!saved.text.includes('ok.ru') && isVaulted(saved.text));
  assert.equal(await earlyOnRead(db, k, saved.text), show());
  // saved again from the editor (whole): the same; saved from a stripped copy: the links are still found
  assert.equal((await earlyOnSave(db, k, show(), NOW + 1000)).text, saved.text);
  assert.equal((await earlyOnSave(db, k, saved.text, NOW + 2000)).text, saved.text);
  // the window moved: its new time
  const later = await earlyOnSave(db, k, show(UNTIL + 3600e3), NOW);
  assert.equal((await earlyLinks(db, k))!.until, UNTIL + 3600e3);
  assert.ok(isVaulted(later.text));
  // a window under a minute isn't one
  const short = await earlyOnSave(db, 'shows/short', show(NOW + MIN_WINDOW - 1), NOW);
  assert.ok(short.text.includes('ok.ru'));
  // cancelled in the panel: the file gets its links, and D1 lets them go only after the commit
  const off = await earlyOnSave(db, k, show(null), NOW);
  assert.equal(off.text, show(null));
  assert.ok(await earlyLinks(db, k));
  await off.after();
  assert.equal(await earlyLinks(db, k), null);
  // a show without a window: untouched, nothing in D1
  const plain = await earlyOnSave(db, 'shows/plain', show(null), NOW);
  assert.equal(plain.text, show(null));
  assert.equal(await earlyLinks(db, 'shows/plain'), null);
});

async function member(e: any, username = 'kareem_10') {
  const cap: any = await (await handleMembers(new Request('https://w/members/captcha'), e, new URL('https://w/members/captcha'))).json();
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'raw2026night', first_name: 'كريم', last_name: 'محمد', captcha: { id: cap.id, answer: e.PUSH_KV.m.get(`members:cap:${cap.id}`) } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.2.3.${username.length}` } }), e, new URL('https://w/members/signup'));
  return (await r.json() as any) as { token: string; member: any };
}
const early = async (e: any, k: string, token = '', now?: number) => {
  const r = await handlePremium(new Request(`https://w/premium/early?k=${k}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), e, new URL(`https://w/premium/early?k=${k}`), now);
  return { status: r.status, body: await r.json() as any };
};

test('/premium/early: nothing for a visitor or a plain member during the window, the links for a premium member, then everyone', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as any; // the repo is never asked while D1 has it
  try {
    const now = Date.now(), until = now + 2 * 3600e3;
    const e: any = { ANALYTICS: d1(), PUSH_KV: kv(), GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 't' };
    const k = 'shows/raw-26-10';
    await earlyOnSave(e.ANALYTICS, k, show(until), now);
    const anon = await early(e, k);
    assert.equal(anon.status, 403);
    assert.equal(anon.body.pub, until);
    assert.ok(!JSON.stringify(anon.body).includes('http'));
    const s = await member(e);
    const plain = await early(e, k, s.token);
    assert.equal(plain.status, 403);
    assert.ok(!JSON.stringify(plain.body).includes('http'));
    await studioPremiumGrant(e, s.member.id, 30);
    const prem = await early(e, k, s.token);
    assert.equal(prem.status, 200);
    assert.equal(prem.body.premium, true);
    assert.deepEqual(prem.body.servers, ['https://ok.ru/video/111', 'https://vidmoly.org/embed-abc.html']);
    assert.deepEqual(prem.body.dl.high, ['https://gofile.io/d/high1', 'https://1fichier.com/?high2']);
    assert.equal(prem.body.downloads.length, 3);
    // a forged token is a visitor
    assert.equal((await early(e, k, 'mb_forged')).status, 403);
    // the time came: anyone, before the links are even back in the file
    const after = await early(e, k, '', until + 1);
    assert.equal(after.status, 200);
    assert.equal(after.body.premium, false);
    assert.equal(after.body.servers.length, 2);
  } finally { globalThis.fetch = real; }
});

test('every minute: a window that ended puts the links back in the file (one commit), a failed commit tries again', async () => {
  const db = d1();
  const k = 'shows/raw-26-10', path = `content/${k}.md`;
  const s = await earlyOnSave(db, k, show(), NOW);
  const repo: Record<string, string> = { [path]: s.text };
  const commits: { path: string; text: string; message: string }[] = [];
  let fail = true;
  const io = {
    read: async (p: string) => (repo[p] != null ? { content: repo[p] } : null),
    commit: async (p: string, text: string, message: string) => { if (fail) throw new Error('GitHub 502'); repo[p] = text; commits.push({ path: p, text, message }); },
  };
  assert.deepEqual(await releaseEarly(db, io, NOW + 3600e3), []); // not yet
  assert.deepEqual(await releaseEarly(db, io, UNTIL), []);        // its time, GitHub down: kept
  assert.ok(await earlyLinks(db, k));
  fail = false;
  assert.deepEqual(await releaseEarly(db, io, UNTIL + 60_000), [k]);
  assert.equal(commits.length, 1);
  assert.equal(repo[path], show());
  assert.match(commits[0].message, /لوحة التحكم/); // the site builds at once (.github/workflows/site-branch.yml)
  assert.equal(await earlyLinks(db, k), null);
  assert.deepEqual(await releaseEarly(db, io, UNTIL + 120_000), []);
  // the show was deleted meanwhile: its row goes, nothing committed
  await earlyOnSave(db, 'shows/gone', show(), NOW);
  assert.deepEqual(await releaseEarly(db, io, UNTIL), ['shows/gone']);
  assert.equal(commits.length, 1);
});

// ── its OK.ru videos: friends-only on OK.ru during the window (off the owner's profile), for everyone after it ──
import { okVideoId, okSig, syncOk, okHidden, okConfigured } from '../worker/src/okru';

test('OK.ru: a video\'s id from its links, and the request\'s signature', () => {
  assert.equal(okVideoId('https://ok.ru/video/17826440612448'), '17826440612448');
  assert.equal(okVideoId('https://ok.ru/videoembed/17826440612448?autoplay=1'), '17826440612448');
  assert.equal(okVideoId('https://m.ok.ru/video/123456789'), '123456789');
  assert.equal(okVideoId('https://vidmoly.org/embed-abc.html'), '');
  assert.equal(okVideoId('https://evil.example/ok.ru/video/123456'), '');
  // md5(sorted «k=v» + md5(token + app secret)); access_token is never in it
  const env = { OK_APP_KEY: 'CBA', OK_APP_SECRET: 'sec', OK_TOKEN: 'tok' };
  const p = { method: 'video.update', application_key: 'CBA', vid: '1', privacy: 'FRIENDS', format: 'json' };
  assert.equal(okSig(p, env), okSig({ ...p, access_token: 'tok' } as any, env));
  assert.match(okSig(p, env), /^[0-9a-f]{32}$/);
  assert.notEqual(okSig(p, env), okSig({ ...p, privacy: 'PUBLIC' }, env));
  assert.notEqual(okSig(p, env), okSig(p, { ...env, OK_SESSION_SECRET: 'abc' }));
  assert.equal(okConfigured({}), false);
  assert.equal(okConfigured(env), true);
});

test('OK.ru: hidden on OK.ru for the window, left out of the members\' servers, public again at release — nothing by hand', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as any;
  try {
    const now = Date.now(), until = now + 2 * 3600e3;
    const e: any = { ANALYTICS: d1(), PUSH_KV: kv(), OK_APP_KEY: 'CBA', OK_SESSION_SECRET: 'ss', OK_TOKEN: 'tok' };
    const db = e.ANALYTICS, k = 'shows/raw-26-10';
    const calls: string[] = [];
    let down = false;
    const call = async (_env: any, method: string, a: any) => { if (down) throw new Error('OK.ru 500'); calls.push(`${method} ${a.vid} ${a.privacy}`); return null; };
    // not set up yet: nothing asked, the video stays public and plays for members
    await earlyOnSave(db, k, show(until), now);
    assert.deepEqual(await syncOk(db, {}, now, call), []);
    const s = await member(e, 'okmember');
    await studioPremiumGrant(e, s.member.id, 30);
    assert.equal((await early(e, k, s.token)).body.servers.length, 2);
    // set up: the save's wish is carried out within the minute
    await syncOk(db, e, now, call);
    assert.deepEqual(calls, ['video.update 111 FRIENDS']);
    assert.deepEqual([...(await okHidden(db, k))], ['111']);
    // friends-only doesn't play in the site's player: the member gets the other servers
    assert.deepEqual((await early(e, k, s.token)).body.servers, ['https://vidmoly.org/embed-abc.html']);
    await syncOk(db, e, now + 60_000, call);
    assert.equal(calls.length, 1); // asked once
    // the window ends: the file gets its links back, the video is public again, and its row goes
    const repo: Record<string, string> = {};
    await releaseEarly(db, { read: async () => null, commit: async (p, t) => { repo[p] = t; } }, until + 1);
    down = true;
    await syncOk(db, e, until + 60_000, call);            // OK.ru down: tried again later
    assert.equal(calls.length, 1);
    down = false;
    await syncOk(db, e, until + 90_000, call);            // too soon after a failure
    assert.equal(calls.length, 1);
    await syncOk(db, e, until + 3 * 60_000, call);
    assert.deepEqual(calls, ['video.update 111 FRIENDS', 'video.update 111 PUBLIC']);
    assert.deepEqual([...(await okHidden(db, k))], []);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM early_ok').first()).n, 0);
    // a window taken off before OK.ru was ever asked: nothing to ask
    await earlyOnSave(db, 'shows/other', show(until), now);
    const off = await earlyOnSave(db, 'shows/other', show(null), now);
    await off.after();
    await syncOk(db, e, now, call);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = real; }
});
