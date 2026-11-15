import { test } from 'node:test';
import assert from 'node:assert/strict';
const { applyCorrections } = await import('../scripts/news-qa.ts');

// INCIDENTS #1337: «وواحد من مصارعي المفضلين» reads as a construct without shadda (tashkeel is banned).
test('«من مصارعي/نجومي المفضلين» becomes «من المصارعين/النجوم المفضلين لدي»', () => {
  assert.equal(applyCorrections('وواحد من مصارعي المفضلين على الإطلاق'), 'وواحد من المصارعين المفضلين لدي على الإطلاق');
  assert.equal(applyCorrections('إنه من نجومي المفضلين'), 'إنه من النجوم المفضلين لدي');
  // the singular «مصارعي المفضل» is correct and stays
  assert.equal(applyCorrections('أندرتيكر هو مصارعي المفضل'), 'أندرتيكر هو مصارعي المفضل');
});
