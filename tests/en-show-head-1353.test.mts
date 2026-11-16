import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPageMap } = require('../lib/i18n/content.cjs');
const mirror = require('../lib/i18n/mirror.cjs');
const render = require('dom-serializer').default;

// INCIDENTS #1353: the English Crown Jewel page's head said «WWE Crown Jewel (2026) (November 7, 2026)» and its
// description had no «download» next to «full show» («wwe crown jewel 2026 full show download» sat at 23).
test('a yearly show’s English head drops the year’s brackets next to the written date and says «download»', () => {
  const pages = buildPageMap({ items: [
    { url: '/shows/wwe-crown-jewel-2026/', inputPath: 'content/shows/x.md', data: { title: 'WWE Crown Jewel (2026)', event_date: '2026-11-07' } },
    { url: '/shows/wwe-raw-26-10-2026/', inputPath: 'content/shows/y.md', data: { title: 'WWE RAW 26.10.2026', event_date: '2026-10-26' } },
  ] });
  const cj = pages['/shows/wwe-crown-jewel-2026/'];
  assert.equal(cj.title, 'WWE Crown Jewel (2026)', 'the plain name on the page is untouched');
  assert.equal(cj.seoTitle, 'WWE Crown Jewel 2026 (November 7, 2026) — Full Show');
  assert.ok(!/\)\s*\(/.test(cj.description), 'no two brackets in a row');
  assert.match(cj.description, /^Watch, stream and download WWE Crown Jewel 2026 \(November 7, 2026\) online: the full show/);
  assert.equal(pages['/shows/wwe-raw-26-10-2026/'].seoTitle, 'WWE RAW October 26, 2026 — Full Show');
});

// INCIDENTS #1353: several Arabic spellings became the same English alternate name (five «WWE Crown Jewel»,
// «wwe Crown Jewel 2026» beside «WWE Crown Jewel 2026»).
test('the English structured data lists each alternate name once, capitalised', () => {
  const html =
    '<!doctype html><html lang="ar" dir="rtl"><head><title>عرض</title>' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Crown Jewel",' +
    '"alternateName":["WWE Crown Jewel","WWE Crown Jewel","wwe Crown Jewel 2026","كراون جول","WWE Crown Jewel 2026","Crown Jewel","aew Full Gear"]}</script>' +
    '</head><body></body></html>';
  const tr = mirror.makeTranslator({ ui: {}, patterns: [] }, {});
  const doc = mirror.translatePage(html, { url: '/shows/wwe-crown-jewel-2026/', tr, english: new Map(), pages: {} });
  const out = render(doc, { encodeEntities: 'utf8', decodeEntities: true });
  const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.deepEqual(ld.alternateName, ['WWE Crown Jewel', 'WWE Crown Jewel 2026', 'Crown Jewel', 'AEW Full Gear']);
});
