import test from 'node:test';
import assert from 'node:assert/strict';
const { applyCorrections } = await import('../scripts/news-qa.ts');

// INCIDENTS #1338: «لقد تقبلت الأمر، دعنا نقول ذلك» is a word-for-word copy of "let's say that".
test('«دعنا/دعونا نقول ذلك» becomes «إن صح التعبير»', () => {
  assert.equal(applyCorrections('لقد تقبلت الأمر، دعنا نقول ذلك».'), 'لقد تقبلت الأمر، إن صح التعبير».');
  assert.equal(applyCorrections('كان عرضا جيدا، دعونا نقول ذلك'), 'كان عرضا جيدا، إن صح التعبير');
});

// INCIDENTS #1338: TNA Destination X results wrote «صالة إدموندتون إكسبو سنتر في إدموندتون».
test('«إدموندتون» becomes «إدمونتون»', () => {
  assert.equal(applyCorrections('في صالة إدموندتون إكسبو سنتر في إدموندتون'), 'في صالة إدمونتون إكسبو سنتر في إدمونتون');
  assert.equal(applyCorrections('مدينة إدمونتون'), 'مدينة إدمونتون');
});
