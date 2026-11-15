import { test } from 'node:test';
import assert from 'node:assert/strict';
const { fixSwappedSurnames, fixNearGlossaryNames, threeWayAsCount } = await import('../scripts/news-qa.ts');

// INCIDENTS #1336: «تري مونتانا» for Trey Miguel — the first name kept, Cruz Montana's surname glued on.
const src = 'Trey Miguel has been trying to reach Edmonton for his scheduled match against Leon Slater. Mustafa Ali is trying to drive a wedge between Kazarian and Avery Styles. '.repeat(3);
test('a source name written with another glossary wrestler\'s surname takes the source name', () => {
  assert.equal(fixSwappedSurnames('بسبب محاولات تري مونتانا الوصول إلى إدمونتون', ['تراي ميجيل'], src), 'بسبب محاولات تراي ميجيل الوصول إلى إدمونتون');
  assert.equal(fixSwappedSurnames('بين كازاريان وآيفري ستيلز.', ['إيفري ستايلز'], src), 'بين كازاريان وإيفري ستايلز.');
});
test('a borrowed surname whose owner the source names stays', () => {
  const s2 = src + ' Cruz Montana also appeared.';
  assert.equal(fixSwappedSurnames('ظهر كروز مونتانا وتري مونتانا', ['تراي ميجيل'], s2), 'ظهر كروز مونتانا وتري مونتانا');
  // a different first name (other consonants) is never touched
  assert.equal(fixSwappedSurnames('ظهر سام مونتانا', ['تراي ميجيل'], src), 'ظهر سام مونتانا');
});
test('the near-name fix keeps the «و» prefix and lets the swap fix handle it', () => {
  assert.equal(fixNearGlossaryNames('بين كازاريان وآيفري ستيلز.', ['إيفري ستايلز']), 'بين كازاريان وآيفري ستيلز.');
  assert.equal(fixNearGlossaryNames('بين كازاريان آيفري ستيلز.', ['إيفري ستايلز']), 'بين كازاريان إيفري ستايلز.');
});
test('«Two Three-Way Matches» is not «ثلاثة نزالات»', () => {
  const s = 'Two Three-Way Matches were advertised to take place at Destination X for the World X Cup.';
  assert.equal(threeWayAsCount('كان من المخطط في البداية إقامة ثلاثة نزالات، يجمع الأول', s), 'ثلاثة نزالات');
  assert.equal(threeWayAsCount('كان من المخطط إقامة نزال ثلاثي ونزال ثلاثي آخر', s), '');
  assert.equal(threeWayAsCount('ثلاثة نزالات', 'The card has three matches, one a three-way.'), '');
});
