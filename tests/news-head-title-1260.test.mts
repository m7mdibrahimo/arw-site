import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { datedTonightTitle } = createRequire(import.meta.url)('../lib/news-head-title.cjs');

// INCIDENTS #1260: every week's «دليل مشاهدة عرض TNA iMPACT الليلة» had almost the same <title>; the new one was
// «crawled, not indexed». The head title now carries the night's date.
test('a «الليلة» headline with no date gets the American night\'s date in the head title', () => {
  assert.equal(datedTonightTitle('تفاصيل وموعد انطلاق ودليل مشاهدة عرض TNA iMPACT الليلة', new Date('2026-11-12T16:00:00+03:00')), 'تفاصيل وموعد انطلاق ودليل مشاهدة عرض TNA iMPACT الليلة 12 نوفمبر 2026');
  // 02:00 in Cairo is still the previous evening in New York
  assert.equal(datedTonightTitle('دليل مشاهدة عرض AEW Dynamite الليلة', new Date('2026-11-12T02:00:00+03:00')), 'دليل مشاهدة عرض AEW Dynamite الليلة 11 نوفمبر 2026');
});

test('titles with a date, or without «الليلة», stay as they are', () => {
  for (const t of ['دليل مشاهدة عرض TNA iMPACT الليلة 5 نوفمبر', 'عرض WWE Survivor Series 2026 الليلة', 'كودي رودز يسعى للحصول على دور إداري', 'الليلي والنهاري']) assert.equal(datedTonightTitle(t, new Date('2026-11-12T16:00:00+03:00')), t);
});
