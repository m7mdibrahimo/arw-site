// Psycho Circus (the AAA stable) is not Psycho Clown (one wrestler) — a story called the stable «فريق سايكو كلاون» (INCIDENTS #842)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const names = JSON.parse(fs.readFileSync(new URL('../scripts/wrestler-names.json', import.meta.url), 'utf8'));

test('glossary keeps the Psycho Circus stable apart from Psycho Clown', () => {
  assert.equal(names['Psycho Circus'], 'سايكو سيركس');
  assert.equal(names['Psycho Clown'], 'سايكو كلاون');
});

test('no story calls the Psycho Circus stable «فريق سايكو كلاون»', () => {
  for (const f of fs.readdirSync(new URL('../content/news-en/', import.meta.url))) {
    const en = fs.readFileSync(new URL(`../content/news-en/${f}`, import.meta.url), 'utf8');
    if (!/Psycho Circus/.test(en)) continue;
    const id = en.match(/^source_id:\s*"?(\d+)/m)?.[1];
    if (!id) continue;
    for (const ar of fs.readdirSync(new URL('../content/news/', import.meta.url))) {
      const t = fs.readFileSync(new URL(`../content/news/${ar}`, import.meta.url), 'utf8');
      if (new RegExp(`^source_id:\\s*"?${id}"?\\s*$`, 'm').test(t)) assert.ok(!/فريق سايكو كلاون/.test(t), ar);
    }
  }
});
