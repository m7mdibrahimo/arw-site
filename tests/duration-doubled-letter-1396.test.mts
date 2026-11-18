import test from 'node:test';
import assert from 'node:assert/strict';
import { enDurationNotInSource } from '../scripts/english-edition.ts';
import { checkArticle } from '../scripts/news-qa.ts';

// INCIDENTS #1396: the English Bronson Reed story said «over seven weeks»; the source says «more than a week».
const source = 'Bronson Reed is finally back home after spending more than a week dealing with serious injuries suffered at WWE Crown Jewel in Saudi Arabia. He suffered multiple broken ribs and a lacerated kidney. The 38-year-old was in the hospital for 10 days, and WWE has not given a timetable for his return.';

test('a length of time the source never gives is caught (INCIDENTS #1396)', () => {
  assert.equal(enDurationNotInSource('He returned home after spending over seven weeks dealing with severe injuries.', source), 'seven weeks');
});

test('the source\'s own figures pass, as words, digits or hyphenated', () => {
  assert.equal(enDurationNotInSource('He returned home after spending more than a week in hospital.', source), null);
  assert.equal(enDurationNotInSource('The 38-year-old star spent ten days in the hospital.', source), null);
  assert.equal(enDurationNotInSource('He spent seven weeks out.', 'short source'), null);
});

test('a letter typed twice after «و/ب/ل» is blocked, real words pass (INCIDENTS #1396)', () => {
  for (const w of ['تغلبت ناتاليا ماركوفا على غريتا بصصحبة ميس ستار', 'حسم الأمور لصصلحهم', 'مواقف طريفة لبانك وررودز'])
    assert.ok(checkArticle('عنوان الخبر عن النزال', w).some((i) => i.code === 'doubled_first_letter'), w);
  for (const w of ['بددت الشركة أموالها', 'ككل', 'ففاز بالنزال', 'وتتويج البطل', 'للأسف', 'ببساطة', 'وممثل الاتحاد'])
    assert.ok(!checkArticle('عنوان الخبر عن النزال', w).some((i) => i.code === 'doubled_first_letter'), w);
});
