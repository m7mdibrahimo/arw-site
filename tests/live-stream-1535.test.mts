// «بث مباشر» (worker/src/live.ts, INCIDENTS #1535): live wrestling streams gathered from 1max.top, watchwrestling.re/.ae and
// watchwrestlingtv.se. The fixtures are the sources' real pages of 2026-11-24/25 (AEW Dynamite, WWE NXT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../worker/src/live.ts';

const fx = (f: string) => fs.readFileSync(`tests/fixtures/live/${f}`, 'utf8');
const DYN = Date.UTC(2026, 10, 26, 1, 0); // AEW Dynamite 25.11.2026, 8 PM Eastern

test('a post title names its show: program and US date, PLEs before the weekly shows, UFC and stories left out', () => {
  assert.equal(L.identify('AEW Dynamite Live 11/25/26 November 25th 2026')?.key, 'dynamite-2026-11-25');
  assert.equal(L.identify('AEW Dynamite 11/25/26 – 25th November 2026')?.key, 'dynamite-2026-11-25');
  assert.equal(L.identify('WWE NxT 11/24/26 – 24th November 2026 2026 Full Show')?.key, 'nxt-2026-11-24');
  assert.equal(L.identify('AEW Full Gear 2026 PPV 2026 11/14/26 – 14th November 2026')?.key, 'full-gear-2026-11-14');
  assert.equal(L.identify('NXT Deadline 2026 12/6/26 – 6th December 2026')?.key, 'nxt-deadline-2026-12-06');
  assert.equal(L.identify('TNA Impact Wrestling 11/19/26 – 19th November 2026')?.key, 'tna-2026-11-19');
  assert.equal(L.identify('UFC Fight Night Prochazka vs. Stirling 11/21/26 – 21st November 2026'), null);
  assert.equal(L.identify('WWE Raw Results 11/23/26'), null);
  assert.equal(L.identify('WWE Raw 11/23/26')?.program.ar, 'الرو');
});

test('the start time: the sources\' own countdown (Eastern, with summer time), else «8:00PM ET» in the text, else the usual 8 PM', () => {
  assert.deepEqual(L.findStart(L.postBody(fx('1max-dynamite.html')), '2026-11-25'), { at: DYN, how: 'countdown' });
  assert.deepEqual(L.findStart(L.postBody(fx('wwre-dynamite.html')), '2026-11-25'), { at: DYN, how: 'countdown' });
  assert.deepEqual(L.findStart(L.postBody(fx('wwae-nxt.html')), '2026-11-24'), { at: Date.UTC(2026, 10, 25, 1, 0), how: 'text' });
  assert.equal(L.findStart(L.postBody(fx('wwtv-nxt.html')), '2026-11-24'), null);
  // summer: 8 PM EDT is 00:00 UTC
  assert.equal(L.zoned(2026, 7, 15, 20, 0, 'America/New_York'), Date.UTC(2026, 6, 16, 0, 0));
  assert.equal(L.usualStart(L.identify('WWE NxT 11/24/26')!.program, '2026-11-24')?.at, Date.UTC(2026, 10, 25, 1, 0));
  assert.equal(L.usualStart(L.identify('AEW Full Gear 2026 PPV 11/14/26')!.program, '2026-11-14'), null, 'an event has no usual time');
});

test('the live links of each source: streams and catch-ups, hidden base64 links, an embedded player; never parts, replays or the countdown', () => {
  const max = L.extractLinks(fx('1max-dynamite.html'), '1max.top');
  assert.equal(max.length, 14);
  assert.ok(max.every((l) => /^https:\/\/(techfunlife|dailypudding)\.com\//.test(l.url)));
  assert.ok(!max.some((l) => /timeanddate|habman/.test(l.url)));
  assert.deepEqual([...new Set(max.map((l) => l.q))].sort(), ['FHD', 'HD', 'LQ', 'SD']);
  const re = L.extractLinks(fx('wwre-dynamite.html'), 'watchwrestling.re');
  assert.equal(re.length, 11, 'one of the twelve buttons repeats a link');
  assert.equal(re[0].url, 'https://blog.djt2.com/Aokehg');
  assert.equal(re[0].q, 'HD');
  // after the show watchwrestling.ae has only the full show in parts: nothing live
  assert.equal(L.extractLinks(fx('wwae-nxt.html'), 'watchwrestling.ae').length, 0);
  const tv = L.extractLinks(fx('wwtv-nxt.html'), 'watchwrestlingtv.se');
  assert.deepEqual(tv.map((l) => [l.url, l.embed]), [['https://dramavideo.se/watch?v=83218', true]]);
  assert.equal(L.unhide('WVVoU01HTklUVFpNZVRscFlrYzVia3h0VW5Ga1JFbDFXVEk1ZEV3d1JuWmhNbFp2V25jOVBRPT0='), 'https://blog.djt2.com/Aokehg');
});

const post = (src: string, id: number, html: string, host: string, date: string, title: string): L.PostState => ({
  src, id, url: `https://${host}/p${id}/`, title, mod: 'x', key: L.identify(title)!.key, date, seenAt: 0, readAt: 0,
  start: L.findStart(L.postBody(html), date), links: L.extractLinks(html, host), img: L.ogImage(html),
});

test('the same show on two sources is ONE show with both sources\' links, numbered by source, the episode\'s own picture', () => {
  const a = post('1max', 1, fx('1max-dynamite.html'), '1max.top', '2026-11-25', 'AEW Dynamite Live 11/25/26 November 25th 2026');
  const b = post('wwre', 2, fx('wwre-dynamite.html'), 'watchwrestling.re', '2026-11-25', 'AEW Dynamite 11/25/26 – 25th November 2026');
  const now = DYN - 3_600_000;
  const shows = L.mergeShows([b, a], {}, now);
  assert.deepEqual(Object.keys(shows), ['dynamite-2026-11-25']);
  const s = shows['dynamite-2026-11-25'];
  assert.equal(s.slug, 'dynamite-25-11-2026');
  assert.equal(s.start, DYN);
  assert.equal(s.end, DYN + 150 * 60_000);
  assert.equal(s.links.length, 25);
  assert.deepEqual([...new Set(s.links.map((l) => l.s))], [1, 2]);
  assert.match(s.srcImg!, /uploads\/2026\/11\//);
  // a link seen before keeps when it was first seen; a new source comes after the ones already shown
  const later = L.mergeShows([a, b], shows, now + 60_000);
  assert.equal(later['dynamite-2026-11-25'].links[0].at, now);
  assert.deepEqual(later['dynamite-2026-11-25'].srcs, s.srcs);
});

test('/live/data: the servers from the moment a source has them (owner: «مش مخفية لحد ما يشتغل العرض»), none after the end, nothing a day later', () => {
  const a = post('1max', 1, fx('1max-dynamite.html'), '1max.top', '2026-11-25', 'AEW Dynamite Live 11/25/26 November 25th 2026');
  const shows = L.mergeShows([a], {}, DYN - 7_200_000);
  const early = L.publicData(shows, DYN - 3_600_000).shows[0];
  assert.equal(early.st, 'soon'); assert.equal(early.sv.length, 7); assert.equal(early.n, 7); assert.equal(early.srcs, 1);
  assert.equal(early.t, 'عرض داينامايت', '«عرض» before the name (owner 2026-11-25)');
  assert.equal(L.publicData(shows, DYN + 60_000).shows[0].st, 'live');
  const ended = L.publicData(shows, DYN + 3 * 3_600_000).shows[0];
  assert.equal(ended.st, 'ended'); assert.equal(ended.sv.length, 0);
  assert.equal(L.publicData(shows, DYN + 10 * 3_600_000).shows.length, 0);
});

test('a page is read when it changed, every two minutes around the show, rarely otherwise, never after the end', () => {
  const show = { start: DYN, end: DYN + 9_000_000 } as L.Show;
  const p = { readAt: DYN - 3_600_000 } as L.PostState;
  assert.equal(L.wantsRead(p, show, DYN - 3_600_000 + 60_000, true), true);
  assert.equal(L.wantsRead(p, show, DYN - 3_600_000 + 5 * 60_000, false), false);
  assert.equal(L.wantsRead({ readAt: DYN - 3 * 60_000 } as L.PostState, show, DYN, false), true);
  assert.equal(L.wantsRead({ readAt: DYN - 60_000 } as L.PostState, show, DYN, false), false);
  assert.equal(L.wantsRead({ readAt: 0 } as L.PostState, show, DYN + 9_000_001, false), false);
});

test('a source that moved: the redirect is followed, the old domain\'s page points to the new one, a sweep checks the WordPress name', async () => {
  assert.deepEqual(L.movedHints('<meta http-equiv="refresh" content="0;url=https://watchwrestling.to/">', 'watchwrestling'), ['watchwrestling.to']);
  assert.deepEqual(L.movedHints('<script>location.href="https://1max.cc/"</script><a href="https://google.com">', '1max'), ['1max.cc']);
  assert.equal(L.sameSite({ name: 'Watch Wrestling', desc: 'Watch WWE | WWE Raw | Smackdown Live' }, { name: 'Watch Wrestling', desc: 'Watch WWE | WWE Raw | Smackdown Live' }), true);
  assert.equal(L.sameSite({ name: 'Watch Wrestling', desc: 'Watch WWE | WWE Raw | Smackdown Live' }, { name: 'Watch Wrestling', desc: 'WWE RAW | WWE Smackdown | WWE NxT' }), false, 'two sites with the same name are told apart');

  const real = globalThis.fetch;
  const list = JSON.stringify([{ id: 9, link: 'https://watchwrestling.to/x/', title: { rendered: 'WWE Raw 11/30/26' }, modified_gmt: 'm' }]);
  try {
    // the old domain answers nothing; its landing page redirects to the new one
    (globalThis as any).fetch = async (u: string) => {
      const url = String(u);
      if (url.startsWith('https://watchwrestling.ae/wp-json/wp/v2/posts')) return new Response('', { status: 521 });
      if (url === 'https://watchwrestling.ae/') { const r = new Response('<html></html>', { status: 200 }); Object.defineProperty(r, 'url', { value: 'https://watchwrestling.to/' }); return r; }
      if (url.startsWith('https://watchwrestling.to/wp-json/wp/v2/posts')) { const r = new Response(list, { status: 200 }); Object.defineProperty(r, 'url', { value: url }); return r; }
      if (url.startsWith('https://watchwrestling.to/wp-json/?')) return new Response(JSON.stringify({ name: 'Watch Wrestling', description: 'Watch WWE | WWE Raw | Smackdown Live' }));
      return new Response('', { status: 404 });
    };
    const st: L.SourceState = { id: 'wwae', host: 'watchwrestling.ae', fp: { name: 'Watch Wrestling', desc: 'Watch WWE | WWE Raw | Smackdown Live' }, fpAt: Date.now() };
    const got = await L.listSource(L.SOURCES.find((s) => s.id === 'wwae')!, st, Date.now(), new Set(['watchwrestling.re']));
    assert.equal(st.host, 'watchwrestling.to');
    assert.equal(st.movedFrom, 'watchwrestling.ae');
    assert.equal(got.posts.length, 1);

    // nothing points anywhere: after five failed minutes the same name is tried under other endings
    (globalThis as any).fetch = async (u: string) => {
      const url = String(u);
      if (url.startsWith('https://watchwrestlingtv.ch/wp-json/?')) return new Response(JSON.stringify({ name: 'Watch Wrestling', description: '' }));
      if (url.startsWith('https://watchwrestlingtv.ch/wp-json/wp/v2/posts')) { const r = new Response(list, { status: 200 }); Object.defineProperty(r, 'url', { value: url }); return r; }
      throw new Error('dns');
    };
    const st2: L.SourceState = { id: 'wwtv', host: 'watchwrestlingtv.se', fails: 4, fp: { name: 'Watch Wrestling', desc: '' }, fpAt: Date.now() };
    await L.listSource(L.SOURCES.find((s) => s.id === 'wwtv')!, st2, Date.now(), new Set());
    assert.equal(st2.host, 'watchwrestlingtv.ch');
    assert.equal(st2.movedFrom, 'watchwrestlingtv.se');
  } finally { globalThis.fetch = real; }
});

test('a show\'s page file: front matter only, with the start and end the page counts to', () => {
  const s = { slug: 'dynamite-25-11-2026', ar: 'داينامايت', name: 'AEW Dynamite', fed: 'AEW', date: '2026-11-25', start: DYN, end: DYN + 9_000_000, img: '/content/images/live-dynamite-25-11-2026.jpg' } as L.Show;
  const f = L.pageFile(s);
  assert.match(f, /^---\ntitle: "بث مباشر عرض داينامايت"\nlive_key: "dynamite-25-11-2026"\n/);
  assert.match(f, /start: "2026-11-26T01:00:00.000Z"/);
  assert.match(f, /image: "\/content\/images\/live-dynamite-25-11-2026.jpg"\n---\n$/);
});

test('wiring: the bot polls every minute and serves /live/data; the site serves a new show\'s address at once; the menu links the section', () => {
  const idx = fs.readFileSync('worker/src/index.ts', 'utf8');
  assert.match(idx, /path === "\/live\/data" && request\.method === "GET"\) return liveDataResponse/);
  assert.match(idx, /runLive\(env as any, _controller\.scheduledTime, liveDeps\(env\)\)/);
  const fast = fs.readFileSync('site-worker/fast.js', 'utf8');
  assert.match(fast, /\/\^\\\/live\\\/\[a-z0-9-\]\{3,80\}\\\/\?\$\/\.test\(lp\)/);
  for (const f of ['index.njk', 'pages/shows.njk', 'pages/news.njk', '_includes/post-layout.njk', '_includes/live-layout.njk'])
    assert.match(fs.readFileSync(f, 'utf8'), /<a class="navlink nav-live( active)?" href="\/live\/">بث مباشر<\/a>/, f);
  // no light beside it in the menu (owner 2026-11-25)
  assert.doesNotMatch(fs.readFileSync('assets/features.css', 'utf8'), /nav-live::before/);
  assert.match(fs.readFileSync('assets/live.js', 'utf8'), /arw-site-bot\.m7mdibrahimpc\.workers\.dev\/live\/data/);
  // the section's page answering for a new show's address turns into that show's page
  assert.match(fs.readFileSync('assets/live.js', 'utf8'), /if \(isShow && !document\.getElementById\('lvShow'\)\) root\.innerHTML = '<div id="lvShow"><\/div>/);
});
