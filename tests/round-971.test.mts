// INCIDENTS #971: «تسجيلي عرض»، «احتفالية الإعجاب واسع النطاق»، «شركة ام في بي»، and an English date given a wrong year.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa';
import { enYearNotInSource } from '../scripts/english-edition.ts';

test('Arabic slips from the 2026-10-29 stories are corrected', () => {
  assert.equal(applyCorrections('نتائج تسجيلي عرض AEW Collision ليوم 31 أكتوبر 2026'), 'نتائج تسجيلات عرض AEW Collision ليوم 31 أكتوبر 2026');
  assert.equal(applyCorrections('الشريك المؤسس لشركة ام في بي'), 'الشريك المؤسس لشركة MVP');
  assert.equal(applyCorrections('بين شركتي ام في بي المملوكة'), 'بين شركتي MVP المملوكة');
  assert.equal(applyCorrections('تحت اسم ام في بي MMA'), 'تحت اسم MVP MMA');
  // the wrestler MVP keeps his Arabic name
  assert.equal(applyCorrections('هاجم ام في بي خصمه'), 'هاجم ام في بي خصمه');
  assert.match(applyCorrections('تقاطعها أنيا روني'), /أنيا رون$/);
  assert.match(applyCorrections('حقق إيلجاه هوليفيلد الفوز'), /إيلايجا هوليفيلد/);
  assert.match(applyCorrections('ناكسا بيداريس'), /ناكيسا بيداريان/);
  assert.doesNotMatch(applyCorrections('وأقامت نيكيتا ليونز احتفالية الإعجاب واسع النطاق'), /واسع النطاق/);
});

const source = 'Flair suffered a bloody fall outside a Florida establishment on October 23 and spent the night at Tampa General Hospital. '.repeat(3);
test('an English date never gets a year that is neither the story year nor in the source', () => {
  assert.equal(enYearNotInSource('a bloody fall on October 23, 2025, and returning', source, '2026-10-29T10:00:00Z'), 'a bloody fall on October 23, and returning');
  assert.equal(enYearNotInSource('on October 23, 2026.', source, '2026-10-29T10:00:00Z'), 'on October 23, 2026.');
  assert.equal(enYearNotInSource('his loss on December 15, 2025.', source + ' He lost on December 15, 2025.', '2026-10-29T10:00:00Z'), 'his loss on December 15, 2025.');
  assert.equal(enYearNotInSource('on October 23, 2025.', '', '2026-10-29T10:00:00Z'), 'on October 23, 2025.');
});

test('a year-over-year date the source does not spell out is left alone', () => {
  const viewers = 'SmackDown drew 950,000 viewers, down from the same week last year. '.repeat(4);
  assert.equal(enYearNotInSource('compared to the October 24, 2025 episode', viewers, '2026-10-29T10:00:00Z'), 'compared to the October 24, 2025 episode');
});

test('«Special» alone is no alternate name of a show', async () => {
  const fs = await import('node:fs');
  assert.match(fs.readFileSync('lib/show-seo.cjs', 'utf8'), /genericShort = \/\^\(\?:specials\?/);
});

test('«لأنها تحويل» and «Speaking on an interview» are fixed (INCIDENTS #973)', async () => {
  assert.equal(applyCorrections('لأنها تحويل العلاقة'), 'لأنها تحول العلاقة');
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Speaking on an interview, Heyman said'), 'Speaking in an interview, Heyman said');
});
