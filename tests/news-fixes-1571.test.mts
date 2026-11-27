// INCIDENTS #1571: «إنهن لست معتادات», «اتحاد مصارعة المستقلين» (on the indies), «نزالي وار Games»,
// «بيغستاوبلغ» (BigXthaPlug) and the tag «آلية ميستيريو» reached the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa.ts';

test('#1571: feminine plural takes «لسن»', () => {
  assert.equal(applyCorrections('قائلة إنهن لست معتادات على القفص'), 'قائلة إنهن لسن معتادات على القفص');
});

test('#1571: half-Arabic WarGames is rejoined', () => {
  assert.equal(applyCorrections('ويشهد نزال وار Games للرجال'), 'ويشهد نزال WarGames للرجال');
});

test('#1571: the indies are not a promotion; names follow the glossary', () => {
  assert.equal(applyCorrections('لم أختبر ذلك في اتحاد مصارعة المستقلين'), 'لم أختبر ذلك في عروض المصارعة المستقلة');
  assert.equal(applyCorrections('أغنية Texas للمطرب بيغستاوبلغ'), 'أغنية Texas للمطرب BigXthaPlug');
  assert.equal(applyCorrections('آلية ميستيريو'), 'ألياه غوتييرز');
  assert.equal(applyCorrections('آلية جديدة للتصويت'), 'آلية جديدة للتصويت');
});
