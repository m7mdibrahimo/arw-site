// INCIDENTS #1197: «the November 10 episode of WWE RAW» (Raw is on Mondays), «مع الزوجين», «تهاد غيبل», «يتحدى لفريق»
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';
import { enShowOnWrongWeekday, englishStyleRules } from '../scripts/english-edition.ts';

const nov = new Date(Date.UTC(2026, 10, 10));

test('an English story that dates a weekly show to a day it does not air on is caught', () => {
  assert.ok(enShowOnWrongWeekday('Becky Lynch made her return on the November 10 episode of WWE RAW.', nov));
  assert.ok(enShowOnWrongWeekday('It happened on WWE SmackDown on November 7, 2026.', new Date(Date.UTC(2026, 10, 7, 3))));
  assert.equal(enShowOnWrongWeekday('NXT moved: the November 4 episode of WWE NXT aired on a Wednesday.', new Date(Date.UTC(2026, 10, 5)), 'NXT airs live on Wednesday, November 4 because of the World Series.'), null);
  assert.equal(enShowOnWrongWeekday('the June 27, 2002, episode of WWE SmackDown', nov), null);
  assert.equal(enShowOnWrongWeekday('Becky Lynch made her return on the November 9 episode of WWE Raw.', nov), null);
  assert.equal(enShowOnWrongWeekday('IYO SKY will challenge on the November 16 episode of WWE Raw.', nov), null);
  assert.equal(enShowOnWrongWeekday('AEW Collision on November 7 aired from the cruise.', nov), null);
  assert.match(englishStyleRules('https://www.fightful.com/x/'), /US air date/);
});

test('«الزوجين» / «كزوجين» / «الخطيبين» are dual nouns', () => {
  for (const body of ['وشهدت اللحظة احتفالا خاصا من المصارع تيربو فلويد ودالتون كاسل مع الزوجين داخل الحلبة وسط تفاعل الجماهير.', 'يعيش الثنائي لاش ليجند وتريك ويليامز حياتهم كزوجين أثناء السفر مع عروض WWE.', 'احتفل الخطيبين مع الجماهير.'])
    assert.ok(checkArticle('تروث ماجنوم يطلب الزواج من صديقته خلال عرض Jericho Cruise', body).some(i => i.code === 'dual_noun'), body);
  assert.ok(!checkArticle('تروث ماجنوم يطلب الزواج من صديقته خلال عرض Jericho Cruise', 'احتفل تيربو فلويد ودالتون كاسل مع ماجنوم وخطيبته داخل الحلبة وسط تفاعل الجماهير الكبير.').some(i => i.code === 'dual_noun'));
});

test('the wrong spellings of #1197 are corrected', () => {
  assert.equal(applyCorrections('خاض الثلاثي بيج كاس وتهاد غيبل وري فينيكس'), 'خاض الثلاثي بيج كاس وتشاد غيبل وري فينيكس');
  assert.equal(applyCorrections('بواسطة مسؤول الإدارة آدم بيرس'), 'بواسطة المدير العام آدم بيرس');
  assert.equal(applyCorrections('ورومان رينز يتحدى لفريق ذا 946'), 'ورومان رينز يتحدى فريق ذا 946');
});
