import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('a famous team the source never names is blocked (King Bees written «ذا جادجمنت داي», INCIDENTS #1472)', async () => {
  const { wrestlerNotInSource } = await import('../scripts/news-qa.ts');
  const source = 'New Texas Pro and West Coast Pro Present Marvelous Pro Wrestling Results. Mio Momono def. Miko Alana. Sora Ayame def. Kalientita. Magenta (Maria & RIKO) def. King Bees (Danni Bee & Charity King). Senka Akatsuki def. Anarkid Ash.';
  const body = 'نجح ثنائي ماري وريكو في الانتصار على فريق ذا جادجمنت داي (داني بي وتشاريتي كينغ).';
  assert.ok(wrestlerNotInSource(body, source, {}).includes('Judgment Day'));
  assert.ok(!wrestlerNotInSource('نجح فريق ماجينتا في الانتصار على فريق كينغ بيز.', source, {}).includes('Judgment Day'));
  assert.ok(!wrestlerNotInSource(body, source + ' The Judgment Day appeared too.', {}).includes('Judgment Day'));
});

test('a description never ends on «located.» (INCIDENTS #1472)', () => {
  const { metaDescription } = require('../lib/meta-description.cjs');
  const d = metaDescription('New Texas Pro Wrestling and West Coast Pro Wrestling joined forces to produce a joint show on November 21 originating from Pinballz Lake Creek located in Austin, Texas. According to Fightful, the card was broadcast live on YouTube.');
  assert.ok(!/located\.$/.test(d), d);
  assert.ok(d.endsWith('Austin, Texas.'), d);
});

test('the title date follows the body when the source headline and text disagree by a day (INCIDENTS #1472)', async () => {
  const { alignTitleDateToSource } = await import('../scripts/fightful-watcher');
  const t = 'نتائج عرض Marvelous Pro Wrestling (21 نوفمبر 2026): ميو مومونو تهزم ميكو ألانا';
  const src = 'https://www.fightful.com/?p=340264 New Texas Pro and West Coast Pro Present Marvelous Pro Wrestling Results (11/20)';
  assert.equal(alignTitleDateToSource(t, src, 'أقام الاتحاد العرض يوم 21 نوفمبر في أوستن.'), t);
  assert.equal(alignTitleDateToSource(t, src), t.replace('21 نوفمبر', '20 نوفمبر'));
  assert.equal(alignTitleDateToSource(t, src, 'أقيم العرض يوم 20 نوفمبر.'), t.replace('21 نوفمبر', '20 نوفمبر'));
});
