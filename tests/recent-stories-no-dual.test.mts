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
