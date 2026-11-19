import test from 'node:test';
import assert from 'node:assert/strict';
import { stripBold } from '../scripts/english-edition.ts';

// The Cody Rhodes creative-role story never reached the English site: three tries came back with «## …» subheads and
// were refused as «markdown formatting» (INCIDENTS #1416). A subhead is dropped; a whole sentence only loses its «#».
test('markdown subheads are removed instead of refusing the English edition', () => {
  const body = '## Creative Ambitions\n\nCody Rhodes wants to work on the creative team one day.\n\n### Rhodes said he would love to help write the shows after he retires.\n\nHe thanked **Chelsea Green** for asking.';
  const out = stripBold(body);
  assert.ok(!/^#/m.test(out));
  assert.ok(!out.includes('Creative Ambitions'));
  assert.ok(out.includes('Rhodes said he would love to help write the shows after he retires.'));
  assert.ok(out.includes('He thanked Chelsea Green for asking.'));
  assert.ok(!/^#{1,6}\s/m.test(out) && !/\*\*/.test(out)); // what checkEnglish refuses as «markdown formatting»
});

test('a story without markdown is unchanged', () => {
  const body = 'Line one is here.\n\n> "A quote that stays."\n\nhttps://x.com/a/status/1';
  assert.equal(stripBold(body), body);
});
