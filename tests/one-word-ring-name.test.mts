import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wrestlerNotInSource, applyCorrections } from '../scripts/news-qa.ts';

// INCIDENTS #1364: a BCW story about The Sandman came out «ذا أندرتيكر يواجه دي سي تي». One-word «The X» ring names
// were skipped by name_not_in_source (it needs two words of 4+ letters).
test('a one-word «The X» ring name the source never names blocks publishing', () => {
  const gl = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  const source = 'The Sandman to face DCT at BCW 10th Anniversary. Battle Championship Wrestling in Australia announced a match between The Sandman and DCT on Friday, December 4. DCT requested the bout against the ECW legend.';
  assert.ok(wrestlerNotInSource('ذا أندرتيكر يواجه دي سي تي\nيستعد أندرتيكر للعودة إلى الحلبة', source, gl).includes('The Undertaker'));
  assert.ok(!wrestlerNotInSource('ذا ساندمان يواجه دي سي تي\nيستعد ذا ساندمان للعودة إلى الحلبة', source, gl).includes('The Sandman'));
  assert.ok(!wrestlerNotInSource('واجه ذا أندرتيكر خصمه', source + ' The Undertaker was there too.', gl).includes('The Undertaker'));
  assert.equal(gl['The Sandman'], 'ذا ساندمان');
  assert.equal(gl['Paige Collett'], 'بايج كوليت');
});

test('«لقب AEW الوطنية», «الكونتيننتال كلاسيك» and «بيج كوليت» are corrected (INCIDENTS #1364)', () => {
  assert.equal(applyCorrections('خاض مواجهة على لقب AEW الوطنية'), 'خاض مواجهة على بطولة AEW الوطنية');
  assert.equal(applyCorrections('مع انطلاق موسم الكونتيننتال كلاسيك'), 'مع انطلاق موسم Continental Classic');
  assert.equal(applyCorrections('المصارعة بيج كوليت'), 'المصارعة بايج كوليت');
  assert.equal(applyCorrections('وبيج شو'), 'وبيج شو');
});
