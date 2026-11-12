import test from 'node:test';
import assert from 'node:assert/strict';
import { bothInPromotionNotInSource, checkEnglish } from '../scripts/english-edition.ts';

// INCIDENTS #1260: the English Steve Austin / Bret Hart story said Hart saw Austin's potential «while they were both in
// WCW»; the source says «He saw me coming up when I was in WCW» — Hart was in the WWF.
const source = 'Austin explained that Hart had recognized his potential years earlier while he was still competing in WCW and believed they could make money together in WWE. "Bret and I were very close. He saw me coming up when I was in WCW. He knew that I was the guy that he could work with and we could make money together." That partnership eventually brought them to WrestleMania 13 on March 23, 1997, in Chicago.';

test('«both in WCW» the source never says is caught (INCIDENTS #1260)', () => {
  assert.equal(bothInPromotionNotInSource('Austin explained that Hart recognized his potential while they were both in WCW and chose to work with him.', source), 'they were both in WCW');
  const issues = checkEnglish({ title: 'Steve Austin Credits Bret Hart for Key WrestleMania 13 Moment', body: 'Austin explained that Hart recognized his potential while they were both in WCW and specifically chose to work with him following his return from knee surgery in 1996. According to Austin, the two collaborated behind the scenes to plan their match in Chicago at WrestleMania 13.', tags: [] } as any,
    { sourceTitle: 'Steve Austin Says Bret Hart Came Up With Key Moment', sourceText: source, sourceUrl: 'https://www.ringsidenews.com/x/', arabicTitle: '', arabicBody: '', federation: 'WWE', image: '' } as any);
  assert.ok(issues.some((x) => x.includes('both people in one promotion')), issues.join(' | '));
});

test('the right wording and a source that says «both» pass', () => {
  assert.equal(bothInPromotionNotInSource('Jimmy House has found success both in WWE EVOLVE and on the independent circuit.', source), null);
  assert.equal(bothInPromotionNotInSource('Hart recognized his potential while Austin was still in WCW.', source), null);
  const both = 'The Young Bucks and Kenny Omega were both in NJPW at the time and formed The Elite together. ' + 'x'.repeat(200);
  assert.equal(bothInPromotionNotInSource('The Bucks and Omega were both in NJPW when they formed The Elite.', both), null);
});
