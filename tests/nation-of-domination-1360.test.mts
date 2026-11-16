// INCIDENTS #1360: «فريق ذا نظيرة دي إن أن» (Nation of Domination) and «خلال المشر العقد الماضي» reached stories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Nation of Domination is in the glossary and its garbled form is corrected', async () => {
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Nation of Domination'], 'ذا نيشن أوف دومينيشن');
  assert.equal(names['JC Mateo'], 'جيه سي ماتيو');
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('العضو السابق في فريق ذا نظيرة دي إن أن قال'), 'العضو السابق في فريق ذا نيشن أوف دومينيشن قال');
  assert.equal(applyCorrections('واجهتهن خلال المشر العقد الماضي'), 'واجهتهن خلال العقد الماضي');
  const bad = fs.readdirSync('content/news').filter(f => f.endsWith('.md') && /نظيرة دي إن أن|المشر العقد/.test(fs.readFileSync(`content/news/${f}`, 'utf8').replace(/^permalink:.*$/m, '')));
  assert.deepEqual(bad, []);
});
