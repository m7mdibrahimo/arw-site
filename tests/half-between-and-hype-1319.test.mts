import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCorrections } from '../scripts/news-qa.ts';
const require = createRequire(import.meta.url);
const { metaDescription } = require('../lib/meta-description.cjs');

test('a description never names one side of a «between» (DMX/Anarchy story, INCIDENTS #1319)', () => {
  const d = metaDescription("The 2026 AEW Full Gear pay-per-view featured an Anarchy in the Arena match between The Cut, consisting of Jay White, Ace Austin, Austin Gunn, Clark Connors, Colten Gunn, and David Finlay, and the team of Jon Moxley, Daniel Garcia, Gabe Kidd, Orange Cassidy, Kyle O’Reilly, and Roderick Strong, according to Fightful.");
  assert.equal(d, 'The 2026 AEW Full Gear pay-per-view featured an Anarchy in the Arena match.');
  // both sides named: it stays
  const e = metaDescription('Nick Wayne secured a victory over Chris Jericho at AEW WrestleDream. This marked the third singles match between the two stars.');
  assert.ok(e.endsWith('between the two stars.'), e);
});

test('the bot\'s hype words, misspelled names and heavy idioms are corrected (INCIDENTS #1319)', () => {
  assert.equal(applyCorrections('شهد العرض إقامة نزال Anarchy in the Arena المثير بين الفريقين'), 'شهد العرض إقامة نزال Anarchy in the Arena بين الفريقين');
  assert.equal(applyCorrections('وانتهى النزال المثير بفوز موني'), 'وانتهى النزال بفوز موني');
  assert.equal(applyCorrections('وكايل أورايلي وروودريك سترونغ'), 'وكايل أورايلي وروديريك سترونج');
  assert.equal(applyCorrections('وأردت قطع دابر هذه الشائعات'), 'وأردت إنهاء هذه الشائعات');
  assert.equal(applyCorrections('أنني لن اعتزل الآن'), 'أنني لن أعتزل الآن');
  assert.equal(applyCorrections('حتى كرر الحكم العد لثلاث'), 'حتى أكمل الحكم العد لثلاث');
  assert.equal(applyCorrections('بعيدا عن انتباه الحكم أوبري إدواردز'), 'بعيدا عن انتباه الحكمة أوبري إدواردز');
});
