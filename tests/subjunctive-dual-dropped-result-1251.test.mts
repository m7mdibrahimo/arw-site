// INCIDENTS #1251: the Dynamite/Collision results of 11 November were rewritten with «ليحسما السلسلة» (a dual
// subjunctive no check knew) and with the mixed tag listed as «يواجه …» with no result although the source had it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixSubjunctiveDuals, applyCorrections, checkArticle } from '../scripts/news-qa.ts';
import { droppedMatchResults } from '../scripts/fightful-watcher.ts';

test('a masculine dual subjunctive becomes the plural; «يضمنا» (= يضم + نا) is left alone', () => {
  assert.equal(fixSubjunctiveDuals('فاز الفريق ليحسما السلسلة لصالحهم.'), 'فاز الفريق ليحسموا السلسلة لصالحهم.');
  assert.equal(fixSubjunctiveDuals('قبل أن يخوضا مواجهة ثالثة'), 'قبل أن يخوضوا مواجهة ثالثة');
  assert.equal(fixSubjunctiveDuals('ليتوجا رسميا ويحتفظا باللقب'), 'ليتوجوا رسميا ويحتفظوا باللقب');
  assert.equal(fixSubjunctiveDuals('شخص آمن بنا بما يكفي ليضمنا إلى صفوف الاتحاد'), 'شخص آمن بنا بما يكفي ليضمنا إلى صفوف الاتحاد');
  assert.equal(fixSubjunctiveDuals('ليحسموا السلسلة'), 'ليحسموا السلسلة'); // idempotent
  assert.match(applyCorrections('ليحسما السلسلة'), /ليحسموا/);
});

test('a feminine dual subjunctive is blocked by dual_form', () => {
  const codes = (b: string) => checkArticle('نتائج عرض WWE Raw', b).map((i) => i.code);
  assert.ok(codes('فازت تايتوم باكسلي وأليكسا بليس لتحصلا على أحزمة البطولة.').includes('dual_form'));
  assert.ok(codes('أضيفت مواجهة جديدة لتنضما إلى البطاقة.').includes('dual_form'));
  assert.ok(!codes('أضيفت مواجهة جديدة لتنضم إلى البطاقة.').includes('dual_form'));
});

const names = { 'Marina Shafir': 'مارينا شافير', 'Jon Moxley': 'جون موكسلي', 'Mercedes Moné': 'مرسيدس موني', 'Queen Aminata': 'كوين أميناتا', 'Skye Blue': 'سكاي بلو' };
const source = [
  'Mixed Tag Team Match: Mercedes Moné and Jay White vs. The Death Riders (Marina Shafir and Jon Moxley)',
  'Shafir then gets Moné in a Brutalizer and forces Moné to tap out.',
  'The winners of the Mixed Tag Team Match, The Death Riders (Marina Shafir and AEW Continental Champion Jon Moxley)!',
  'Queen Aminata will also be defending her TBS Championship against Skye Blue and Hyan in a three-way.',
].join('\n');

test('a match the source has a winner for, written with no result line, is caught; an unfinished one is not', () => {
  const body = [
    '**المواجهة الثالثة: نزال ثلاثي على بطولة TBS**', '', 'تدافع كوين أميناتا عن بطولة TBS ضد سكاي بلو وهيان.', '', '---',
    '**المواجهة السادسة: نزال فرق مختلط**', '', 'يواجه مرسيدس موني وجاي وايت فريق ديث رايدرز (مارينا شافير وجون موكسلي).', '', '---',
  ].join('\n');
  assert.deepEqual(droppedMatchResults(source, body, names), ['المواجهة السادسة: نزال فرق مختلط']);
  const fixed = body.replace('يواجه مرسيدس موني وجاي وايت فريق ديث رايدرز (مارينا شافير وجون موكسلي).', 'فاز فريق ديث رايدرز (مارينا شافير وجون موكسلي) على مرسيدس موني وجاي وايت.\n\n🏆 **الفائزون:** ديث رايدرز');
  assert.deepEqual(droppedMatchResults(source, fixed, names), []);
});

test('a winner the source does not have yet, and a match heading with nothing under it, are caught', async () => {
  const { unbackedOrEmptyMatches } = await import('../scripts/fightful-watcher.ts');
  const body = [
    '**المواجهة الثالثة: نزال بدون لقب**', '', '---',
    '**المواجهة السادسة: نزال فرق مختلط**', '', 'فاز فريق ديث رايدرز.', '', '🏆 **الفائزون:** مارينا شافير وجون موكسلي', '', '---',
    '**الحدث الرئيسي: نزال ثلاثي على بطولة TBS**', '', 'احتفظت كوين أميناتا بلقبها.', '', '🏆 **الفائزة:** كوين أميناتا',
  ].join('\n');
  assert.deepEqual(unbackedOrEmptyMatches(source, body, names), { unbacked: ['الحدث الرئيسي: نزال ثلاثي على بطولة TBS'], empty: ['المواجهة الثالثة: نزال بدون لقب'] });
});
