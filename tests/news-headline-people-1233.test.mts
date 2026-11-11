// INCIDENTS #1233: every person a news headline names goes in `about`, in headline order (not only the first)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { headlinePeople, personMentions, englishPersonMentions } = require('../lib/wrestler-mentions.cjs');

test('Arabic headline with two wrestlers: both are subjects, in order', () => {
  const h = 'شون مايكلز يحتفل بظهور كروز مونتانا الأول في عرض WWE Raw';
  const names = headlinePeople(h, personMentions(h, 4, [])).map((m: any) => m.name);
  assert.deepEqual(names, ['شون مايكلز', 'كروز مونتانا']);
});

test('English headline: order kept, tag-only people left out, capped at three', () => {
  const h = 'Randy Orton Says He Will Be Back After Losing To Cody Rhodes';
  const m = englishPersonMentions(h).concat([{ name: 'Seth Rollins' }]);
  assert.deepEqual(headlinePeople(h, m).map((x: any) => x.name), ['Randy Orton', 'Cody Rhodes']);
  const many = [{ name: 'A1' }, { name: 'B2' }, { name: 'C3' }, { name: 'D4' }];
  assert.equal(headlinePeople('D4 B2 A1 C3', many).length, 3);
  assert.deepEqual(headlinePeople('WWE Announces New Event', []), []);
});
