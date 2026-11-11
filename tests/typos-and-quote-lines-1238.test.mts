// INCIDENTS #1238: «يصل إلى الععد في موعده», «لم أصب بالذهول من قبل من قبل», «لا يفقد أعضاده» went live, and two
// English stories kept the writer's own sentence inside the quote box after the closing quote mark.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkArticle, applyCorrections, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa.ts';
import { syncEnglishFromArabic } from '../scripts/english-edition.ts';

const pad = ' وتحدث المصارع عن مسيرته الطويلة في الحلبة خلال المقابلة. وأوضح أن والده كان يتأخر أحيانا قبل العروض. وأشار إلى أن الجمهور أحب طلاء الوجه المختلف. وأضاف أنه يحاول الاستفادة من تعبيرات وجه والده في مسيرته الحالية. وختم حديثه بالشكر لكل من دعمه خلال السنوات الماضية.';
const codes = (body: string) => checkArticle('زيلا فاتو يكشف سر طلاء وجه والده أوماغا', body + pad, []).map(i => i.code);

test('a letter doubled right after «ال» is blocked', () => {
  assert.ok(codes('كانت تلح عليه ليصل إلى الععد في موعده.').includes('doubled_first_letter'));
  assert.ok(codes('بعد حركته الششهيرة على الحلبة.').includes('doubled_first_letter'));
  for (const ok of ['فاز الممثل بالجائزة.', 'حفل التتويج كان رائعا.', 'تناول الببتيدات خلال فترة الإصابة.', 'ظهر الببغاء في الفيديو.', 'قال للللاعب كلمة.'])
    assert.ok(!codes(ok).includes('doubled_first_letter'), ok);
  assert.ok(BLOCKING_QA_CODES.includes('doubled_first_letter') && RETRYABLE_QA_CODES.includes('doubled_first_letter'));
});

test('two words typed twice in a row are blocked', () => {
  assert.ok(codes('وعلق قائلا: "لم أصب بالذهول من قبل من قبل، هذا هو الشخص".').includes('repeated_phrase'));
  assert.ok(!codes('فاز مرة بعد مرة ثم عاد من قبل ومن بعد.').includes('repeated_phrase'));
});

test('«أعضاده» is corrected to «أعصابه»', () => {
  assert.equal(applyCorrections('لا يفقد أعضاده عادة'), 'لا يفقد أعصابه عادة');
});

test('the English sync pass moves narration out of a quote line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q1238-'));
  const en = path.join(dir, 'en'), ar = path.join(dir, 'ar');
  fs.mkdirSync(en); fs.mkdirSync(ar);
  fs.writeFileSync(path.join(ar, '20261111163302-x.md'), '---\ntitle: "x"\nsource_id: 1\n---\nنص\n');
  fs.writeFileSync(path.join(en, '20261111163302-x.md'), '---\ntitle: "x"\nsource_id: 1\n---\nJax spoke.\n\n> "We can hold that top spot." Elsewhere in the conversation, Jax shared her thoughts on Tiffany Stratton.\n\n> "He did it his way. You got to respect that, man," Booker said.\n');
  syncEnglishFromArabic(en, ar);
  const out = fs.readFileSync(path.join(en, '20261111163302-x.md'), 'utf8');
  assert.match(out, /top spot\."\n\nElsewhere in the conversation/);
  // a short attribution stays on its quote line
  assert.match(out, /man," Booker said\./);
});
