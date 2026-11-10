import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { showSeoText } = require('../lib/show-seo.cjs');

// INCIDENTS #1193: a yearly event's generic description ended with «مع كل النزالات» (no one's search) instead of the category.
test('#1193: a special event description names «عروض المصارعة الحرة»', () => {
  const gcw = showSeoText({ headline: 'عرض جي سي دبليو ذا كروس رودز 07.11.2026 مترجم', title: 'GCW The Crossroads 2026', programName: 'GCW', eventDate: '2026-11-07', day: '7 نوفمبر 2026', isLatest: true, description: 'عرض جي سي دبليو ذا كروس رودز بالكامل مع جميع النزالات والأحداث.' });
  assert.match(gcw.description, /من عروض المصارعة الحرة المترجمة مع روابط المشاهدة والتحميل\.$/);
  assert.doesNotMatch(gcw.description, /مع كل النزالات/);
});

test('#1193: an MMA special keeps the MMA category', () => {
  const ufc = showSeoText({ headline: 'عرض يو اف سي 332 مين كارد', title: 'UFC 332: Silva vs Wang (Main Card)', programName: 'UFC', eventDate: '2026-10-03', day: '3 أكتوبر 2026', isLatest: false });
  assert.doesNotMatch(ufc.description, /المصارعة الحرة/);
});
