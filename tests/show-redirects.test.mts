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
  assert.match(fs.readFileSync('eleventy.config.js', 'utf8'), /writeRedirectPages\(require\("\.\/lib\/redirects\.cjs"\)\.vanishedShowRedirects\(\), "_site"\)/);
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
