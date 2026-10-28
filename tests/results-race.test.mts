// INCIDENTS #910: NXT 27/10 went out twice (Fightful + Ringside News, two minutes apart), and the Fightful one
// carried a headline «فوز ولم يتم الإعلان عن نتيجة النزال…», a winner line «ولم يتم الإعلان…» and an invented win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameShowResultsAcrossRuns } from '../scripts/cross-run-dedupe';
import { showResultsKey, extraWinners } from '../scripts/fightful-watcher';
import { checkArticle, noWinnerLines } from '../scripts/news-qa';

test('a results report of a show another bot just pushed is caught across runs', () => {
  const now = Date.parse('2026-10-28T00:53:00Z');
  const ours = [{ file: 'a.md', sourceTitle: 'WWE NXT Results (10/27/2026): Jackson Drake vs. EK Prosper, Dusty Classic Semifinals, More', date: now }];
  const arrived = [{ file: 'b.md', sourceTitle: 'WWE NXT Results, Highlights and Key Moments for October 27, 2026', date: now - 120_000 }];
  assert.deepEqual(sameShowResultsAcrossRuns(ours, arrived, showResultsKey).map(h => h.matchedFile), ['b.md']);
  const lastWeek = [{ file: 'c.md', sourceTitle: 'WWE NXT Results, Highlights and Key Moments for October 20, 2026', date: now - 60_000 }];
  assert.equal(sameShowResultsAcrossRuns(ours, lastWeek, showResultsKey).length, 0);
  const raw = [{ file: 'd.md', sourceTitle: 'WWE Raw Results (10/27/2026)', date: now }];
  assert.equal(sameShowResultsAcrossRuns(ours, raw, showResultsKey).length, 0);
  assert.equal(showResultsKey('WWE NXT Results, Highlights and Key Moments for October 27, 2026').md, '10/27');
});

test('a «not announced» winner line, headline and invented win are all caught', () => {
  assert.equal(noWinnerLines('🏆 **الفائز:** ولم يتم الإعلان عن نتيجة النزال'), '🤝 **النتيجة:** لم تُعلن النتيجة');
  const title = 'نتائج عرض WWE NXT (27 أكتوبر 2026): فوز ولم يتم الإعلان عن نتيجة النزال في الحدث الرئيسي';
  const body = 'فاز فريق هانك وتانك على فريق الإخوة فاغنر.\n\n🏆 **الفائز:** ولم يتم الإعلان عن نتيجة النزال';
  const codes = checkArticle(title, body).map(i => i.code);
  assert.ok(codes.includes('title_no_result'), codes.join());
  assert.ok(codes.includes('vague_result'), codes.join());
  assert.ok(codes.includes('winner_mismatch'), codes.join());
  const ok = checkArticle('نتائج عرض WWE NXT (27 أكتوبر 2026): جاكسون دريك يدافع عن لقبه ضد إي كي بروسبر', 'تغلب نوام دار ورميو مورينو على فريق فانيتي بروجيكت.\n\n🏆 **الفائز:** نوام دار ورميو مورينو').map(i => i.code);
  assert.ok(!ok.includes('title_no_result') && !ok.includes('winner_mismatch') && !ok.includes('vague_result'), ok.join());
});

test('more winners than the source has results is blocked', () => {
  const src = 'Noam Dar & Romeo Moreno def. Vanity Project. Chantel Monroe def. Lizzy Rain. Sean Legacy def. Saquon Shugars. Dusty Rhodes Tag Team Classic: Hank and Tank vs. The Wagner Brothers';
  const three = '🏆 **الفائز:** نوام دار\n\n🏆 **الفائزة:** شانتل مونرو\n\n🏆 **الفائز:** شون ليغاسي';
  assert.equal(extraWinners(src, three), 0);
  assert.equal(extraWinners(src, three + '\n\n🏆 **الفائز:** هانك وتانك'), 1);
  assert.equal(extraWinners(src, three + '\n\n🏆 **الفائز:** ولم يتم الإعلان عن نتيجة النزال'), 0);
});
