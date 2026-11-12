import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEnglish } from '../scripts/english-edition.ts';

// INCIDENTS #1256: the YouTube link «watch?v=gJJd504TKZI» under the Asuka/Fight Size story read as the number «504»,
// so its English edition was refused every bot run and never written.
const input = {
  sourceTitle: 'Asuka Visits SEGA Headquarters In Tokyo, WWE NXT Highlights, More | Fight Size',
  sourceText: 'Asuka visited the SEGA headquarters in Tokyo this week. WWE also posted highlights from the latest episode of NXT, including the main event. Fightful will have more on the story as it develops.',
  sourceUrl: 'https://www.fightful.com/wrestling/asuka-visits-sega-338637',
  sourceId: 338637,
  arabicTitle: 'أسوكا تزور مقر SEGA في طوكيو',
  arabicBody: 'زارت أسوكا مقر شركة SEGA في طوكيو هذا الأسبوع.',
  federation: 'WWE',
  image: '',
} as any;
const body = 'Asuka visited the SEGA headquarters in Tokyo this week, and WWE posted highlights from the latest episode of NXT, including the main event, according to Fightful.';

test('digits inside a link are not a number the source never says (INCIDENTS #1256)', () => {
  for (const link of ['https://www.youtube.com/watch?v=gJJd504TKZI', '<https://www.youtube.com/watch?v=gJJd504TKZI>']) {
    const issues = checkEnglish({ title: 'Asuka Visits SEGA Headquarters in Tokyo', body: `${body}\n\n${link}`, tags: [] }, input);
    assert.ok(!issues.some((x) => x.startsWith('number not in source')), issues.join(' | '));
  }
});

test('a made-up number in the prose still blocks the English edition', () => {
  const issues = checkEnglish({ title: 'Asuka Visits SEGA Headquarters in Tokyo', body: body + ' The visit drew 504 fans.', tags: [] }, input);
  assert.ok(issues.some((x) => x.startsWith('number not in source: 504')), issues.join(' | '));
});
