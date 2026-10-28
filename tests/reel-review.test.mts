// INCIDENTS #901 / #906 / #908: a Facebook reel «accepted, not confirmed» is a review
// item, never a CI failure — and the review alert must fire once, not on every run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResults, needsReviewAlert } from '../scripts/show-reel-monitor';
import { facebookReelState } from '../worker/src/video-publishing';

const ambiguous = { ok: false, ambiguous: true, id: '1234', error: 'تم قبول الفيديو ولم يتأكد ظهوره بعد؛ راجع فيسبوك.' };

test('an unconfirmed reel is parked for review instead of failing the run', () => {
  const entry = applyResults(undefined, { facebook_reel: ambiguous }, ['facebook_reel'], 'عرض');
  assert.deepEqual(entry.reviewPlatforms, ['facebook_reel']);
  assert.equal(entry.needsReview, true);
  // INCIDENTS #908: the alert fires once — the item starts unreported so CI flags it once
  assert.equal(entry.reviewNotified, false);
  assert.equal(needsReviewAlert(entry), true);
});

test('a review item alerts once, then the run stays green until something new is uncertain', () => {
  const first = applyResults(undefined, { facebook_reel: { ok: false, ambiguous: true } }, ['facebook_reel'], 'title');
  assert.equal(first.reviewNotified, false);
  assert.equal(needsReviewAlert(first), true);
  // the monitor records that it reported it
  const reported = { ...first, reviewNotified: true };
  assert.equal(needsReviewAlert(reported), false);
  // another platform going uncertain is new information: alert again
  const grown = applyResults(reported, { instagram_reel: { ok: false, status: 'uncertain' } } as any, ['instagram_reel'], 'title');
  assert.equal(grown.needsReview, true); assert.equal(grown.reviewNotified, false); assert.equal(needsReviewAlert(grown), true);
  // and when the last review item is confirmed the flag disappears completely
  const cleared = applyResults(grown, { facebook_reel: { ok: true }, instagram_reel: { ok: true } } as any, ['facebook_reel', 'instagram_reel'], 'title');
  assert.equal(cleared.needsReview, false); assert.equal(cleared.reviewNotified, undefined); assert.equal(needsReviewAlert(cleared), false);
});

test('facebookReelState finds a reel by its caption title when the id was lost', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes('/video_reels')
    ? { data: [{ id: '9', description: 'عرض اخر' }, { id: '7', description: 'عرض ان جيه بي دبليو 27.10.2026 مترجم\n\n#وسم' }] }
    : String(url).includes('/7?') ? { status: { video_status: 'ready' } } : { status: { video_status: 'processing' } }))) as any;
  try {
    assert.equal(await facebookReelState({ pageId: 'p', token: 't', title: 'عرض ان جيه بي دبليو 27.10.2026 مترجم' }), 'published');
    assert.equal(await facebookReelState({ pageId: 'p', token: 't', id: '9' }), 'pending');
    assert.equal(await facebookReelState({ pageId: 'p', token: 't', title: 'غير موجود' }), 'missing');
  } finally { globalThis.fetch = orig; }
});
