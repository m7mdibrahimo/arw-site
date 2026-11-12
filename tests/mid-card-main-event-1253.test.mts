import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCorrections, fixMidCardMainEvent, wrestlerNotInSource } from '../scripts/news-qa.ts';

const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));

// INCIDENTS #1253: AEW Dynamite 11 Nov (Fightful) — the source's last lines.
const SOURCE = `On November 11, 2026, All Elite Wrestling hosted a new episode of Dynamite on the Maverik Center in West Valley City, Utah.
Brodido (Bandido and Brody King) vs. New Level (Austin Creed and Kofi) ended in a Count-out.
Wrathlander & Brawling Birds argued backstage following Blood & Guts.
David Finlay def. Orange Cassidy.
Persephone (w/ Britt Baker) def. Gypsy Mac.
Match 5 of Best of Five Series: Motor City Machine Guns (Alex Shelley & Chris Sabin) def. FTR (Dax Harwood & Cash Wheeler.
AEW National Championship: Tommaso Ciampa (c) def. "Speedball" Mike Bailey to retain the title.
Mixed Tag Team: Marina Shafir and Jon Moxley def. Mercedes Mone and Jay White.
Wardlow def. Nick Comorotto.
ROH World Tag Team Championship Match: Sky Team (Mistico & Mascara Dorada) (c) vs. The Swirl (Blake Christian & Lee Johnson).`;

test('«الحدث الرئيسي» with more matches after it takes its place number, and the later ones move up', () => {
  const body = '**المواجهة الأولى: نزال فردي**\n\nا\n\n**الحدث الرئيسي (Main Event): نزال فرق مختلط**\n\nب\n\n**المواجهة الثانية: نزال فردي**\n\nج';
  const out = fixMidCardMainEvent(body);
  assert.match(out, /\*\*المواجهة الثانية: نزال فرق مختلط\*\*/);
  assert.match(out, /\*\*المواجهة الثالثة: نزال فردي\*\*/);
  assert.doesNotMatch(out, /الحدث الرئيسي/);
  // the real main event, last, stays
  const last = '**المواجهة الأولى: نزال فردي**\n\nا\n\n**الحدث الرئيسي: نزال على اللقب**\n\nب';
  assert.equal(fixMidCardMainEvent(last), last);
  assert.equal(applyCorrections(body), out);
});

test('«سكاي فريق» and «بايج ستوك» are corrected', () => {
  assert.equal(applyCorrections('🏆 **الفائزون:** سكاي فريق'), '🏆 **الفائزون:** سكاي تيم');
  assert.equal(applyCorrections('ألقى بايج ستوك خطابا'), 'ألقى بيغ ستوك خطابا');
});

test('a stable the source never names («بيرثرايت» for Brawling Birds) blocks as name_not_in_source', () => {
  const body = 'شهدت الكواليس نقاشا حادا بين فريق راثلاندر وفريق بيرثرايت في أعقاب عرض AEW Blood and Guts.';
  assert.deepEqual(wrestlerNotInSource(body, SOURCE, names), ['BirthRight']);
  assert.deepEqual(wrestlerNotInSource('شهدت الكواليس نقاشا حادا بين فريق راثلاندر وفريق ذا براولنج بيردز.', SOURCE, names), []);
});

test('a winner for a match the source lists only as «vs.» is an invented winner', async () => {
  const W = await import('../scripts/fightful-watcher.ts');
  // «def. … to retain the title» is one result, not two
  assert.equal(W.countDistinctResults(SOURCE), 6);
  const body = ['**المواجهة الأولى: نزال فردي**', 'تغلب ديفيد فينلي على أورانج كاسيدي.', '🏆 **الفائز:** ديفيد فينلي',
    '**المواجهة الثانية: نزال فردي**', 'تمكنت بيرسيفوني من الفوز على جيبسي ماك.', '🏆 **الفائزة:** بيرسيفوني',
    '**المواجهة الثالثة: سلسلة من خمسة نزالات**', 'فاز موتور سيتي ماشين جانز على إف تي آر.', '🏆 **الفائزون:** موتور سيتي ماشين جانز',
    '**المواجهة الرابعة: نزال على بطولة AEW الوطنية**', 'احتفظ توماسو تشامبا باللقب.', '🏆 **الفائز:** توماسو تشامبا',
    '**المواجهة الخامسة: نزال فرق مختلط**', 'فاز الثنائي مارينا شافير وجون موكسلي.', '🏆 **الفائزون:** مارينا شافير وجون موكسلي',
    '**المواجهة السادسة: نزال فردي**', 'فاز واردلو على نيك كوموروتو.', '🏆 **الفائز:** واردلو',
    '**المواجهة السابعة: نزال على بطولة ROH العالمية للفرق**', 'دافع فريق سكاي فريق (ميستيكو وماسكارا دورادا) عن لقبه بنجاح ضد فريق ذا سويرل (بليك كريستيان ولي جونسون).', '🏆 **الفائزون:** سكاي فريق (المحتفظان باللقب)',
  ].join('\n\n');
  assert.equal(W.extraWinners(SOURCE, body), 1);
  assert.deepEqual(W.unbackedOrEmptyMatches(SOURCE, body, names).unbacked, ['المواجهة السابعة: نزال على بطولة ROH العالمية للفرق']);
  // the same match with a real result in the source passes
  const done = SOURCE.replace('(c) vs. The Swirl', '(c) def. The Swirl');
  assert.deepEqual(W.unbackedOrEmptyMatches(done, body, names).unbacked, []);
});
