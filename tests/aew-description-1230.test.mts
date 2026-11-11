// INCIDENTS #1230: «عرض aew مترجم» 7.0 / «مشاهدة عروض aew» 9.3 — AEW weekly descriptions name the federation's category
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { showSeoText } = createRequire(import.meta.url)('../lib/show-seo.cjs');

test('AEW weekly pages say «من عروض المصارعة الحرة المترجمة وعروض AEW», others keep their line', () => {
  const aew = showSeoText({ headline: 'عرض داينامايت 04.11.2026 مترجم', title: 'AEW Dynamite 04.11.2026', programName: 'AEW Dynamite', eventDate: '2026-11-04', day: '4 نوفمبر 2026', isLatest: true });
  assert.match(aew.description, /، من عروض المصارعة الحرة المترجمة وعروض AEW\.$/);
  assert.ok(aew.description.length < 215, aew.description);
  const tna = showSeoText({ headline: 'عرض تي ان ايه 05.11.2026 مترجم', title: 'TNA iMPACT 05.11.2026', programName: 'TNA iMPACT', eventDate: '2026-11-05', day: '5 نوفمبر 2026', isLatest: true });
  assert.match(tna.description, /من عروض المصارعة الحرة المترجمة مع روابط المشاهدة والتحميل\.$/);
  assert.doesNotMatch(tna.description, /عروض AEW/);
  const ufc = showSeoText({ headline: 'عرض يو اف سي 09.11.2026 مترجم', title: 'UFC Fight Night 09.11.2026', programName: 'UFC Fight Night', eventDate: '2026-11-09', day: '9 نوفمبر 2026', isLatest: true });
  assert.match(ufc.description, /MMA المترجمة مع روابط المشاهدة والتحميل\.$/);
});
