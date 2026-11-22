import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dropQuoteTailFromTitle } from '../scripts/english-edition';
import { applyCorrections } from '../scripts/news-qa';

// INCIDENTS #1479: the Charlotte Flair story's English headline carried the source's whole pull quote (106 letters).
test('a long headline drops the pull quote after its colon', () => {
  assert.equal(
    dropQuoteTailFromTitle("Charlotte Flair Comments on 'Via Cash in' Meme: What I Love More Is That My Fans That Remembered That. I Thought the Line Was Great"),
    "Charlotte Flair Comments on 'Via Cash in' Meme");
  // short titles and colons that are not quotes stay as they are
  assert.equal(dropQuoteTailFromTitle('Rhea Ripley: She Needed Permission'), 'Rhea Ripley: She Needed Permission');
  const results = 'WWE Raw Results: Seth Rollins Faces CM Punk, Rhea Ripley Battles Iyo Sky and Gunther Defends His Title';
  assert.equal(dropQuoteTailFromTitle(results), results);
});

test('Belcastro, comics and an adjective agreement are corrected', () => {
  assert.equal(applyCorrections('وافق جو بيلاسترو على طلبها'), 'وافق جو بيلكاسترو على طلبها');
  assert.match(applyCorrections('عالم المسلسلات المصورة'), /القصص المصورة/);
  assert.match(applyCorrections('اختيار قاعات قديمة ومتهالك أثبت'), /قديمة ومتهالكة أثبت/);
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Joe Belcastro'], 'جو بيلكاسترو');
});

test('results headlines and short name-quote headlines are left alone', () => {
  for (const t of [
    'CMLL Tzompantli de Máscaras Results (11/1/2026): Volador Jr. & Bárbaro Cavernario vs. Hermanos Chávez',
    "Cody Rhodes: Brock Lesnar's Speed Was Genuinely Terrifying From a Performative Standpoint in the UFC",
  ]) assert.equal(dropQuoteTailFromTitle(t), t);
  assert.equal(dropQuoteTailFromTitle("Kyle Fletcher on Returning to Blood and Guts in the Future: I Feel Like It'll Probably Happen at Some Point"),
    'Kyle Fletcher on Returning to Blood and Guts in the Future');
});
