import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// An Arabic aria-label / title / alt without an entry in lib/i18n/en.cjs stays Arabic on /en/ («أحدث العروض الخاصة»
// on the English home page, INCIDENTS #492).
test('every Arabic aria-label in index.njk has an English translation', () => {
  const en = require('../lib/i18n/en.cjs');
  const dict = (en && (en.default || en.PHRASES || en)) as Record<string, string>;
  const src = fs.readFileSync(new URL('../index.njk', import.meta.url), 'utf8');
  const missing: string[] = [];
  for (const m of src.matchAll(/aria-label="([^"{}]*[؀-ۿ][^"{}]*)"/g)) {
    const text = m[1].trim();
    if (!fs.readFileSync(new URL('../lib/i18n/en.cjs', import.meta.url), 'utf8').includes(JSON.stringify(text))) missing.push(text);
  }
  assert.deepEqual(missing, []);
  assert.ok(dict);
});

// «برامج أخرى من X» (the other programs of a promotion) was left in Arabic on 50 English library pages — the build
// listed it as «still Arabic» for rounds (INCIDENTS #636).
test('the library page "more programs of this promotion" row has English lines', () => {
  const dict = fs.readFileSync(new URL('../lib/i18n/en.cjs', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../pages/library-program.njk', import.meta.url), 'utf8');
  const nav = /<nav class="lib-sibs" aria-label="([^"]+)"><h2>([^<]*?)<bdi>/.exec(src);
  assert.ok(nav, 'lib-sibs row not found');
  assert.ok(dict.includes(JSON.stringify(nav[1].trim())), nav[1]);
  assert.ok(dict.includes(JSON.stringify(`${nav[2].trim()} {0}`)), nav[2]);
});
