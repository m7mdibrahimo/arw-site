// INCIDENTS #976: «بول هيمان» for Paul Heyman, «وبداياته في بداياته في», an English description ending
// «…and approaching.», and the themed «AEW Fright Night Dynamite» episode losing every Dynamite name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, autoFix } from '../scripts/news-qa';
import { metaDescription } from '../lib/meta-description.cjs';
import { showNameForms, showAliasesFor } from '../lib/show-seo.cjs';

test('Paul Heyman is written as in the glossary, with joined prefixes too', () => {
  assert.equal(applyCorrections('خيانة بول هيمان لرومان، ليرد هيمان'), 'خيانة بول هايمن لرومان، ليرد هايمن');
  assert.equal(applyCorrections('تحالفه مع بول هيمان ولهيمان'), 'تحالفه مع بول هايمن ولهايمن');
  assert.equal(applyCorrections('بول هايمن'), 'بول هايمن');
});

test('two words repeated with «و» joined to the first copy are said once', () => {
  assert.equal(autoFix('خلال فترة شبابه وبداياته في بداياته في المصارعة.'), 'خلال فترة شبابه وبداياته في المصارعة.');
  assert.equal(autoFix('وفي يوم في يوم آخر'), 'وفي يوم في يوم آخر');
});

test('a word cut never leaves «and <verb>ing» without its object', () => {
  const t = 'Chris Jericho recently revealed that a television series based on his early professional wrestling career is currently in development and approaching the pilot filming stage. During an interview he explained more.';
  assert.equal(metaDescription(t), 'Chris Jericho recently revealed that a television series based on his early professional wrestling career is currently in development.');
});

test('a themed episode keeps its program names and dates', () => {
  const args = { headline: 'عرض داينامايت 28.10.2026 مترجم', title: 'AEW Fright Night Dynamite 28.10.2026', programName: 'AEW Dynamite', eventDate: '2026-10-28', aliases: ['عرض داينامايت', 'ديناميت', 'AEW Dynamite'], isShow: true };
  const forms = showNameForms(args);
  assert.ok(forms.includes('AEW Dynamite October 28 2026'), 'the program name with the date');
  assert.ok(forms.includes('AEW Fright Night Dynamite October 28 2026'), 'its own name with the date');
  assert.ok(forms.some(f => /^ديناميت 28/.test(f)), 'the other Arabic spelling with the date');
  assert.ok(!forms.includes('AEW October 28 2026'));
  assert.deepEqual(showAliasesFor(args), args.aliases);
});

test('a special, a pre-show and a qualifier still do not claim the program names', () => {
  const special = showNameForms({ headline: 'عرض سي ام ال ال دي ا دي مويرتوس 26.10.2026 مترجم', title: 'CMLL Dia De Muertos Puebla 26.10.2026', programName: 'CMLL Lunes Clasico', eventDate: '2026-10-26', aliases: ['عرض لونيس كلاسيكو', 'CMLL Lunes Clasico'], isShow: true });
  assert.ok(!special.some(f => /Lunes Clasico|لونيس/.test(f)));
  const qual = showAliasesFor({ headline: 'عرض سي ام ال ال 20.10.2026', title: 'CMLL Selectivo Rumbo a MR and MISS CMLL', programName: 'CMLL Mr and Miss', aliases: ['عرض مستر اند ميس', 'CMLL Mr and Miss'] });
  assert.deepEqual(qual, []);
  const pre = showAliasesFor({ headline: 'عرض ام ال بي 20.10.2026', title: 'MLP Countdown Northern Rising', programName: 'MLP Northern Rising', aliases: ['عرض نورثرن رايزينج', 'MLP Northern Rising'] });
  assert.ok(!pre.includes('عرض نورثرن رايزينج'));
});
