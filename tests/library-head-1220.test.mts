// A yearly event's library page is a short list: every "watch" action in its head points at the show itself (INCIDENTS #1220).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test("library head: a program with under four shows sends «watch» to the show, not to the list", () => {
  const njk = fs.readFileSync('pages/library-program.njk', 'utf8');
  assert.ok(njk.includes('(lp.prog.latest.url if lp.prog.count < 4 and lp.prog.latest.url else page.url)'));
  // the page body is untouched: the list stays a list
  assert.ok(njk.includes('lp.prog.count | arCount("عرض واحد مترجم"'));
});
