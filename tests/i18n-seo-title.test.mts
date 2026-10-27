import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPageMap } = require('../lib/i18n/content.cjs');
const mirror = require('../lib/i18n/mirror.cjs');
const render = require('dom-serializer').default;

// An English visitor searches «WWE RAW October 26 2026 full show», not «26.10.2026»: the English page's <title>
// carried only the dotted date (INCIDENTS #868). Head only — structured data and the card keep the plain name.
const ITEMS = [
  { url: '/shows/wwe-raw-26-10-2026/', inputPath: 'content/shows/wwe-raw.md', data: { title: 'WWE RAW 26.10.2026', event_date: '2026-10-26' } },
  { url: '/recaps/wwe-raw-26-10-2026/', inputPath: 'content/recaps/wwe-raw.md', data: { title: 'WWE RAW 26.10.2026', event_date: '2026-10-26' } },
  { url: '/nostalgia/wwf-raw-05-01-1998/', inputPath: 'content/nostalgia/wwf-raw.md', data: { title: 'WWF Raw 05.01.1998', event_date: '1998-01-05' } },
];

test('a show page map carries an English search title with the written date and «Full Show»', () => {
  const pages = buildPageMap({ items: ITEMS });
  const show = pages['/shows/wwe-raw-26-10-2026/'];
  assert.equal(show.title, 'WWE RAW 26.10.2026');
  assert.equal(show.seoTitle, 'WWE RAW October 26, 2026 — Full Show');
  const recap = pages['/recaps/wwe-raw-26-10-2026/'];
  assert.equal(recap.seoTitle, 'WWE RAW October 26, 2026', 'a recap gets no «Full Show» suffix');
  const nost = pages['/nostalgia/wwf-raw-05-01-1998/'];
  assert.equal(nost.seoTitle, 'WWF RAW January 5, 1998 — Full Episode');
  assert.ok(!/Full Show|Full Episode/.test(show.title), 'the plain name stays plain for the card and structured data');
});

test('the English page uses the search title only in the head, not in structured data', () => {
  const pages = buildPageMap({ items: ITEMS });
  const url = '/shows/wwe-raw-26-10-2026/';
  const html =
    '<!doctype html><html lang="ar" dir="rtl"><head><title>عرض الرو 26.10.2026</title>' +
    '<meta property="og:title" content="عرض الرو 26.10.2026">' +
    '<meta property="og:image:alt" content="عرض الرو 26.10.2026">' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"عرض الرو 26.10.2026"}</script>' +
    '</head><body><h1>عرض الرو 26.10.2026</h1></body></html>';
  const pdf = { ui: {}, patterns: [] };
  const tr = mirror.makeTranslator(pdf, {});
  const doc = mirror.translatePage(html, { url, tr, english: new Map(), pages });
  // same serialization as the build (lib/i18n/mirror.cjs), then its numeric-entity decode
  const out = render(doc, { encodeEntities: 'utf8', decodeEntities: true }).replace(/&#x([0-9a-fA-F]+);/g, (w: string, h: string) =>
    parseInt(h, 16) >= 0xa0 ? String.fromCodePoint(parseInt(h, 16)) : w,
  );
  assert.match(out, /<title>WWE RAW October 26, 2026 — Full Show \| Arab Wrestling<\/title>/);
  assert.match(out, /og:title" content="WWE RAW October 26, 2026 — Full Show"/);
  assert.match(out, /og:image:alt" content="WWE RAW 26\.10\.2026"/, 'an image alt keeps the plain name');
  assert.match(out, /"name":"WWE RAW 26\.10\.2026"/, 'structured data keeps the plain name');
  assert.ok(!/Full Show/.test(out.replace(/<title>[\s\S]*?<\/title>/, '').replace(/og:title[^>]*>/g, '')), 'no «Full Show» outside the title');
});
