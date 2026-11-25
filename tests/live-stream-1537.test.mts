// «بث مباشر» round two (INCIDENTS #1537): servers playing on our own page, shown before the bell, the owner's full
// control from the panel, the visitor's own time, the full show linked once out, and the section in the search engines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../worker/src/live.ts';

const DYN = Date.UTC(2026, 10, 26, 1, 0);
const fx = (f: string) => fs.readFileSync(`tests/fixtures/live/${f}`, 'utf8');
const post = (src: string, id: number, html: string, host: string, date: string, title: string): L.PostState => ({
  src, id, url: `https://${host}/p${id}/`, title, mod: 'x', key: L.identify(title)!.key, date, seenAt: 0, readAt: 0,
  start: L.findStart(L.postBody(html), date), links: L.extractLinks(html, host), img: L.ogImage(html),
});
const both = () => L.mergeShows([
  post('1max', 1, fx('1max-dynamite.html'), '1max.top', '2026-11-25', 'AEW Dynamite Live 11/25/26 November 25th 2026'),
  post('wwre', 2, fx('wwre-dynamite.html'), 'watchwrestling.re', '2026-11-25', 'AEW Dynamite 11/25/26 – 25th November 2026'),
], {}, DYN - 7_200_000);

test('a link plays on our page when its channel can be framed: the sources\' ad pages and human checks become the player itself', () => {
  assert.equal(L.playable('https://dailypudding.com/category/alpha.php?cache=15y6sumR&minify=sr&live=ch87_HD&meu=86-87'), 'https://www.sawlivenow.com/embed/ch87_HD/');
  assert.equal(L.playable('https://techfunlife.com/Latest_posts/?cache=15y6sumR87h&minify=gloria&line=108087_HD&meu=86-87'), 'https://www.sawlivenow.com/embed/ch87_HD/');
  assert.equal(L.playable('https://www.sawlivenow.com/embed/ch83_HD/'), 'https://www.sawlivenow.com/embed/ch83_HD/');
  assert.equal(L.playable('https://dramavideo.se/watch?v=83218'), 'https://dramavideo.se/watch?v=83218');
  assert.equal(L.playable('https://blog.djt2.com/Aokehg'), null);
  assert.equal(L.playable('https://techfunlife.com/Latest_posts/?line=83_FHD'), null);
  assert.equal(L.playable('https://evil.example/?live=ch87_HD"><script>'), null);
  assert.equal(L.playable('javascript:alert(1)'), null);
});

test('a show\'s servers: one per channel, HD first, the sources\' outside pages only when nothing plays here', () => {
  const s = both()['dynamite-2026-11-25'];
  const sv = L.servers(s);
  assert.equal(sv.length, 7);
  assert.ok(sv.every((v) => !v.x && v.u.startsWith('https://www.sawlivenow.com/embed/ch')));
  assert.equal(new Set(sv.map((v) => v.u)).size, 7);
  assert.deepEqual(sv.map((v) => v.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(sv[0].q, 'HD');
  // only watchwrestling.re (short links that open an ad page): shown, as pages that open elsewhere
  const only = L.servers({ links: s.links.filter((l) => l.s === 2) });
  assert.equal(only.length, 11);
  assert.ok(only.every((v) => v.x === 1));
});

test('the owner\'s hand: name, time, picture, note, full show, servers added first, a source\'s server hidden, a show hidden', () => {
  const auto = both();
  const m: L.Manual = { shows: { 'dynamite-2026-11-25': {
    t: 'داينامايت الليلة', start: DYN + 30 * 60_000, img: '/content/images/x.jpg', note: 'السيرفر 1 الأفضل', vod: '/shows/aew-dynamite-25-11-2026/',
    add: [{ u: 'https://ok.ru/videoembed/1', q: 'FHD', at: 1 }, { u: 'https://example.com/watch', x: 1, at: 2 }],
    block: ['https://dailypudding.com/category/alpha.php?cache=15y6sumR&minify=sr&live=ch87_HD&meu=86-87', 'https://techfunlife.com/Latest_posts/?cache=15y6sumR87h&minify=gloria&line=108087_HD&meu=86-87'],
  } } };
  const eff = L.applyManual(auto, m);
  const d = L.publicData(eff, DYN).shows[0];
  assert.equal(d.t, 'داينامايت الليلة');
  assert.equal(d.start, DYN + 30 * 60_000);
  assert.equal(d.end, auto['dynamite-2026-11-25'].end + 30 * 60_000, 'the end moves with the start');
  assert.equal(d.st, 'soon');
  assert.equal(d.note, 'السيرفر 1 الأفضل'); assert.equal(d.vod, '/shows/aew-dynamite-25-11-2026/'); assert.equal(d.img, '/content/images/x.jpg');
  assert.equal(d.sv[0].u, 'https://ok.ru/videoembed/1'); assert.equal(d.sv[0].m, 1);
  assert.ok(!d.sv.some((v) => v.u === 'https://www.sawlivenow.com/embed/ch87_HD/'), 'a hidden channel stays hidden under both its pages');
  assert.equal(d.sv[d.sv.length - 1].u, 'https://example.com/watch', 'the owner\'s own outside link is kept');
  // the sources' merge is untouched: «رجّعه زي المصادر» is just dropping the owner's entry
  assert.equal(auto['dynamite-2026-11-25'].ar, 'داينامايت');
  // hidden: gone from the site; the whole section off: nothing at all
  assert.equal(L.publicData(L.applyManual(auto, { shows: { 'dynamite-2026-11-25': { hide: 1 } } }), DYN).shows.length, 0);
  assert.equal(L.publicData(eff, DYN, true).shows.length, 0);
});

test('a show the owner adds by hand gets its page address and joins the sources\' show of the same program and date', () => {
  const m: L.Manual = { shows: { 'collision-2026-11-28': { def: { name: 'AEW Collision', fed: 'AEW', prog: 'collision', date: '2026-11-28', ar: 'كوليجن' }, start: DYN + 3 * 86_400_000, add: [{ u: 'https://www.sawlivenow.com/embed/ch86_HD/', at: 1 }] } } };
  const eff = L.applyManual({}, m);
  const s = eff['collision-2026-11-28'];
  assert.equal(s.slug, 'collision-28-11-2026'); assert.equal(s.manual, 1); assert.equal(s.end, s.start + 3 * 3_600_000);
  const d = L.publicData(eff, DYN).shows[0];
  assert.equal(d.k, 'collision-28-11-2026'); assert.equal(d.sv.length, 1); assert.equal(d.p, 'collision'); assert.equal(d.d, '2026-11-28');
  // the sources post the same show later: one show, the sources' with the owner's link on top
  const auto = both();
  const joined = L.applyManual(auto, { shows: { 'dynamite-2026-11-25': { def: { name: 'x', fed: 'AEW', prog: 'dynamite', date: '2026-11-25', ar: 'x' }, start: DYN, add: [{ u: 'https://ok.ru/videoembed/9', at: 1 }] } } });
  assert.equal(Object.keys(joined).length, 1);
  assert.equal(joined['dynamite-2026-11-25'].ar, 'داينامايت');
  assert.equal(L.publicData(joined, DYN - 3_600_000).shows[0].sv[0].u, 'https://ok.ru/videoembed/9');
});

test('/live/data carries the visitor\'s country and zone and the exact time of the answer, never cached with them', async () => {
  const store = new Map<string, string>();
  (globalThis as any).caches = { default: { match: async (r: Request) => (store.has(r.url) ? new Response(store.get(r.url)) : undefined), put: async (r: Request, res: Response) => { store.set(r.url, await res.text()); }, delete: async () => true } };
  const req = new Request('https://x/live/data'); (req as any).cf = { country: 'EG', timezone: 'Africa/Cairo' };
  const r = await L.liveDataResponse({}, { 'Access-Control-Allow-Origin': '*' }, req, DYN);
  const d = await r.json();
  assert.deepEqual(d.geo, { c: 'EG', tz: 'Africa/Cairo' });
  assert.ok(Math.abs(d.t - Date.now()) < 5000);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(![...store.values()][0].includes('Africa/Cairo'), 'the shared edge copy has no visitor in it');
  const bad = new Request('https://x/live/data'); (bad as any).cf = { country: '<x>', timezone: 'a"b' };
  assert.deepEqual((await (await L.liveDataResponse({}, {}, bad, DYN)).json()).geo, { c: '', tz: '' });
});

test('the panel: «الأدوات ← البث المباشر», behind the tools permission, every action the owner asked for', () => {
  const idx = fs.readFileSync('worker/src/index.ts', 'utf8');
  const at = idx.indexOf('if (path.startsWith("/api/studio/tools/")) {');
  assert.ok(at > 0 && idx.indexOf('path === "/api/studio/tools/live"') > at, 'inside the tools-only block');
  const live = fs.readFileSync('worker/src/live.ts', 'utf8');
  for (const a of ['save', 'hide', 'unhide', 'link-add', 'link-move', 'link-del', 'link-restore', 'add-show', 'delete', 'reset', 'image', 'refresh', 'off', 'on', 'host'])
    assert.ok(live.includes(`case "${a}"`), a);
  const app = fs.readFileSync('studio/js/app.js', 'utf8');
  assert.match(app, /href: '#\/tools\/live'/);
  assert.match(app, /live: renderLiveTool/);
  assert.match(fs.readFileSync('studio/js/api.js', 'utf8'), /liveAct: \(body\) => call\('\/api\/studio\/tools\/live'/);
});

test('the search engines: every live page indexable with its broadcast as structured data, a standing page per program, the sitemap, the pings', () => {
  const lay = fs.readFileSync('_includes/live-layout.njk', 'utf8');
  assert.match(lay, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(lay, /"@type":"BroadcastEvent","isLiveBroadcast":true/);
  assert.match(lay, /"@type":"BreadcrumbList"/);
  assert.match(fs.readFileSync('pages/live-program.njk', 'utf8'), /permalink: "\/live\/\{\{ liveProg\.key \}\}\/index\.html"/);
  const progs = require_programs();
  const fast = fs.readFileSync('site-worker/fast.js', 'utf8');
  for (const p of progs) assert.ok(fast.includes(`"${p.key}"`), `fast.js knows /live/${p.key}/`);
  const map = fs.readFileSync('pages/sitemap.njk', 'utf8');
  assert.match(map, /\/live\/\{\{ p\.key \}\}\//); assert.match(map, /\/live\/\{\{ l\.key \}\}\//);
  assert.match(fs.readFileSync('scripts/seo-new-shows.ts', 'utf8'), /\(shows\|recaps\|nostalgia\|library\|live\)/);
});
function require_programs(): { key: string }[] {
  const src = fs.readFileSync('_data/livePrograms.js', 'utf8');
  return [...src.matchAll(/key: "([a-z0-9-]+)"/g)].map((m) => ({ key: m[1] }));
}

test('the home page tells of the section; the live page links the full show once it is out', () => {
  const home = fs.readFileSync('index.njk', 'utf8');
  assert.match(home, /<a class="lvs" id="lvStrip" href="\/live\/">/);
  assert.match(home, /<script src="\/assets\/live-strip\.js\?v=\d+" defer><\/script>/);
  const js = fs.readFileSync('assets/live.js', 'utf8');
  assert.match(js, /var RECENT = '\/live\/recent\.json';/);
  assert.match(js, /نُشر العرض كاملًا/);
  assert.ok(!js.includes('غدًا'), 'never «غدًا»: «الليلة» or the day by name');
  assert.match(fs.readFileSync('pages/live-recent.njk', 'utf8'), /permalink: "\/live\/recent\.json"/);
});
