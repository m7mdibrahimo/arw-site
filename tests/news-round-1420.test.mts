import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCorrections, checkArticle } from '../scripts/news-qa.ts';
import { isUnrelatedNameTag } from '../scripts/fightful-watcher.ts';
import { fixEnglishNames } from '../scripts/english-edition.ts';
const require = createRequire(import.meta.url);
const { metaDescription } = require('../lib/meta-description.cjs');

test('a «now known as» aside before «, and» after «between» keeps both sides (Santos Escobar, INCIDENTS #1420)', () => {
  const d = metaDescription('Things are tense between former WWE star Santos Escobar, now known as Romeo Malverde, and promoter Christopher Ruffus after a flight cancellation turned into a financial dispute over a $500 deposit. Salvatore Wrestling Promotions publicly criticized Malverde on Facebook.');
  assert.ok(d.includes('Christopher Ruffus'), d);
});

test('«50 percentage retainer» becomes «50 percent retainer»', () => {
  assert.equal(fixEnglishNames('bookings require a 50 percentage retainer'), 'bookings require a 50 percent retainer');
  assert.equal(fixEnglishNames('a 2 percentage point drop'), 'a 2 percentage point drop');
});

test('typos and a doubled first name are corrected', () => {
  assert.equal(applyCorrections('مستشهبة بتجربة أسوكا'), 'مستشهدة بتجربة أسوكا');
  assert.equal(applyCorrections('عدم توفر وقت كافي لإنجاز'), 'عدم توفر وقت كاف لإنجاز');
  assert.equal(applyCorrections('منحه وقتا كافيا'), 'منحه وقتا كافيا');
  assert.equal(applyCorrections('بالمسيرة المميزة لفيكي فيكي غيريرو'), 'بالمسيرة المميزة لفيكي غيريرو');
});

test('a doubled word with «ل/ب» glued to the first copy blocks publishing', () => {
  const codes = checkArticle('زيلينا فيغا تكشف موعد اعتزالها المحتمل داخل الحلبة', 'تحدثت زيلينا فيغا عن مستقبلها. '.repeat(10) + 'متأثرة بالمسيرة المميزة لفيكي فيكي غيريرو في هذا المجال.', []).map((i) => i.code);
  assert.ok(codes.includes('repeated_word'), codes.join());
});

test('a glossary name tag without its «ذا» is dropped when the story never names him', () => {
  assert.equal(isUnrelatedNameTag('أندرتيكر', 'زيلينا فيغا تكشف موعد اعتزالها', 'مستشهدة بتجربة أسوكا'), true);
  assert.equal(isUnrelatedNameTag('أندرتيكر', 'أندرتيكر يعود', 'نص'), false);
});
