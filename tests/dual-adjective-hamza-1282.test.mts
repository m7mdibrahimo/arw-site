// INCIDENTS #1282: «لأننا مجنونان» (Young Bucks) and «الوقت الذي قضياه معا» (Eddie Guerrero's daughter) passed every dual
// check; «إدعائه»، «نحن لست»، «احتمامات»، «يمييزني»، «الاتحادات النقابية» went live; an English description ended «…Big E. According.»
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';
const { metaDescription } = createRequire(import.meta.url)('../lib/meta-description.cjs');

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const codes = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).map((i: { code: string }) => i.code);

test('a dual adjective or a dual «قضياه» blocks publishing', () => {
  for (const b of ['قال: لأننا مجنونان بما يكفي.', 'من الوقت الذي قضياه معا.', 'سنوات طويلة قضياها في WWE.', 'هما مستعدان للنزال.'])
    assert.ok(codes(b).includes('dual_form'), b);
  for (const b of ['كانوا سعيدين جدا.', 'سعيا وراء تفاعل الجماهير.', 'الوقت الذي قضته معه.', 'قضوا يومهم في التحضير.', 'لأننا مجانين بما يكفي.'])
    assert.ok(!codes(b).includes('dual_form'), b);
});

test('spelling corrections', () => {
  assert.equal(applyCorrections('رغم إدعائه الإصابة'), 'رغم ادعائه الإصابة');
  assert.equal(applyCorrections('نحن لست مساعدين واحتمامات جديدة وهذا ما يمييزني'), 'نحن لسنا مساعدين واحتمالات جديدة وهذا ما يميزني');
  assert.equal(applyCorrections('دعوى التمييز العنصري'), 'دعوى التمييز العنصري');
  assert.equal(applyCorrections('إيجابيات وسلبيات الاتحادات النقابية وعقود منحازة طرفا واحدا'), 'إيجابيات وسلبيات النقابات وعقود منحازة لطرف واحد');
});

test('an English description never ends on a lone opening word', () => {
  const d = metaDescription('WWE reportedly considered a major creative shift for The New Day following their betrayal of Big E. According to Dave Meltzer in the Wrestling Observer Newsletter, the company discussed adding Ridge Holland as a third member.');
  assert.ok(!/According\.$/.test(d), d);
});

test('no published story has these mistakes', () => {
  for (const f of fs.readdirSync('content/news')) {
    if (!f.endsWith('.md')) continue;
    const t = fs.readFileSync(`content/news/${f}`, 'utf-8');
    assert.ok(!/(?<![ء-ي])(?:مجنونان|قضياه?|قضياها|إدعا[ءئ]|احتمامات|يمييز)/.test(t), f);
  }
});
