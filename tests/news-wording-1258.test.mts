import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa.ts';
import { fixEnglishNames } from '../scripts/english-edition.ts';

// INCIDENTS #1258: four wording slips reached the site in one hour.

test('«قرب … قريبا» in one headline is blocked and sent back to the writer', () => {
  const body = 'يقترب المصارع ام جيه اف من العودة إلى شاشات AEW بعد غياب استمر أكثر من شهرين عن العروض التلفزيونية، والاتحاد يجهز له منافسة كبيرة.';
  const bad = checkArticle('تقارير تؤكد قرب عودة ام جيه اف إلى عروض AEW قريبا وسط غيابه التلفزيوني', body, []);
  assert.ok(bad.some((i) => i.code === 'redundant_soon'));
  assert.ok(BLOCKING_QA_CODES.includes('redundant_soon') && RETRYABLE_QA_CODES.includes('redundant_soon'));
  for (const ok of ['تقارير تؤكد قرب عودة ام جيه اف إلى شاشات AEW بعد غياب أكثر من شهرين', 'ام جيه اف يعود إلى AEW قريبا']) {
    assert.ok(!checkArticle(ok, body, []).some((i) => i.code === 'redundant_soon'), ok);
  }
});

test('«الفاعليات» and «ترك وشأنه» are corrected before publishing', () => {
  assert.equal(applyCorrections('ظهر حكما خاصا في إحدى الفاعليات المستقلة'), 'ظهر حكما خاصا في إحدى الفعاليات المستقلة');
  assert.equal(applyCorrections('شارك في فاعليات كثيرة'), 'شارك في فعاليات كثيرة');
  assert.equal(applyCorrections('بينما يضمن ترك وشأنه قضاء الجميع وقتا هادئا'), 'بينما يضمن تركه وشأنه قضاء الجميع وقتا هادئا');
});

test('a UFC card name copied in capitals is written in normal case; tag-team acronyms stay', () => {
  assert.equal(fixEnglishNames('beginning with UFC 334: GANE vs HOKIT at Madison Square Garden'), 'beginning with UFC 334: Gane vs Hokit at Madison Square Garden');
  assert.equal(fixEnglishNames('FTR vs. MCMG and NJPW vs AEW'), 'FTR vs. MCMG and NJPW vs AEW');
});

test('«recently admitted that his recent» says «recent» once', () => {
  assert.equal(fixEnglishNames('Damian Priest recently admitted that his recent partnership left him frustrated.'), 'Damian Priest admitted that his recent partnership left him frustrated.');
});
