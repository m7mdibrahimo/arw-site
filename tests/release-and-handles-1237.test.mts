// INCIDENTS #1237: «speaking to Jimmy V3» came out «مقابلة مع جيمي في 3» (reads «Jimmy in 3»), «granted her release»
// came out «منحها الاستغناء», and «release of medical records» came out «الإفراج عن سجله الطبي».
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixLetterDigitHandles, applyCorrections } from '../scripts/news-qa.ts';

test('a name with a letter and a number keeps its English spelling', () => {
  const src = 'While speaking to Jimmy V3 in a new interview, Nia Jax spoke about the origins of her ring name.';
  assert.equal(fixLetterDigitHandles('تحدثت نيا جاكس في مقابلة مع جيمي في 3 عن تفاصيل اسمها', src), 'تحدثت نيا جاكس في مقابلة مع Jimmy V3 عن تفاصيل اسمها');
  assert.equal(fixLetterDigitHandles('خلال حوار جديد مع جيمي في 3، استرجع', src), 'خلال حوار جديد مع Jimmy V3، استرجع');
  // no handle in the source: «في 3 مناسبات» stays
  assert.equal(fixLetterDigitHandles('فاز جيمي في 3 مناسبات', 'Jimmy won three times'), 'فاز جيمي في 3 مناسبات');
  // a function word before «في» is never taken for the name
  assert.equal(fixLetterDigitHandles('تحدث مع في 3', src), 'تحدث مع في 3');
});

test('a contract release is «فسخ العقد», never «منح الاستغناء»', () => {
  assert.equal(applyCorrections('تاي ميلو تصبح مصارعة بلا عقد بعد منحها الاستغناء من اتحاد AEW'), 'تاي ميلو تصبح مصارعة بلا عقد بعد فسخ عقدها مع اتحاد AEW');
  assert.equal(applyCorrections('بعد حصولها على الاستغناء من عقدها وتحولها'), 'بعد فسخ عقدها وتحولها');
  assert.equal(applyCorrections('وإما منحه الاستغناء الرسمي وإنهاء العقد فورا'), 'وإما فسخ عقده رسميا فورا');
});

test('records are handed over, not «released» like a prisoner', () => {
  assert.equal(applyCorrections('يعترض على الإفراج عن سجله الطبي'), 'يعترض على تسليم سجله الطبي');
  assert.equal(applyCorrections('رفض الإفراج عن السجلات الطبية'), 'رفض تسليم السجلات الطبية');
});
