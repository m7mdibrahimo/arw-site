import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { metaDescription } = require('../lib/meta-description.cjs');

test('a description never stops inside an aside about the subject (Chad Wicks, INCIDENTS #1283)', () => {
  const d = metaDescription('Chad Wicks was reportedly arrested on November 12. PWInsider reports that Wicks, also known to fans as Chad Dick, was booked into the Winnebago County Jail in Forest City, Iowa, at 5:47 PM local time for driving with a suspended license.');
  assert.equal(d, 'Chad Wicks was reportedly arrested on November 12.');
  const e = metaDescription('An independent wrestling event in Hidalgo, Mexico, escalated into a criminal investigation after referee Gerardo German Pineda, known as El Buho, collapsed and died after a spot in the ring. The incident took place during the main event.');
  assert.ok(e.includes('Pineda (El Buho) collapsed and died'), e);
});
