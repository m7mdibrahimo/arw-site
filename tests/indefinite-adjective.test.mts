import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa.ts';
import { englishStyleRules } from '../scripts/english-edition.ts';

// INCIDENTS #1196: «لخوض مواجهة المرتقبة» reached the site (CM Punk / Team USA story)
test('a noun without «ال» before an adjective with «ال» blocks publishing', () => {
  assert.ok(BLOCKING_QA_CODES.includes('indefinite_noun_definite_adjective'));
  assert.ok(RETRYABLE_QA_CODES.includes('indefinite_noun_definite_adjective'));
  const bad = checkArticle('سي ام بانك ينضم إلى فريق أمريكا في عرض WWE Survivor Series', 'أكد المصارع سي ام بانك انضمامه رسميا إلى فريق أمريكا لخوض مواجهة المرتقبة في عرض WWE Survivor Series أمام فريق المكسيك بقيادة ري ميستيريو.');
  assert.ok(bad.some(i => i.code === 'indefinite_noun_definite_adjective'));
});

test('the right forms and «نزال الأخيرة» (= the latter\'s match) pass', () => {
  for (const body of [
    'أكد المصارع سي ام بانك انضمامه رسميا إلى فريق أمريكا لخوض المواجهة المرتقبة في عرض WWE Survivor Series أمام فريق المكسيك.',
    'أكد المصارع سي ام بانك انضمامه رسميا إلى فريق أمريكا لخوض مواجهة مرتقبة في عرض WWE Survivor Series أمام فريق المكسيك.',
    'دخلت سيرينا ديب في احتكاك كلامي حاد مع بريت بيكر عقب نزال الأخيرة أمام بينيلوبي فورد في عرض AEW Collision.',
  ]) assert.ok(!checkArticle('سي ام بانك ينضم إلى فريق أمريكا', body).some(i => i.code === 'indefinite_noun_definite_adjective'), body);
});

test('wrestling idioms: «left them lying» and a splash that breaks up a pin are in both rule sets', () => {
  const en = englishStyleRules('https://www.fightful.com/x');
  assert.match(en, /left them lying/);
  assert.match(en, /never "pinned Big Cass"/);
  const guide = readFileSync(new URL('../editorial/style-guide.md', import.meta.url), 'utf8');
  assert.match(guide, /left them lying[^\n]*ممددين على الأرض[^\n]*ممنوع «مصابين»/);
  assert.match(guide, /splash while Y was pinning Z/);
});
