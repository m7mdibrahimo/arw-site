// INCIDENTS #980: an English description cut after a name and its appositive (no verb), «أعداد مشاهدين العرض»,
// «نك» for Nick. INCIDENTS #981: a recap's VideoObject claimed the full show's names and competed with the show page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCorrections } from '../scripts/news-qa';

const require = createRequire(import.meta.url);
const { metaDescription } = require('../lib/meta-description.cjs');
const { recapOnlyNames } = require('../lib/show-seo.cjs');

test('a description never ends on a name and its appositive without the verb', () => {
  const lead = 'Tenshin Nasukawa will no longer participate in an upcoming bout. TEAM TENSHIN, the group backing the former MMA fighter, kickboxer, and active boxer, is staging an event on October 31st at Matsudo Central Park in Chiba, Japan.';
  const d = metaDescription(lead);
  assert.equal(d, 'Tenshin Nasukawa will no longer participate in an upcoming bout.');
});

test('a normal clause cut still keeps its clause', () => {
  const lead = 'Kit Wilson recently criticized Roman Reigns in a new interview with The Sportster, according to Fightful, while being asked to rank wrestlers by toxicity and other things that matter to him a lot.';
  const d = metaDescription(lead);
  assert.ok(d.startsWith('Kit Wilson recently criticized Roman Reigns'), d);
});

test('«مشاهدين العرض» and «نك» are corrected before publishing', () => {
  assert.equal(applyCorrections('عندما تتراجع أعداد مشاهدين العرض'), 'عندما تتراجع أعداد مشاهدي العرض');
  assert.equal(applyCorrections('فاز نك واين على ونك جاكسون'), 'فاز نيك واين على ونيك جاكسون');
  assert.equal(applyCorrections('جو كروبشوت برقم -340 بنك كلاين'), 'جو كروبشوت برقم -340 بنيك كلاين');
  // «البنك» and a word that only ends in «نك» stay
  assert.equal(applyCorrections('البنك المركزي'), 'البنك المركزي');
});

test('a recap video keeps only recap names, not the full show names', () => {
  const names = ['عرض سماك داون الاخير مترجم كامل', 'عرض سماك داون مترجم', 'WWE Smackdown October 23 2026', 'سماك داون 23.10.2026',
    'ملخص عرض سماك داون 23/10/2026', 'WWE Smackdown Highlights October 23 2026', 'نتائج سماك داون', 'اخر ملخص سماك داون', 'WWE Smackdown 2026 results'];
  assert.deepEqual(recapOnlyNames(names), ['ملخص عرض سماك داون 23/10/2026', 'WWE Smackdown Highlights October 23 2026', 'نتائج سماك داون', 'اخر ملخص سماك داون', 'WWE Smackdown 2026 results']);
});
