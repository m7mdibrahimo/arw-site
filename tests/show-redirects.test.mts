import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vanishedShowRedirects } from '../lib/redirects.cjs';

// INCIDENTS #961: a show's title edited three times in its first minutes went to Google under an in-between address that then 404'd
test('an in-between show address Google was sent redirects to the show it became', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'show-redir-'));
  const site = path.join(dir, '_site');
  const content = path.join(dir, 'content');
  const page = (p: string) => { fs.mkdirSync(path.join(site, p), { recursive: true }); fs.writeFileSync(path.join(site, p, 'index.html'), '<html></html>'); };
  fs.mkdirSync(path.join(content, 'shows'), { recursive: true });
  fs.mkdirSync(path.join(content, 'recaps'), { recursive: true });
  fs.writeFileSync(path.join(content, 'shows', '20261029093918-mlp-special-josh-alexander-vs-stu-grayson-northern-rising-22-10-2026.md'), '---\ntitle: "MLP Special: Josh Alexander vs Stu Grayson 21.10.2026"\n---\n');
  fs.writeFileSync(path.join(content, 'shows', '20261029094308-mlp-special-rohan-vs-andrade-priscilla-kelly-vs-storm-28-10-2026.md'), '---\ntitle: "MLP Special: Rohan vs. Andrade / Priscilla Kelly vs. Storm 28.10.2026"\n---\n');
  page('shows/mlp-special-josh-alexander-vs-stu-grayson-21-10-2026');
  page('en/shows/mlp-special-josh-alexander-vs-stu-grayson-21-10-2026');
  page('shows/mlp-special-rohan-vs-andrade-priscilla-kelly-vs-storm-28-10-2026');
  const seo = path.join(dir, 'new-shows.json');
  fs.writeFileSync(seo, JSON.stringify({ pages: {
    'https://arab-wrestling.com/shows/mlp-special-josh-alexander-vs-stu-grayson-northern-rising-21-10-2026/': {},
    'https://arab-wrestling.com/shows/mlp-special-rohan-vs-andrade-priscilla-kelly-vs-storm-28-10-2026/': {},
    'https://arab-wrestling.com/shows/mlp-special-someone-else-21-10-2026/': {},
  } }));
  const redirects = path.join(dir, '_redirects');
  fs.writeFileSync(redirects, '');
  assert.deepEqual(vanishedShowRedirects(site, seo, redirects, content), [
    ['/shows/mlp-special-josh-alexander-vs-stu-grayson-northern-rising-21-10-2026/', '/shows/mlp-special-josh-alexander-vs-stu-grayson-21-10-2026/'],
    ['/en/shows/mlp-special-josh-alexander-vs-stu-grayson-northern-rising-21-10-2026/', '/en/shows/mlp-special-josh-alexander-vs-stu-grayson-21-10-2026/'],
  ]);
  // the moves are written as stub pages AND as real 301s in _redirects (INCIDENTS #1218: Google kept the old address as canonical)
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  assert.match(cfg, /const showMoves = require\("\.\/lib\/redirects\.cjs"\)\.vanishedShowRedirects\(\);/);
  assert.match(cfg, /toPagesRedirects\([^\n]*\[\.\.\.showMoves, \.\.\.renamedArticleRedirects\(\)\]/);
  assert.match(cfg, /writeRedirectPages\(showMoves, "_site"\)/);
});

// INCIDENTS #961: a show renamed after it went live redirected from its Arabic file-name address, but its English copy 404'd
test('a renamed show redirects from its English file-name address too', async () => {
  const { contentFolderAddresses } = await import('../lib/redirects.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'show-redir-en-'));
  const site = path.join(dir, '_site');
  const content = path.join(dir, 'content');
  fs.mkdirSync(path.join(content, 'shows'), { recursive: true });
  fs.writeFileSync(path.join(content, 'shows', 'roh-01-10-2026.md'), '---\ntitle: "ROH on HonorClub 01.10.2026"\n---\n');
  for (const p of ['shows/roh-on-honorclub-01-10-2026', 'en/shows/roh-on-honorclub-01-10-2026']) { fs.mkdirSync(path.join(site, p), { recursive: true }); fs.writeFileSync(path.join(site, p, 'index.html'), 'x'); }
  assert.deepEqual(contentFolderAddresses(content, site).filter(([from]) => !from.startsWith('/content/')), [
    ['/shows/roh-01-10-2026/', '/shows/roh-on-honorclub-01-10-2026/'],
    ['/en/shows/roh-01-10-2026/', '/en/shows/roh-on-honorclub-01-10-2026/'],
  ]);
});

// INCIDENTS #1137: nostalgia pages whose title year was corrected (2019 → 2021) 404'd at the address Google had
test('a nostalgia page whose year was corrected redirects from the old address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nost-redir-'));
  const site = path.join(dir, '_site');
  const content = path.join(dir, 'content');
  const page = (p: string) => { fs.mkdirSync(path.join(site, p), { recursive: true }); fs.writeFileSync(path.join(site, p, 'index.html'), '<html></html>'); };
  fs.mkdirSync(path.join(content, 'nostalgia'), { recursive: true });
  fs.writeFileSync(path.join(content, 'nostalgia', '20261017211649-aew-dynamite-04-08-2019.md'), '---\ntitle: AEW Dynamite 04.08.2021\n---\n');
  fs.writeFileSync(path.join(content, 'nostalgia', '20261017215234-aew-dynamite-11-08-2019.md'), '---\ntitle: AEW Dynamite 11.08.2021\n---\n');
  page('nostalgia/aew-dynamite-04-08-2021');
  page('nostalgia/aew-dynamite-11-08-2021');
  const seo = path.join(dir, 'new-shows.json');
  fs.writeFileSync(seo, JSON.stringify({ pages: {
    'https://arab-wrestling.com/nostalgia/aew-dynamite-04-08-2019/': {},
    'https://arab-wrestling.com/nostalgia/aew-dynamite-11-08-2019/': {},
    'https://arab-wrestling.com/nostalgia/aew-dynamite-11-08-2021/': {},
  } }));
  const redirects = path.join(dir, '_redirects');
  fs.writeFileSync(redirects, '');
  assert.deepEqual(vanishedShowRedirects(site, seo, redirects, content), [
    ['/nostalgia/aew-dynamite-04-08-2019/', '/nostalgia/aew-dynamite-04-08-2021/'],
    ['/nostalgia/aew-dynamite-11-08-2019/', '/nostalgia/aew-dynamite-11-08-2021/'],
  ]);
});

// INCIDENTS #1152: «GCW The Score 26.09.2026» renamed «GCW The Score (2026)» in the panel — the old dated address 404'd,
// because neither the file name (…-gcw-the-score-2026.md) nor the new address had «26-09». The event date now counts.
test('a show renamed to its year redirects from its old dated address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'show-redir-date-'));
  const site = path.join(dir, '_site');
  const content = path.join(dir, 'content');
  fs.mkdirSync(path.join(content, 'shows'), { recursive: true });
  fs.writeFileSync(path.join(content, 'shows', '20260927170600-gcw-the-score-2026.md'), '---\ntitle: GCW The Score (2026)\nevent_date: 2026-09-26\n---\n');
  fs.writeFileSync(path.join(content, 'shows', '20260927052200-gcw-rock-bottom-2026.md'), '---\ntitle: GCW Rock Bottom (2026)\nevent_date: 2026-09-25\n---\n');
  for (const p of ['shows/gcw-the-score-2026', 'shows/gcw-rock-bottom-2026']) { fs.mkdirSync(path.join(site, p), { recursive: true }); fs.writeFileSync(path.join(site, p, 'index.html'), '<html></html>'); }
  const seo = path.join(dir, 'new-shows.json');
  fs.writeFileSync(seo, JSON.stringify({ pages: {
    'https://arab-wrestling.com/shows/gcw-the-score-26-09-2026/': {},
    'https://arab-wrestling.com/shows/gcw-rock-bottom-25-09-2026/': {},
    'https://arab-wrestling.com/shows/gcw-rock-bottom-26-09-2026/': {},
  } }));
  const redirects = path.join(dir, '_redirects');
  fs.writeFileSync(redirects, '');
  assert.deepEqual(vanishedShowRedirects(site, seo, redirects, content), [
    ['/shows/gcw-the-score-26-09-2026/', '/shows/gcw-the-score-2026/'],
    ['/shows/gcw-rock-bottom-25-09-2026/', '/shows/gcw-rock-bottom-2026/'],
  ]);
});

// INCIDENTS #1218: old tag page numbers had filled _redirects to 1,982 rules, so renamed shows got only a noindex stub
// and Google kept the old GCW Rock Bottom address as the canonical. Moves keep their room; extra page numbers become stubs.
test('renamed show moves keep room in _redirects; tag page numbers that do not fit become redirect pages', async () => {
  const { toPagesRedirects } = await import('../lib/redirects.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redir-room-'));
  const site = path.join(dir, '_site');
  for (let n = 2; n <= 1950; n++) fs.mkdirSync(path.join(site, 'tag', 'b', String(n)), { recursive: true });
  const moves = Array.from({ length: 10 }, (_, i) => [`/shows/old-${i}/`, `/shows/new-${i}/`]);
  const tooLong: string[][] = [];
  const out = toPagesRedirects('/tag/a/* /tag/b/:splat 301\n/tag/a/* /tag/b/:splat 301\n', site, moves, tooLong).trim().split('\n');
  for (const [from, to] of moves) assert.ok(out.includes(`${from} ${to} 301`), from);
  assert.ok(out.filter((l) => !/[*:]/.test(l.split(' ')[0])).length <= 2000);
  assert.ok(tooLong.some(([from]) => /^\/tag\/a\/\d+\/$/.test(from)), 'page numbers that did not fit become stub pages');
});
