// INCIDENTS #1236: the Last Resort results wrote Jimmy Jacobs «حكما خاصا» (the source: special enforcer), glued
// «Corporal Robinson, Hy-Zaya» into one name, dropped the «2» of 2 Tuff Tony, and the TKO story wrote
// «أن الإدارة تفضيل الأرباح».
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixEnforcerAsReferee, fixJoinedListedNames, applyCorrections } from '../scripts/news-qa.ts';
import fs from 'node:fs';

const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));

test('a special enforcer is not written as the referee', () => {
  const src = 'In an IWA World Championship match with Jimmy Jacobs serving as the special enforcer, Connor Hopkins defeated Aaron Williams.';
  assert.equal(fixEnforcerAsReferee('شهد النزال وجود جيمي جاكوبز حكما خاصا', src), 'شهد النزال وجود جيمي جاكوبز مراقبا خاصا');
  assert.equal(fixEnforcerAsReferee('ميكي جيمس حكما خاصا', 'Mickie James will be the special guest referee'), 'ميكي جيمس حكما خاصا');
});

test('two wrestlers the source lists one after the other keep their «و»', () => {
  const src = 'IWA Originals (2 Tuff Tony, Corporal Robinson, Hy-Zaya, Mad Man Pondo, Nate Webb, and Todd Morton) defeated Jordan Dye.';
  assert.equal(fixJoinedListedNames('المكون من تو تاف توني وكوربورال روبنسون هاي-زايا وماد مان بوندو', src, names),
    'المكون من تو تاف توني وكوربورال روبنسون وهاي-زايا وماد مان بوندو');
  assert.equal(fixJoinedListedNames('كوربورال روبنسون وهاي-زايا', src, names), 'كوربورال روبنسون وهاي-زايا');
});

test('the corrections fix the verbal-noun slip, 2 Tuff Tony and the empty scramble sentence', () => {
  assert.equal(applyCorrections('يرى العاملون أن الإدارة تفضيل الأرباح'), 'يرى العاملون أن الإدارة تفضل الأرباح');
  assert.equal(applyCorrections('المكون من توف توني'), 'المكون من تو تاف توني');
  assert.equal(applyCorrections('تفوق في نزال السكرامبل كل من الأطراف المشاركة، حيث فازت راشيل'), 'في نزال السكرامبل، فازت راشيل');
});
