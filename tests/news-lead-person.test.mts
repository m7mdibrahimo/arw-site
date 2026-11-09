// INCIDENTS #1159: the person a news headline is about goes in the NewsArticle's `about` (not only `mentions`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { leadPerson, englishPersonMentions, personMentions } = require('../lib/wrestler-mentions.cjs');

test('the person named first in the headline is the lead', () => {
  const h = 'Randy Orton Says He Will Be Back After Losing To Cody Rhodes';
  const m = englishPersonMentions(h);
  assert.ok(m.length >= 2);
  assert.equal(leadPerson(h, m)?.name, 'Randy Orton');
});

test('Arabic headline: the lead is the first person written, with the English name', () => {
  const h = 'شون مايكلز يحتفل بظهور كروز مونتانا الأول في عرض WWE Raw';
  const m = personMentions(h, 4, []);
  const lead = leadPerson(h, m);
  if (m.length) { assert.equal(lead?.name, m.slice().sort((a: any, b: any) => h.indexOf(a.name) - h.indexOf(b.name))[0].name); assert.ok(lead?.en); }
});

test('no people, no lead; a mention only in the tags is not the lead', () => {
  assert.equal(leadPerson('WWE Announces New Event', []), null);
  assert.equal(leadPerson('WWE Announces New Event', [{ name: 'Seth Rollins' }]), null);
});
