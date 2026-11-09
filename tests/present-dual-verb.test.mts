import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { presentDualVerb, checkArticle } from '../scripts/news-qa';

// «داميان بريست ولولا فايس يخطفان الأنظار…» went live: the dual_form lists name verbs one by one and «يخطفان»
// was not among them — 27 stories in two weeks had a present dual verb (INCIDENTS #1157).
test('any present-tense dual verb is caught', () => {
  for (const s of ['داميان بريست ولولا فايس يخطفان الأنظار', 'سيث رولينز وبيكي لينش يحضران مباراة', 'أن كازاريان وستايلز سيلعبان معا', 'الشخصية التي يجسدانها', 'فريقان تقتحمان', 'ستتواجهان في العرض', 'وتبقيان معا']) {
    assert.ok(presentDualVerb(s), s);
  }
  const issues = checkArticle('داميان بريست ولولا فايس يخطفان الأنظار في العرض الأول لفيلم Steps', 'نص الخبر.');
  assert.ok(issues.some((i) => i.code === 'dual_form' && i.severity === 'error' && i.field === 'title'));
});

test('plural verbs and names are left alone', () => {
  for (const s of ['يخطفون الأنظار', 'يحضرون مباراة', 'تريستان أركارا وتايران وستروومان', 'تيرانس تشاتمان', 'أمر لا يستهان به', 'في اليونان', 'أرمان تساروكيان', 'تواصل', 'يعلن']) {
    assert.equal(presentDualVerb(s), null, s);
  }
});

test('no story published since 2026-10-26 has a present dual verb', () => {
  const dir = 'content/news';
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = raw.match(/^---[\s\S]*?---/)?.[0] || '';
    if (((fm.match(/^published_at: (.*)$/m) || [])[1] || '') < '2026-10-26') continue;
    const text = (fm.match(/^title:.*$/m)?.[0] || '') + '\n' + raw.slice(fm.length).replace(/https?:\/\/\S+/g, '');
    const w = presentDualVerb(text);
    if (w) bad.push(`${f.slice(0, 40)}: ${w}`);
  }
  assert.deepEqual(bad, []);
});
