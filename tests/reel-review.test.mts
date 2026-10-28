// INCIDENTS #901: a Facebook reel «accepted, not confirmed» failed the reel workflow every 15 minutes until cleared by hand
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResults, settleReview, REVIEW_GRACE_MS } from '../scripts/show-reel-monitor';
import { facebookReelState } from '../worker/src/video-publishing';

const ambiguous = { ok: false, ambiguous: true, id: '1234', error: 'تم قبول الفيديو ولم يتأكد ظهوره بعد؛ راجع فيسبوك.' };

test('an unconfirmed reel keeps its Facebook video id for the next run', () => {
  const entry = applyResults(undefined, { facebook_reel: ambiguous }, ['facebook_reel'], 'عرض');
  assert.deepEqual(entry.reviewPlatforms, ['facebook_reel']);
  assert.equal(entry.reviewIds?.facebook_reel, '1234');
});

test('a reel Facebook published is settled as done, a failed one goes back to retry, a pending one waits', () => {
  const now = Date.now();
  const entry = { ...applyResults(undefined, { facebook_reel: ambiguous }, ['facebook_reel'], 'عرض'), lastAttempt: now - 60_000 };
  const done = settleReview(entry, 'facebook_reel', 'published', now);
  assert.equal(done.entry.facebook_reel, true); assert.equal(done.entry.needsReview, false); assert.equal(done.failing, false);
  assert.equal(done.entry.reviewIds, undefined); assert.equal(done.entry.errors?.facebook_reel, undefined);
  const failed = settleReview(entry, 'facebook_reel', 'failed', now);
  assert.equal(failed.entry.facebook_reel, false); assert.equal(failed.entry.needsReview, false);
  const pending = settleReview(entry, 'facebook_reel', 'pending', now);
  assert.equal(pending.entry.needsReview, true); assert.equal(pending.failing, false);
  assert.equal(settleReview(entry, 'facebook_reel', 'unknown', now + REVIEW_GRACE_MS + 1).failing, true);
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
