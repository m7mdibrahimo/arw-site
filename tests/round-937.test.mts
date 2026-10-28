// Round 2026-10-28 15:15 UTC (INCIDENTS #937): «جوشا جين», «يمتلك خيرة», «أفلام الحراسة», «فريق هاوس Money»,
// and an English story with its closing video in the middle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, checkArticle } from '../scripts/news-qa.ts';
import { trailingEmbedsLast } from '../scripts/english-edition.ts';

test('the round-937 misspellings are fixed in every story', () => {
  assert.equal(applyCorrections('بوكر تي يعلن توقيع جوشا جين عقدا'), 'بوكر تي يعلن توقيع جوزايا جين عقدا');
  assert.equal(applyCorrections('المصارع كونان لايكان الذي يمتلك خيرة في الاتحادات المستقلة'), 'المصارع كونان لايكان الذي يمتلك خبرة في الاتحادات المستقلة');
  assert.equal(applyCorrections('وهو من خيرة المصارعين'), 'وهو من خيرة المصارعين');
  assert.equal(applyCorrections('مشاهدة ديف باتيستا في أفلام الحراسة'), 'مشاهدة ديف باتيستا في أفلام Guardians of the Galaxy');
});

test('a group name half in Arabic and half in English blocks the story', () => {
  const issues = checkArticle('بوكر تي يعلن توقيع جوزايا جين عقدا مع برنامج WWE ID', 'تحدث جين عن خلافه مع إيه جيه فرانسيس وفريق هاوس Money، وقال إنه شعر بأن العلاقة أصبحت من طرف واحد بعد شهور طويلة من العمل معا. ' + 'كلام '.repeat(60));
  assert.ok(issues.some((i: any) => i.code === 'half_english_name'), JSON.stringify(issues.map((i: any) => i.code)));
});

test('the video that closes the Arabic story closes the English one', () => {
  const v = 'https://www.youtube.com/watch?v=eHhayAWYsFM';
  const en = `First paragraph.\n\n> "Quote."\n\n${v}\n\nLast paragraph.`;
  assert.equal(trailingEmbedsLast(en, `فقرة.\n\nفقرة أخيرة.\n\n${v}\n`), `First paragraph.\n\n> "Quote."\n\nLast paragraph.\n\n${v}`);
  // an embed the Arabic story keeps in the middle stays where it is
  assert.equal(trailingEmbedsLast(en, `فقرة.\n\n${v}\n\nفقرة أخيرة.`), en);
});
