// A name never says the same thing twice in a row (owner 2026-10-12: «TNA TNA Bound For Glory» — «متتكررش تاني ابدا في
// اي حاجة تانية», INCIDENTS #462)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { collapseRepeatedNames as panel } from '../studio/js/names.js';
import { collapseRepeatedNames as build } from '../lib/names.cjs';
import { dropTimezoneFromTitle } from '../scripts/news-qa';

const CASES: [string, string][] = [
  ['TNA TNA Bound For Glory', 'TNA Bound For Glory'],
  ['TNA tna Slammiversary', 'TNA Slammiversary'],
  ['عرض عرض الرو', 'عرض الرو'],
  ['WWE Raw WWE Raw', 'WWE Raw'],
  ['تغطية شاملة لنتائج عرض WWE RAW WWE RAW (3 أغسطس 2026)', 'تغطية شاملة لنتائج عرض WWE RAW (3 أغسطس 2026)'],
  ['Bang Bang Gang', 'Bang Bang Gang'],
  ['بانغ بانغ غانغ', 'بانغ بانغ غانغ'],
  ['AEW Collision', 'AEW Collision'],
];

test('the panel, the site build and the bots clean a repeated name the same way', () => {
  for (const [given, want] of CASES) {
    assert.equal(panel(given), want, given);
    assert.equal(build(given), want, given);
  }
  assert.equal(dropTimezoneFromTitle('نتائج عرض WWE RAW WWE RAW (3 أغسطس 2026)'), 'نتائج عرض WWE RAW (3 أغسطس 2026)');
});

test('the panel server cleans every name field before it saves, and leaves the text alone', async () => {
  const { cleanNameFields } = await import('../worker/src/studio');
  const out = cleanNameFields('---\nfederation: TNA\nprogram_name: TNA TNA Bound For Glory\nheadline: "عرض عرض تي ان ايه"\n---\nTNA TNA in the body stays\n');
  assert.match(out, /^program_name: TNA Bound For Glory$/m);
  assert.match(out, /^headline: "عرض تي ان ايه"$/m);
  assert.match(out, /TNA TNA in the body stays/);
  assert.match(fs.readFileSync('studio/js/views/editor.js', 'utf8'), /for \(const k of NAME_FIELDS\) if \(typeof S\.data\[k\] === 'string'\) S\.data\[k\] = collapseRepeatedNames\(S\.data\[k\]\);/);
  assert.match(fs.readFileSync('content/content.11tydata.js', 'utf8'), /program_name: \(data\) => collapseRepeatedNames\(data\.program_name\)/);
});

test('no published show, recap, nostalgia episode or story repeats a name', () => {
  const bad: string[] = [];
  for (const d of ['content/shows', 'content/recaps', 'content/nostalgia', 'content/news', 'content/news-en']) {
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.md'))) {
      let data: any;
      try { data = matter(fs.readFileSync(path.join(d, f), 'utf8')).data; } catch { continue; }
      for (const k of ['title', 'headline', 'program_name', 'library_federation']) {
        if (typeof data[k] === 'string' && build(data[k]) !== data[k]) bad.push(`${d}/${f} ${k}: ${data[k]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
