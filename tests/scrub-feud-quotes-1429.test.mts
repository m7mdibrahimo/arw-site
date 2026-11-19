import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWrestlingTerms } from '../scripts/fightful-watcher.ts';
import { applyCorrections } from '../scripts/news-qa.ts';

test('a reporter in a feud becomes «صحفي», not «تقارير صحفية مطلعة» (INCIDENTS #1429)', () => {
  const out = sanitizeWrestlingTerms('فال فينيس يرد بعنف على Sean Ross Sapp بسبب RF Video');
  assert.ok(!out.includes('تقارير صحفية'), out);
  assert.ok(out.includes('على صحفي'), out);
});

test('a quote wrapped twice loses the extra marks (INCIDENTS #1429)', () => {
  const out = sanitizeWrestlingTerms('قال فيه: ««أراهن أنك تقول هذا لكل «ذا بويز»! هناك الكثير من الأفكار»».');
  assert.equal(out.includes('««') || out.includes('»»'), false, out);
  assert.ok(out.includes('«أراهن'), out);
});

test('corrections from #1429 fix hamza, «لعبة الألعاب» and motion capture', () => {
  assert.equal(applyCorrections('بوصفه الواجهة الابرز'), 'بوصفه الواجهة الأبرز');
  assert.equal(applyCorrections('وازاح الستار عن الحادثة'), 'وأزاح الستار عن الحادثة');
  assert.equal(applyCorrections('خلال نهاية الأسبوع القادمة'), 'خلال نهاية الأسبوع القادم');
  assert.equal(applyCorrections('مرتبطة بلعبة الألعاب الشهيرة'), 'مرتبطة باللعبة الشهيرة');
  assert.equal(applyCorrections('يشارك في حركة الغرافيك للعبة'), 'يشارك في التقاط الحركة للعبة');
});
