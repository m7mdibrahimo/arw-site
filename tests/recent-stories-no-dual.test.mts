import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkArticle } from '../scripts/news-qa';

// INCIDENTS #702: a hand fix of the Hardy story wrote «قد خاضا» — the dual-form ban is only enforced by the
// publishing pipeline, so a manual edit to a published story slipped past it. The newest stories must stay clean.
test('the newest Arabic stories contain no dual verbs or dual nouns', () => {
  const dir = 'content/news/';
  const files = fs.readdirSync(dir).filter(f => /^\d{14}-.*\.md$/.test(f)).sort().slice(-80);
  const bad: string[] = [];
  for (const f of files) {
    const m = fs.readFileSync(dir + f, 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const title = (m[1].match(/^title:\s*"?(.*?)"?$/m) || [])[1] || '';
    for (const i of checkArticle(title, m[2])) if (i.code === 'dual_form' || i.code === 'dual_noun') bad.push(`${f}: ${i.excerpt}`);
  }
  assert.deepEqual(bad, []);
});

// INCIDENTS #723: «واحتفظتا باللقب» (dual verb with a و prefix) slipped through because the pattern for
// احتفظ/تغلب/هزم…+تا only allowed a ل prefix. A prefixed dual verb must now be caught.
test('dual verbs carrying a و/ف prefix are caught', () => {
  for (const w of ['واحتفظتا باللقب', 'فاحتفظا باللقب', 'وتغلبتا على الفريق']) {
    const codes = checkArticle('عنوان', `نجح الثنائي في الفوز ${w} لمدة طويلة.`).map(i => i.code);
    assert.ok(codes.includes('dual_form'), w);
  }
});

// INCIDENTS #726: «حيث التقيتا سابقا» (dual verb of التقى) passed because only التقيا was listed.
test('dual التقى/تواجه forms with تا are caught', () => {
  for (const w of ['حيث التقيتا سابقا', 'حيث التقتا سابقا', 'وقد تواجهتا في يونيو']) {
    const codes = checkArticle('عنوان', `تحدث الصحفي عن النزال المنتظر ${w} في الحلبة.`).map(i => i.code);
    assert.ok(codes.includes('dual_form'), w);
  }
});

// INCIDENTS #751: «سيتحالفان»، «تراجعا عنه»، «ليقررا» (dual verbs) and a stray «</p><p>» in a story body passed the checks.
test('dual verbs سيتحالفان/تراجعا/ليقررا and a stray </p><p> are caught', () => {
  for (const w of ['الثنائي سيتحالفان معا', 'لكنهما تراجعا عنه', 'ليقررا الاستقرار']) {
    const codes = checkArticle('عنوان', `تحدث الصحفي عن النزال المنتظر ${w} في الحلبة.`).map(i => i.code);
    assert.ok(codes.includes('dual_form'), w);
  }
  const codes = checkArticle('عنوان', 'تحدث المصارع عن النزال المنتظر في الحلبة.</p><p>خلال مقابلة حديثة قال إنه سعيد جدا بذلك.').map(i => i.code);
  assert.ok(codes.includes('artifact'));
});

// Time-period duals («الأسبوعين الثاني والثالث» in the AAA Heroes Inmortales story) passed because only noun duals of
// match words were listed. They are now dual_noun too.
test('dual time words (أسبوعين/شهرين/عامين/ساعتين…) are caught', () => {
  for (const w of ['الأسبوعين الثاني والثالث', 'خلال الشهرين الماضيين', 'قبل عامين', 'منذ يومين', 'بعد ساعتين']) {
    const codes = checkArticle('عنوان', `سجل الاتحاد ${w} من العرض الكبير.`).map(i => i.code);
    assert.ok(codes.includes('dual_noun'), w);
  }
  assert.ok(!checkArticle('عنوان', 'سجل الاتحاد الأسبوع الثاني والأسبوع الثالث من العرض.').some(i => i.code === 'dual_noun'));
});
