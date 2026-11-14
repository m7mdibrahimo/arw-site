// «النشر السريع» (INCIDENTS #1296): a panel save on the live site in about a minute, never a stale page after the full build
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { handle, notFound, newer, _reset } from '../site-worker/fast.js';
import { verifyActionsToken, storePages, listPages, prunePages, allowedUrl, handleFastLane, AUDIENCE } from '../worker/src/fast-lane';
import { eventFiles, pickInputs, hashedAssets } from '../scripts/fast-lane.mjs';

const require = createRequire(import.meta.url);
const render = require('../lib/fast-lane-render.cjs');

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (l: any[]) => { const o = []; for (const s of l) o.push(await s.run()); return o; } } as any;
}

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const page = (word: string) => `<!DOCTYPE html><html lang="ar"><head><title>${word}</title></head><body>${word} ${'x'.repeat(300)}</body></html>`;

// ── the site's script (site-worker/fast.js) with a fake deployment and a fake bot ──────────────────────────────
function site({ build = { commit: C, commitTime: 1000, recent: [C] } as any, fast = [] as any[], botDown = false } = {}) {
  _reset();
  const files: Record<string, { body: string; headers?: Record<string, string> }> = {
    '/': { body: 'REAL HOME', headers: { 'Cache-Control': 'no-cache, must-revalidate' } },
    '/shows/': { body: 'REAL SHOWS' },
    '/news/': { body: 'REAL NEWS' },
    '/shows/old-show/': { body: 'REAL OLD SHOW' },
    '/404': { body: 'NOT FOUND PAGE' },
    '/en/404': { body: 'ENGLISH NOT FOUND' },
    '/build.json': { body: JSON.stringify(build) },
  };
  const calls: string[] = [];
  const ASSETS = {
    async fetch(req: any) {
      const r = typeof req === 'string' ? new Request(req) : req;
      const u = new URL(r.url);
      const f = files[u.pathname];
      const h = new Headers({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Type': 'text/html', ...(f?.headers || {}) });
      if (!f) return new Response(null, { status: 404, headers: h });
      if (r.headers.get('If-None-Match')) return new Response(null, { status: 304, headers: h });
      return new Response(r.method === 'HEAD' ? null : f.body, { status: 200, headers: { ...Object.fromEntries(h), ETag: '"real"' } });
    },
  };
  const FAST = {
    async fetch(req: any) {
      const u = new URL(typeof req === 'string' ? req : req.url);
      calls.push(u.pathname + u.search);
      if (botDown) throw new Error('down');
      if (u.pathname === '/fast-lane/index') return Response.json({ pages: fast.map(({ html, ...p }) => p) });
      const p = fast.find((x) => x.url === u.searchParams.get('url'));
      return p ? new Response(p.html, { headers: { 'X-Fast-Commit': p.commit } }) : new Response('nf', { status: 404 });
    },
  };
  const ctx = { waitUntil() {} };
  const get = (path: string, init: RequestInit = {}) => handle(new Request('https://arab-wrestling.com' + path, init), { ASSETS, FAST }, ctx);
  return { get, calls };
}

test('a new show saved a moment ago is on the site before its full build, with the real page\'s headers', async () => {
  const s = site({ fast: [{ url: '/shows/new-show/', commit: A, commitTime: 2000, html: page('FAST NEW') }] });
  const r = await s.get('/shows/new-show/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /FAST NEW/);
  assert.equal(r.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  assert.equal(r.headers.get('ETag'), null);
  // «/shows/new-show» → «/shows/new-show/», like the assets' trailing-slash rule
  const slashless = await s.get('/shows/new-show?x=1');
  assert.equal(slashless.status, 307);
  assert.equal(slashless.headers.get('Location'), '/shows/new-show/?x=1');
  // HEAD: no body
  const head = await s.get('/shows/new-show/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('an Arabic address is matched by its decoded form, as Eleventy writes page.url', async () => {
  const url = '/news/ري-ميستيريو-يقدم-العضو-الجديد/';
  const s = site({ fast: [{ url, commit: A, commitTime: 2000, html: page('ARABIC STORY') }] });
  const r = await s.get(encodeURI(url));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ARABIC STORY/);
});

test('the fast copy is never shown once the deployment has its commit (newer build, or the commit in /build.json recent)', async () => {
  const fast = [{ url: '/shows/new-show/', commit: A, commitTime: 2000, html: page('FAST NEW') }, { url: '/', commit: A, commitTime: 2000, html: page('FAST HOME') }];
  for (const build of [{ commit: B, commitTime: 2000, recent: [B, A] }, { commit: B, commitTime: 2500, recent: [B] }, { commit: B, commitTime: 1500, recent: [B, A] }]) {
    const s = site({ build, fast });
    const r = await s.get('/shows/new-show/');
    assert.equal(r.status, 404, JSON.stringify(build));
    assert.equal(await r.text(), 'NOT FOUND PAGE');
    const home = await s.get('/');
    assert.equal(await home.text(), 'REAL HOME');
  }
  assert.equal(newer({ commit: A, commitTime: 2000 }, { commitTime: 1000, recent: new Set([C]) }), true);
  assert.equal(newer({ commit: A, commitTime: 2000 }, { commitTime: 2000, recent: new Set([C]) }), false);
  assert.equal(newer({ commit: A, commitTime: NaN }, { commitTime: 1000, recent: new Set() }), false);
  assert.equal(newer(undefined, { commitTime: 1000, recent: new Set() }), false);
});

test('no readable /build.json: never a fast copy', async () => {
  const s = site({ build: null, fast: [{ url: '/', commit: A, commitTime: 2000, html: page('FAST HOME') }] });
  assert.equal(await (await s.get('/')).text(), 'REAL HOME');
});

test('the three listings show their fast copy only while it is newer; a browser\'s If-None-Match never gets the old copy back', async () => {
  const s = site({ fast: [{ url: '/', commit: A, commitTime: 2000, html: page('FAST HOME') }, { url: '/news/', commit: B, commitTime: 900, html: page('OLD NEWS') }] });
  const home = await s.get('/', { headers: { 'If-None-Match': '"real"' } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /FAST HOME/);
  assert.equal(home.headers.get('Cache-Control'), 'no-cache, must-revalidate', 'the home page\'s own _headers rule');
  assert.equal(home.headers.get('ETag'), null);
  assert.equal(await (await s.get('/news/')).text(), 'REAL NEWS', 'older than the deployment: the real page');
  assert.equal(await (await s.get('/shows/')).text(), 'REAL SHOWS', 'no copy: the real page');
  // the page body is asked once per commit, the list every few seconds at most
  await s.get('/'); await s.get('/');
  assert.equal(s.calls.filter((c) => c.startsWith('/fast-lane/page')).length, 1);
  assert.equal(s.calls.filter((c) => c === '/fast-lane/index').length, 1);
});

test('the bot down or broken: the site is exactly as without the fast lane', async () => {
  const s = site({ botDown: true, fast: [{ url: '/', commit: A, commitTime: 2000, html: page('FAST HOME') }] });
  assert.equal(await (await s.get('/')).text(), 'REAL HOME');
  const r = await s.get('/shows/new-show/');
  assert.equal(r.status, 404);
  assert.equal(await (await s.get('/shows/old-show/')).text(), 'REAL OLD SHOW');
});

test('a missing address is the nearest 404.html with status 404, as not_found_handling «404-page» did', async () => {
  const s = site();
  for (const [path, body] of [['/nope/', 'NOT FOUND PAGE'], ['/a/b/c', 'NOT FOUND PAGE'], ['/en/nope/', 'ENGLISH NOT FOUND'], ['/en/shows/x', 'ENGLISH NOT FOUND'], ['/shows/missing/', 'NOT FOUND PAGE']] as const) {
    const r = await s.get(path);
    assert.equal(r.status, 404, path);
    assert.equal(await r.text(), body, path);
    assert.equal(r.headers.get('X-Frame-Options'), 'SAMEORIGIN');
    assert.equal(r.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  }
  // only a show or story address ever asks the bot
  await s.get('/wp-login.php');
  assert.equal(s.calls.length, 1);
  const cfg = fs.readFileSync('wrangler.static.jsonc', 'utf8');
  assert.match(cfg, /"not_found_handling": "none"/);
  assert.match(cfg, /"run_worker_first": \["\/", "\/shows\/", "\/news\/"\]/);
  assert.match(cfg, /"main": "site-worker\/index\.js"/);
  assert.match(cfg, /"services": \[\{ "binding": "FAST", "service": "arw-site-bot" \}\]/);
  assert.equal(typeof notFound, 'function');
});

// ── the bot's half (worker/src/fast-lane.ts) ──────────────────────────────────────────────────────────────────
const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
async function signer() {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk: any = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const fetcher = (async () => Response.json({ keys: [{ ...jwk, kid: 'k1' }] })) as any;
  const sign = async (claims: any, kid = 'k1') => {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })), body = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64url(sig)}`;
  };
  return { fetcher, sign };
}
const ENV = { GITHUB_OWNER: 'm7mdibrahimo', GITHUB_REPO: 'arw-site' };
const NOW = Date.parse('2026-11-14T12:00:00Z');
const good = () => ({ iss: 'https://token.actions.githubusercontent.com', aud: AUDIENCE, repository: 'm7mdibrahimo/arw-site', ref: 'refs/heads/main', workflow_ref: 'm7mdibrahimo/arw-site/.github/workflows/fast-lane.yml@refs/heads/main', sha: A, iat: NOW / 1000 - 30, exp: NOW / 1000 + 300 });

test('only this repo\'s own fast-lane workflow on main can send pages (GitHub\'s signed token, no secret)', async () => {
  const { fetcher, sign } = await signer();
  const ok = await verifyActionsToken(await sign(good()), ENV, { now: NOW, fetcher });
  assert.equal(ok?.sha, A);
  const bad: [string, any][] = [
    ['a fork', { repository: 'someone/arw-site', workflow_ref: 'someone/arw-site/.github/workflows/fast-lane.yml@refs/heads/main' }],
    ['another branch', { ref: 'refs/heads/evil' }],
    ['a pull request', { ref: 'refs/pull/1/merge' }],
    ['another workflow', { workflow_ref: 'm7mdibrahimo/arw-site/.github/workflows/other.yml@refs/heads/main' }],
    ['another audience', { aud: 'sts.amazonaws.com' }],
    ['expired', { exp: NOW / 1000 - 1 }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['no sha', { sha: 'main' }],
  ];
  for (const [why, change] of bad) assert.equal(await verifyActionsToken(await sign({ ...good(), ...change }), ENV, { now: NOW, fetcher }), null, why);
  const t = await sign(good());
  const forged = t.split('.').slice(0, 2).join('.') + '.' + b64url(new Uint8Array(256));
  assert.equal(await verifyActionsToken(forged, ENV, { now: NOW, fetcher }), null, 'a bad signature');
  assert.equal(await verifyActionsToken('not.a.token', ENV, { now: NOW, fetcher }), null);
  assert.equal(await verifyActionsToken(await sign(good(), 'unknown-kid'), ENV, { now: NOW, fetcher }), null);
});

test('a page is replaced only by a newer commit\'s copy, and the copies the live site has go', async () => {
  const db = d1();
  assert.equal(await storePages(db, A, 2000, [{ url: '/shows/x/', html: page('A'), input: 'content/shows/x.md' }, { url: '/', html: page('HOME A') }]), 2);
  assert.equal(await storePages(db, B, 1500, [{ url: '/shows/x/', html: page('OLDER') }]), 1);
  let row: any = await db.prepare("SELECT * FROM fast_pages WHERE url = '/shows/x/'").first();
  assert.equal(row.commit_sha, A, 'an older commit never replaces a newer copy');
  await storePages(db, B, 3000, [{ url: '/shows/x/', html: page('NEWER'), input: 'content/shows/x.md' }]);
  row = await db.prepare("SELECT * FROM fast_pages WHERE url = '/shows/x/'").first();
  assert.equal(row.commit_sha, B);
  assert.match(row.html, /NEWER/);
  // not a content page or a listing, too small, not HTML: refused
  assert.equal(await storePages(db, C, 4000, [{ url: '/admin/', html: page('X') }, { url: '/shows/2/', html: page('X') }, { url: '/shows/y/', html: 'tiny' }, { url: '/feed.xml', html: page('X') }, { url: '/shows/a/b/', html: page('X') }]), 0);
  const list = await listPages(db);
  assert.deepEqual(list.map((p: any) => [p.url, p.commit, p.input]).sort(), [['/', A, ''], ['/shows/x/', B, 'content/shows/x.md']]);
  assert.equal(await prunePages(db, 2500, [], NOW), 1, 'the live build is newer than A');
  assert.equal(await prunePages(db, 1000, [B], NOW), 1, 'the live build has B');
  assert.equal((await listPages(db)).length, 0);
  await storePages(db, C, 9000, [{ url: '/', html: page('C') }], NOW - 25 * 3600_000);
  assert.equal(await prunePages(db, 0, [], NOW), 1, 'a day old: gone whatever happened');
  assert.equal(allowedUrl('/news/ري-ميستيريو/'), true);
  assert.equal(allowedUrl('/news/3/'), false);
});

test('the bot\'s endpoints: the index for the site and the panel (open to any origin), a page, and a signed upload', async () => {
  const { fetcher, sign } = await signer();
  const db = d1();
  const env: any = { ...ENV, ANALYTICS: db, SITE_ORIGIN: 'https://arab-wrestling.com' };
  const call = (path: string, init: RequestInit = {}) => handleFastLane(new Request('https://bot' + path, init), env, path.split('?')[0], new URL('https://bot' + path));
  assert.equal(await call('/elsewhere'), null);
  const denied = await call('/fast-lane/pages', { method: 'POST', body: JSON.stringify({ commitTime: 1, pages: [] }), headers: { Authorization: 'Bearer x.y.z' } });
  assert.equal(denied!.status, 403);
  await storePages(db, A, 2000, [{ url: '/shows/x/', html: page('A'), input: 'content/shows/x.md' }]);
  const idx = await call('/fast-lane/index');
  assert.equal(idx!.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual((await idx!.json()).pages, [{ url: '/shows/x/', commit: A, commitTime: 2000, input: 'content/shows/x.md' }]);
  const one = await call('/fast-lane/page?url=' + encodeURIComponent('/shows/x/'));
  assert.equal(one!.headers.get('X-Fast-Commit'), A);
  assert.match(await one!.text(), /<title>A<\/title>/);
  assert.equal((await call('/fast-lane/page?url=/admin/'))!.status, 404);
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /const fast = await handleFastLane\(request, env as any, path, url\);\n      if \(fast\) return fast;/);
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /fastLaneCleanup\(env as any\)/);
  void fetcher; void sign;
});

// ── the GitHub steps (scripts/fast-lane.mjs) and the render (lib/fast-lane-render.cjs) ─────────────────────────
test('what the fast lane renders: the push\'s saved shows and stories plus everything since the live build, never a removed one', () => {
  const event = { commits: [{ added: ['content/shows/a.md', 'content/images/x.jpg'], modified: ['content/news/b.md'], removed: [] }, { added: [], modified: [], removed: ['content/news/b.md'] }] };
  assert.deepEqual(eventFiles(event), ['content/shows/a.md', 'content/images/x.jpg'], 'the removed story is out; pickInputs keeps only shows and stories');
  const exists = (f: string) => f !== 'content/shows/gone.md';
  assert.deepEqual(pickInputs([['content/shows/a.md'], ['content/news/c.md', 'content/shows/a.md', 'content/shows/gone.md', 'content/news-en/d.md', '_data/x.json']], exists), ['content/shows/a.md', 'content/news/c.md']);
  assert.equal(pickInputs([Array.from({ length: 50 }, (_, i) => `content/news/${i}.md`)], () => true).length, 30);
  assert.deepEqual(hashedAssets('<link href="/assets/a.0123456789.css"><script src="/assets/b.js"></script><script src="/en/assets/c.abcdef0123.js"></script><link href="/assets/a.0123456789.css">'), ['/assets/a.0123456789.css', '/en/assets/c.abcdef0123.js']);
});

test('the render: only the saved pages and the first page of each listing, nothing in a normal build', () => {
  assert.equal(render.enabled(undefined), false);
  assert.equal(render.enabled(''), false);
  assert.equal(render.enabled(' '), true, 'no saved page: the listings alone (a deletion)');
  assert.deepEqual(render.parseInputs('content/shows/a.md, ./content/news/ب.md,content/images/x.jpg,../etc/passwd'), ['./content/shows/a.md', './content/news/ب.md']);
  const inputs = new Set(['./content/shows/a.md']);
  assert.equal(render.wanted({ inputPath: './content/shows/a.md', outputPath: './_site/shows/a/index.html' }, inputs, '_site'), true);
  assert.equal(render.wanted({ inputPath: './content/shows/b.md', outputPath: './_site/shows/b/index.html' }, inputs, '_site'), false);
  for (const out of ['./_site/index.html', '_site/shows/index.html', './_site/news/index.html']) assert.equal(render.wanted({ inputPath: './pages/x.njk', outputPath: out }, inputs, '_site'), true, out);
  for (const out of ['./_site/shows/2/index.html', './_site/en/index.html', './_site/feed.xml']) assert.equal(render.wanted({ inputPath: './pages/x.njk', outputPath: out }, inputs, '_site'), false, out);
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  assert.match(cfg, /if \(FAST_ON && !fn\.fastLane\) return;/);
  assert.match(cfg, /\}, \{ fastLane: true \}\)\);/);
  assert.match(cfg, /englishCopy\.fastLane = true;/);
  assert.match(cfg, /if \(!FAST_ON\) require\("\.\/lib\/superseded-build\.cjs"\)\.finalCheck\(\);/);
  const wf = fs.readFileSync('.github/workflows/fast-lane.yml', 'utf8');
  assert.match(wf, /id-token: write/);
  assert.match(wf, /cancel-in-progress: \$\{\{ github\.event_name != 'workflow_run' \}\}/);
  assert.match(wf, /workflow_run:\n\s+workflows:\n\s+- Fightful News Auto Watcher\n\s+- Ringside News Auto Watcher\n\s+- Wrestling Inc Auto Watcher/);
  for (const name of ['fightful-watcher', 'ringsidenews-watcher', 'wrestlinginc-watcher']) assert.match(wf, new RegExp(`- ${fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8').match(/^name: (.+)$/m)![1]}\n`));
  assert.match(wf, /!\/content\/images\/\n\s+!\/dist\/videos\//);
});

test('the bell says «ظهر على الموقع» for a new show the fast lane already shows, never for an edit', () => {
  const src = fs.readFileSync('studio/js/notify.js', 'utf8');
  const body = src.slice(src.indexOf('export function inFastLane'), src.indexOf('export function setupBell'));
  const inFastLane = new Function(`${body.replace('export ', '')}; return inFastLane;`)();
  const at = Date.parse('2026-11-14T07:04:45Z');
  const pages = [{ url: '/shows/smackdown/', input: 'content/shows/2026-smackdown.md', commit: A, commitTime: at / 1000 + 2 }];
  assert.equal(inFastLane(pages, { type: 'create', collection: 'shows', slug: '2026-smackdown', commit: A, at }), true);
  assert.equal(inFastLane(pages, { type: 'create', collection: 'shows', slug: '2026-smackdown', commit: B, at: at - 60_000 }), true, 'a later save\'s copy has it too');
  assert.equal(inFastLane(pages, { type: 'create', collection: 'shows', slug: '2026-smackdown', commit: B, at: at + 60_000 }), false, 'an older copy doesn\'t have this save');
  assert.equal(inFastLane(pages, { type: 'edit', collection: 'shows', slug: '2026-smackdown', commit: A, at }), false);
  assert.equal(inFastLane(pages, { type: 'create', collection: 'shows', slug: 'other', commit: A, at }), false);
  assert.match(src, /const pages = await fastLanePages\(\); for \(const n of still\.filter\(n => inFastLane\(pages, n\)\)\) markLive\(n\.commit\);/);
});

test('the fast render\'s tag index gives exactly Eleventy\'s own collections (same items, same order, new arrays)', async () => {
  const src = 'node_modules/@11ty/eleventy/src/';
  const TemplateCollection = (await import(`../${src}TemplateCollection.js`)).default;
  const TemplateData = (await import(`../${src}Data/TemplateData.js`)).default;
  const TemplateMap = (await import(`../${src}TemplateMap.js`)).default;
  const { TemplatePath } = await import('@11ty/eleventy-utils');
  class Fast extends TemplateCollection {}
  render.speedUpTags(Fast, TemplateData);
  const plain = new TemplateCollection(), fast = new Fast();
  const tags = ['WWE', 'AEW', 'RAW', 'TNA', 'رو'];
  for (let i = 0; i < 300; i++) {
    const t = [tags[i % 5], tags[(i * 7) % 5], i % 11 === 0 ? 'WWE,AEW' : tags[(i * 3) % 5]];
    const item = { inputPath: `./content/news/${(i * 37) % 300}.md`, date: new Date(Date.UTC(2026, 10, 1 + (i % 9))), data: { tags: i % 13 === 0 ? 'WWE' : t, eleventyExcludeFromCollections: i % 17 === 0 ? ['RAW'] : undefined } };
    plain.add(item); fast.add(item);
  }
  for (const tag of [...tags, 'WWE,AEW', 'none', '', undefined]) {
    const a = plain.getFilteredByTag(tag as any), b = fast.getFilteredByTag(tag as any);
    assert.deepEqual(b.map((x: any) => x.inputPath), a.map((x: any) => x.inputPath), String(tag));
    assert.notEqual(b, fast.getFilteredByTag(tag as any), 'a new array each time');
  }
  assert.deepEqual(fast.getAllSorted().map((x: any) => x.inputPath), plain.getAllSorted().map((x: any) => x.inputPath));
  // an item added later is in the next answer
  const late = { inputPath: './content/news/late.md', date: new Date(Date.UTC(2026, 10, 5)), data: { tags: ['AEW'] } };
  plain.add(late); fast.add(late);
  assert.deepEqual(fast.getFilteredByTag('AEW').map((x: any) => x.inputPath), plain.getFilteredByTag('AEW').map((x: any) => x.inputPath));
  // the map lookup: the first entry with that path, relative or absolute
  class FastMap extends TemplateMap {}
  render.speedUpLookup(FastMap, TemplatePath);
  const m: any = Object.create(FastMap.prototype), p: any = Object.create(TemplateMap.prototype);
  m.map = p.map = [{ inputPath: './a.md', n: 1 }, { inputPath: TemplatePath.absolutePath('./b.md'), n: 2 }, { inputPath: './b.md', n: 3 }, { inputPath: './a.md', n: 4 }];
  for (const k of ['./a.md', './b.md', TemplatePath.absolutePath('./a.md'), './c.md']) assert.equal(m.getMapEntryForInputPath(k)?.n, p.getMapEntryForInputPath(k)?.n, k);
  m.map.push({ inputPath: './c.md', n: 5 });
  assert.equal(m.getMapEntryForInputPath('./c.md')?.n, 5);
});
