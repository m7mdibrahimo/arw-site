// INCIDENTS #1293: GCW Dead On Arrival (2026) had «Dead On Arrival 2026» but never «عرض ديد اون ارايفال 2026» in its
// structured data. A one-off event with a year gets its Arabic name with the year; weekly episodes don't.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { showNameForms } = createRequire(import.meta.url)('../lib/show-seo.cjs');

test('a one-off event carries its Arabic name with the year', () => {
  const f = showNameForms({ headline: 'عرض جي سي دبليو ديد اون ارايفال 06.11.2026', title: 'GCW Dead On Arrival (2026)', programName: 'GCW', eventDate: '2026-11-06', isShow: true });
  for (const n of ['عرض ديد اون ارايفال 2026', 'عرض ديد اون ارايفال 2026 مترجم', 'ديد اون ارايفال 2026']) assert.ok(f.includes(n), n);
});

test('a weekly episode does not claim the program name with the year this way', () => {
  const f = showNameForms({ headline: 'عرض سي ام ال ال مارتيس بوبيولاريس 10.11.2026', title: 'CMLL Martes Populares 10.11.2026', programName: 'CMLL Martes Populares', eventDate: '2026-11-10', isShow: true });
  assert.ok(!f.includes('مشاهدة عرض مارتيس بوبيولاريس 2026'));
});
