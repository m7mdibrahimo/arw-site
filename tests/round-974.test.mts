// INCIDENTS #974: «داستن رودس» for Dusty Rhodes, «سابفا/قائللا», a meta description cut before its main clause,
// and «>» quotes ending with a comma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCorrections, wrestlerNotInSource } from '../scripts/news-qa';
import { fixEnglishNames } from '../scripts/english-edition.ts';
import { metaDescription } from '../lib/meta-description.cjs';

const glossary = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));

test('a relative the source does not name is caught even once (Dusty vs Dustin Rhodes)', () => {
  const source = 'Paul Heyman was a photographer at Studio 54 and booked legends like Ric Flair and Dusty Rhodes before turning 20. '.repeat(3);
  assert.ok(wrestlerNotInSource('ويستقطب أسماء لامعة مثل ريك فلير وداستن رودس في سن مبكرة.', source, glossary).includes('Dustin Rhodes'));
  assert.ok(!wrestlerNotInSource('ويستقطب أسماء لامعة مثل ريك فلير وداستي رودز في سن مبكرة.', source, glossary).includes('Dusty Rhodes'));
  // both brothers in the source: nothing to block
  const both = source + ' Dustin Rhodes later wrestled as Goldust. ';
  assert.deepEqual(wrestlerNotInSource('داستن رودس وداستي رودز', both, glossary).filter(n => /Rhodes/.test(n)), []);
});

test('the Ciampa story slips are corrected', () => {
  assert.equal(applyCorrections('بعد تحقيقه فوزا سابفا عليه'), 'بعد تحقيقه فوزا سابقا عليه');
  assert.equal(applyCorrections('قائللا إنه لا يقوى'), 'قائلا إنه لا يقوى');
  assert.equal(applyCorrections('وأعرب عن اندهاشه الشديد قدرة جيريكو'), 'وأعرب عن اندهاشه الشديد من قدرة جيريكو');
  assert.equal(applyCorrections('وأعرب عن اندهاشه الشديد من قدرة جيريكو'), 'وأعرب عن اندهاشه الشديد من قدرة جيريكو');
});

test('a description never stops inside an open «that when…» clause', () => {
  const t = 'Paul Heyman revealed that when he was working as a 19-year-old photographer at the legendary Studio 54 in New York City, management offered to pay him in cocaine instead of money. While speaking with Graham Bensinger, Heyman explained more.';
  assert.equal(metaDescription(t), 'Paul Heyman revealed that when he was working as a 19-year-old photographer at the legendary Studio 54 in New York City, management offered to pay him in cocaine instead of money.');
  const w = 'Cody Rhodes recently discussed Haku, noting that while he is widely considered the toughest wrestler of all time, he is also the sweetest person you will ever meet. More text follows here.';
  assert.match(metaDescription(w), /sweetest person/);
});

test('a «>» quote ends with a full stop, unless the next paragraph is only its attribution', () => {
  assert.equal(
    fixEnglishNames('> "That just felt like such a lay-up," \n\nHe recalled, adding that he had been a fan since he was young.'),
    '> "That just felt like such a lay-up."\n\nHe added that he had been a fan since he was young.');
  const attributed = '> "I\'m going to have to go home, regroup, and get well,"\n\nMiller shared on social media. This follows earlier problems.';
  assert.equal(fixEnglishNames(attributed), attributed);
});
