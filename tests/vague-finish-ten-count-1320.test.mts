import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, checkArticle, claimNotInSource, BLOCKING_QA_CODES } from '../scripts/news-qa.ts';

const codes = (t: string, b: string) => checkArticle(t, b).map(i => i.code);
const filler = ' '.repeat(10) + 'x'.repeat(220);

test('the same win told twice in one sentence blocks publishing (Samoa Joe / Jack Perry, INCIDENTS #1320)', () => {
  const body = 'خلال عرض Full Gear Zero Hour، حقق جاك بيري الفوز على ذا بيست مورتوس، قبل أن يوجه رسالة حادة إلى ساموا جو عبر الكاميرا ويبصق عليها، ويهزم ذا بيست مورتوس.\n\nوفي المقابل نشر جو مقطع فيديو.';
  assert.ok(codes('ساموا جو يواجه جاك بيري', body).includes('repeated_win_clause'));
  const ok = 'خلال العرض، فاز جاك بيري على ذا بيست مورتوس، ثم بصق على الكاميرا.\n\nوفي المقابل نشر جو مقطع فيديو.';
  assert.ok(!codes('ساموا جو يواجه جاك بيري', ok).includes('repeated_win_clause'));
});

test('a finish or a run-in with no names blocks publishing (Anarchy in the Arena, INCIDENTS #1320)', () => {
  assert.ok(BLOCKING_QA_CODES.includes('vague_finish'));
  for (const bad of [
    'وفي اللحظات الحاسمة، تمكن فريق ذا كات من حسم المواجهة بعد تنفيذ ضربة قاضية وحاسمة أسفرت عن تثبيت الخصم وإعلان الفوز.',
    'بالإضافة إلى تدخل مرسيدس موني لصالح الأحداث قبل أن تبتعد عن اللقاء.',
    'بينما سجل كلاوديو كاستانيولي عودته للسيطرة على الأجواء.',
  ]) assert.ok(codes('فريق ذا كات يهزم ديث رايدرز', bad + '\n\nشهد العرض نزالا كبيرا.').includes('vague_finish'), bad);
  const good = 'وتلقى موكسلي ضربة Blade Runner من الخلف، فثبته جاي وايت ومنح فريقه الفوز.\n\nونزال تثبيت الخصم في أي مكان كان الأول.';
  assert.ok(!codes('فريق ذا كات يهزم ديث رايدرز', good).includes('vague_finish'));
});

test('a pin in a Texas Death match needs a pin in the source (Bandido, INCIDENTS #1320)', () => {
  const src = "Bandido teamed with Hangman Page and Brody King in a Texas Death Match. Strickland drilled him with a House Call and left him unable to answer the ten-count." + filler;
  assert.ok(claimNotInSource('حسمها فريق سويرف في نزال Texas Death بعد أن تمكن ستريكلاند من تثبيت هانغمان بيدج.', src).some(l => l.includes('العد لعشرة')));
  assert.ok(!claimNotInSource('في نزال Texas Death ضرب ستريكلاند بيدج بحركة House Call فلم ينهض قبل العد إلى عشرة.', src).some(l => l.includes('العد لعشرة')));
  assert.ok(claimNotInSource('Strickland pinned Page to win the Texas Death Match.', src, 'en').some(l => l.includes('العد لعشرة')));
  // a pinfall the source names stays allowed
  assert.ok(!claimNotInSource('ثبت ستريكلاند بيدج في نزال Texas Death.', src + ' Strickland scored the pinfall.').some(l => l.includes('العد لعشرة')));
});

test('All In and All Out are never swapped (MJF, INCIDENTS #1320)', () => {
  const src = "MJF hadn't appeared on AEW television since All In on August 30." + filler;
  assert.ok(claimNotInSource('حيث غاب عن عروض AEW منذ عرض AEW All Out يوم 30 أغسطس.', src).includes('All Out بدل All In'));
  assert.ok(claimNotInSource('MJF had been away since AEW All Out on August 30.', src, 'en').includes('All Out بدل All In'));
  assert.deepEqual(claimNotInSource('حيث غاب عن عروض AEW منذ عرض AEW All In يوم 30 أغسطس.', src).filter(l => l.startsWith('All')), []);
});

test('hype after an Arabic-written match name is dropped too (INCIDENTS #1320)', () => {
  assert.equal(applyCorrections('شهد العرض إقامة نزال أناركي إن ذا أرينا المثير، والذي جمع'), 'شهد العرض إقامة نزال أناركي إن ذا أرينا، والذي جمع');
});
