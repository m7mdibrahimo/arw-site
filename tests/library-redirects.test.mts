import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vanishedLibraryRedirects } from '../lib/redirects.cjs';

// INCIDENTS #951: a show moved to another program in the panel left its old library page (already sent to Google) a 404
test('a library page that vanished redirects to the library its show is listed in now', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-redir-'));
  const site = path.join(dir, '_site');
  const page = (p: string, html = '<html></html>') => { fs.mkdirSync(path.join(site, p), { recursive: true }); fs.writeFileSync(path.join(site, p, 'index.html'), html); };
  page('shows/cmll-dia-de-muertos-puebla-26-10-2026', '<a href="/library/">x</a><a href="/library/cmll-lunes-clasico/">y</a>');
  page('library/cmll-lunes-clasico');
  page('library/wwe-raw');
  page('shows/wwe-raw-26-10-2026', '<a href="/library/wwe-raw/">y</a>');
  page('shows/njpw-sj-day-3-26-10-2026');
  const seo = path.join(dir, 'new-shows.json');
  fs.writeFileSync(seo, JSON.stringify({ pages: {
    'https://arab-wrestling.com/library/cmll-dia-de-muertos-puebla/': {},
    'https://arab-wrestling.com/library/wwe-raw/': {},
    'https://arab-wrestling.com/library/njpw/': {},
    'https://arab-wrestling.com/library/njpw-sj-day-3/': {},
  } }));
  const redirects = path.join(dir, '_redirects');
  fs.writeFileSync(redirects, '/library/njpw-sj-day-3/ /federation/njpw/ 301!\n');
  assert.deepEqual(vanishedLibraryRedirects(site, seo, redirects), [['/library/cmll-dia-de-muertos-puebla/', '/library/cmll-lunes-clasico/']]);
  // _redirects is full (2,000 static rules), so the build writes them as redirect pages
  assert.match(fs.readFileSync('eleventy.config.js', 'utf8'), /writeRedirectPages\(vanishedLibraryRedirects\(\), "_site"\)/);
});
