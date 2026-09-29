import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliverOnce, authorizeAdmin } from '../worker/src/delivery';
import { finishPublication, publishFacebookVideo, publishInstagramVideo, mustRetainVideo, publishTikTokVideo } from '../worker/src/video-publishing';
import worker, { runWatcherPoll } from '../worker/src/index';
import { showUrl, findReelVideo, applyResults, isShowEligible, shouldProcessShow, hasRealFailure, retryDelayMs, takePlatformBudget } from '../scripts/show-reel-monitor';
import { toPagesRedirects } from '../lib/redirects.cjs';
import { applyProofEdits } from '../scripts/editorial';
import { checkArticle, autoFix, headUnheadedMatches, applyCorrections } from '../scripts/news-qa';
import { sanitizeWrestlingTerms, findLikelyDuplicateStory, findLikelyDuplicateStoryByTagsAndBody, buildNamesGlossaryHint, isEmptyResultsStub, clearlyDifferentStories } from '../scripts/fightful-watcher';

const env = { GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'test-token' };
function ledger() {
  const records = new Map<string, { sha: string; content: string }>();
  let revision = 0;
  return { records, fetch: async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.github.com', 'tests must never reach a publishing service');
    const key = url.pathname;
    if (init.method !== 'PUT') {
      const entry = records.get(key);
      return entry ? Response.json(entry) : new Response('', { status: 404 });
    }
    const data = JSON.parse(init.body);
    if (records.get(key)?.sha !== data.sha) return new Response('', { status: 409 });
    records.set(key, { sha: String(++revision), content: data.content });
    return Response.json({ content: { sha: String(revision) } });
  } };
}

test('concurrent requests and later retries send a publication only once', async t => {
  const store = ledger(); t.mock.method(globalThis, 'fetch', store.fetch);
  let sends = 0;
  const send = async () => { sends++; await new Promise(r => setTimeout(r, 10)); return { ok: true, id: 'post-1' }; };
  const results = await Promise.all([deliverOnce(env, 'one', send), deliverOnce(env, 'one', send)]);
  assert.equal(sends, 1); assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal((await deliverOnce(env, 'one', send)).status, 'already_sent');
  assert.equal(sends, 1);
});
test('a platform still processing is re-checked in 5 minutes and reported as processing meanwhile', async t => {
  t.mock.method(globalThis, 'fetch', ledger().fetch);
  let sends = 0;
  const send = async () => { sends++; return { ok: false, status: 'processing', error: 'still encoding' }; };
  const t0 = Date.now();
  assert.equal((await deliverOnce(env, 'ig', send, { retryMs: 45 * 60_000 })).status, 'processing');
  // Within the recheck window: no second send, and the gate still says "processing".
  assert.equal((await deliverOnce(env, 'ig', send, { retryMs: 45 * 60_000 })).status, 'processing');
  assert.equal(sends, 1);
  t.mock.method(Date, 'now', () => t0 + 6 * 60_000);
  await deliverOnce(env, 'ig', send, { retryMs: 45 * 60_000 });
  assert.equal(sends, 2);
});
test('lost acknowledgement remains uncertain and cannot be forced into a duplicate', async t => {
  t.mock.method(globalThis, 'fetch', ledger().fetch);
  let sends = 0;
  const send = async () => { sends++; throw new Error('connection lost'); };
  assert.equal((await deliverOnce(env, 'lost', send)).ambiguous, true);
  assert.equal((await deliverOnce(env, 'lost', send, { force: true })).status, 'uncertain');
  assert.equal(sends, 1);
});
test('confirmed failures can retry after cooldown; other platforms are independent', async t => {
  t.mock.method(globalThis, 'fetch', ledger().fetch);
  let sends = 0;
  const send = async () => ({ ok: ++sends > 1 });
  assert.equal((await deliverOnce(env, 'fb:one', send, { retryMs: -1 })).ok, false);
  assert.equal((await deliverOnce(env, 'fb:one', send)).ok, true);
  assert.equal((await deliverOnce(env, 'ig:one', send)).ok, true);
  assert.equal(sends, 3);
});
test('cannot send while delivery storage is unavailable or malformed', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }));
  let sent = false;
  await assert.rejects(deliverOnce(env, 'one', async () => { sent = true; return { ok: true }; }));
  assert.equal(sent, false);
});
test('saved successful receipt repairs an interrupted legacy state update', async t => {
  const db = ledger(); t.mock.method(globalThis, 'fetch', db.fetch);
  await deliverOnce(env, 'post:facebook:x', async () => ({ ok: true, id: 'known' }));
  const result = await deliverOnce(env, 'post:facebook:x', async () => { throw new Error('must not send'); });
  assert.equal(result.id, 'known'); assert.equal(result.status, 'already_sent');
});
test('admin authorization requires repository write permission', async t => {
  // Collaborators-list is gated on real push/admin access regardless of the repo's
  // public/private visibility (unlike the bare repo GET, which returns 200 for anyone
  // on a public repo) — a read-only token gets 403 here.
  t.mock.method(globalThis, 'fetch', async () => new Response('Forbidden', { status: 403 }));
  assert.equal(await authorizeAdmin(new Request('https://worker/api', { headers: { Authorization: 'Bearer sufficiently-long-test-token' } }), env), false);
  assert.equal(await authorizeAdmin(new Request('https://worker/api'), env), false);
});
test('unauthenticated administrative endpoints cannot publish or dispatch', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not perform any outbound request'); });
  for (const path of ['/api/social/manual-publish', '/api/videos/publish-social', '/api/videos/dispatch', '/api/admin/clean-duplicate-social']) {
    const response = await worker.fetch(new Request('https://worker' + path, { method: 'POST', body: '{}' }), env as any);
    assert.equal(response.status, 401);
  }
});
test('Meta acknowledgement errors are distinguished from definite rejection', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('lost'); });
  assert.equal((await finishPublication('https://meta.test', {})).ambiguous, true);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'quota' } }, { status: 400 }));
  assert.equal((await finishPublication('https://meta.test', {})).ambiguous, false);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'server' } }, { status: 500 }));
  assert.equal((await finishPublication('https://meta.test', {})).ambiguous, true);
});
test('failed Facebook upload never reaches the publish boundary', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    calls++;
    if (calls === 1) return Response.json({ video_id: 'v', upload_url: 'https://upload.test' });
    if (calls === 2) return new Response('video', { headers: { 'content-length': '5' } });
    assert.equal(init.headers.file_size, '5');
    return Response.json({ error: { message: 'upload failed' } }, { status: 400 });
  });
  const result = await publishFacebookVideo({ pageId: 'p', token: 'secret', videoUrl: 'https://video.test', story: true });
  assert.equal(result.ok, false); assert.equal(calls, 3);
});
test('Instagram resumes a saved container without creating a duplicate', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    calls++;
    if (calls === 1) { assert.match(String(url), /container-1\?/); return Response.json({ status_code: 'FINISHED' }); }
    assert.match(String(url), /media_publish$/); return Response.json({ id: 'published-1' });
  });
  const result = await publishInstagramVideo({ accountId: 'a', token: 'secret', videoUrl: 'https://video.test', story: false,
    kv: { get: async () => JSON.stringify({ id: 'container-1', createdAt: Date.now() }) } as any });
  assert.equal(result.ok, true); assert.equal(result.id, 'published-1'); assert.equal(calls, 2);
});
test('show links match Eleventy and retain explicit permalinks', () => {
  assert.equal(showUrl('20260921023300-mlw-fusion-19-09-2026.md', { title: 'MLW Fusion 19.09.2026' }), 'https://arab-wrestling.com/shows/mlw-fusion-19-09-2026/');
  assert.equal(showUrl('new.md', { title: 'changed', permalink: '/shows/original/index.html' }), 'https://arab-wrestling.com/shows/original/');
  assert.equal(isShowEligible('20260920000100-old.md', {}), false);
  assert.equal(isShowEligible('20260921023300-old.md', {date: '2026-09-21T05:33:00+03:00'}), false);
  assert.equal(isShowEligible('20260921200000-new.md', {}), false);
  assert.equal(isShowEligible('new.md', {date: 'invalid'}), false);
  assert.equal(isShowEligible('new.md', {date: '2026-09-21T19:13:59Z'}), true);
});
test('a show already tracked with partial progress keeps retrying past the eligibility cutoff', () => {
  const oldShowData = { date: '2026-09-21T05:33:00+03:00' };
  // Never-seen old content stays excluded — the cutoff still does its job.
  assert.equal(shouldProcessShow('old.md', oldShowData, undefined), false);
  // But a show that already has a state entry (it was already accepted into the
  // pipeline once, e.g. Instagram already published) must keep retrying the
  // platforms still pending, even though its air date is before the cutoff —
  // this is exactly what orphaned the UFC 331 shows' Facebook reel/story forever.
  const partial = { facebook_reel: false, facebook_story: false, instagram_reel: true, instagram_story: true, tiktok: false, publishedAt: null } as any;
  assert.equal(shouldProcessShow('old.md', oldShowData, partial), true);
  assert.equal(shouldProcessShow('new.md', { date: '2026-09-21T19:13:59Z' }, undefined), true);
});
test('reel matching uses exact generator filename, never broad partial matches', () => {
  const slug = '20260921002200-ufc-331-van-vs-pantoja-2-early-prelims';
  const file = `reel-${slug.slice(0, 45)}.mp4`;
  assert.equal(findReelVideo(slug, ['reel-ufc.mp4', file]), file);
  assert.equal(findReelVideo(slug, ['reel-ufc.mp4']), null);
});
test('partial results retain successful platforms and errors', () => {
  const state = applyResults(undefined, { facebook_reel: { ok: true }, instagram_story: { ok: false, error: 'quota' } }, ['facebook_reel', 'instagram_story'], 'title');
  assert.equal(state.facebook_reel, true); assert.equal(state.instagram_story, false); assert.ok(state.publishedAt);
  assert.equal(state.errors?.instagram_story, 'quota');
  const next = applyResults(state, { instagram_story: { ok: true } }, ['instagram_story'], 'title');
  assert.equal(next.facebook_reel, true); assert.equal(next.instagram_story, true); assert.deepEqual(next.errors, {});
});

test('authenticated video calls reject foreign media and unsupported platforms without fetching media', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    calls++; assert.equal(String(url), 'https://api.github.com/repos/owner/repo/collaborators?per_page=1');
    return Response.json([]);
  });
  for (const body of [
    { videoUrl: 'https://foreign.test/video.mp4', platforms: ['facebook_reel'] },
    { videoUrl: 'https://site.test/videos/test.mp4', platforms: ['telegram'] },
  ]) {
    const result = await worker.fetch(new Request('https://worker/api/videos/publish-social', {
      method: 'POST', headers: { Authorization: 'Bearer authorized-test-token' }, body: JSON.stringify(body),
    }), { ...env, SITE_ORIGIN: 'https://site.test' } as any);
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 2);
});
test('one uncertain platform does not erase another confirmed success or its own review flag', () => {
  const first = applyResults(undefined, { facebook_reel: { ok: false, ambiguous: true } }, ['facebook_reel'], 'title');
  const next = applyResults(first, { instagram_reel: { ok: true } }, ['instagram_reel'], 'title');
  assert.equal(next.instagram_reel, true); assert.equal(next.facebook_reel, false);
  assert.deepEqual(next.reviewPlatforms, ['facebook_reel']); assert.equal(next.needsReview, true);
});

test('retention keeps pending or unknown show videos through platform restrictions', () => {
  const slug = '20260921023300-mlw-fusion-19-09-2026';
  const file = `reel-${slug}.mp4`;
  assert.equal(mustRetainVideo(file, {}), true);
  assert.equal(mustRetainVideo(file, { [slug]: { facebook_reel: true } }), true);
  assert.equal(mustRetainVideo(file, { [slug]: { facebook_reel: true, facebook_story: true, instagram_reel: true, instagram_story: true } }), false);
});

test('automatic watcher bounds attempts and defers failed platforms without starving the next article', async t => {
  const database = ledger();
  // The feed is newest-first (as watcher-recent-content.json always is in
  // production), so 'two' comes first here even though 'one' is older. The
  // Worker must still pick the oldest incomplete item ('one') first (see
  // the eligibleItems.reverse() in runWatcherPoll), or a steady stream of
  // newer arrivals like 'two' could starve it indefinitely.
  const items = [
    { url: '/news/two/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: new Date().toISOString() },
    { url: '/news/one/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: new Date(Date.now() - 10 * 60_000).toISOString() },
  ];
  const state: any = { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} };
  for (const slug of ['one', 'two']) for (const p of ['telegram','facebook']) state[p][`httpssitetestnews${slug}`] = Date.now();
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  const config = { ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any;
  await runWatcherPoll(config);
  const first = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  // MAX_PER_TICK is 1 (raising it to fix a different starvation case briefly
  // reintroduced CPU-limit failures — see its definition in index.ts and the
  // alternating notStarted/catchUpOnly priority below it), so only the
  // oldest incomplete article ('one') is fully attempted this tick.
  // Both only miss Instagram, which can't take every article (daily cap, INCIDENTS
  // #51): the NEWER one goes first, the older one on the next tick.
  assert.equal(Object.keys(first.deferrals).length, 2);
  assert.ok(first.deferrals['instagram:httpssitetestnewstwo']);
  await runWatcherPoll(config);
  const second = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(second.deferrals['instagram:httpssitetestnewsone']);
});


test('an article delayed on its way to the site is still posted: the social window starts at published_at, not the source date', async t => {
  // INCIDENTS #36: a Gemini quota outage delayed articles by hours; they
  // reached the site with source dates already outside the 3h window and the
  // Worker never posted them. An old article with no published_at must still
  // stay out.
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [
    { url: '/news/fresh/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(0.5), published_at: hours(0.4) },
    { url: '/news/stale/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(4) },
    { url: '/news/late/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(5), published_at: hours(0.05) },
  ];
  const state: any = { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} };
  for (const slug of ['fresh', 'stale', 'late']) for (const p of ['telegram','facebook']) state[p][`httpssitetestnews${slug}`] = Date.now();
  for (const p of ['instagram','x']) state[p]['httpssitetestnewsfresh'] = Date.now();
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const touched = Object.keys(after.deferrals || {}).concat(Object.keys(after.instagram), Object.keys(after.x));
  assert.ok(touched.some(k => k.endsWith('httpssitetestnewslate')), 'the late-arriving article was attempted');
  assert.ok(!touched.some(k => k.endsWith('httpssitetestnewsstale')), 'an old article without published_at stays out');
});


test('old, undated and unknown articles cannot reach video publishing even with force', async t => {
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/owner/repo/collaborators?per_page=1') return Response.json([]);
    if (url.startsWith('https://site.test/search-index.json')) return Response.json([
      {url: '/old/', date: '2026-09-21T19:13:58Z'}, {url: '/undated/'}
    ]);
    throw new Error('Unexpected external request: ' + url);
  });
  for (const postUrl of ['/old/', '/undated/', '/unknown/']) {
    const response = await worker.fetch(new Request('https://worker/api/videos/publish-social', {
      method: 'POST', headers: {Authorization: 'Bearer authorized-test-token'},
      body: JSON.stringify({videoUrl: 'https://site.test/videos/test.mp4', postUrl, platforms: ['facebook_reel'], force: true})
    }), {...env, SITE_ORIGIN: 'https://site.test', WATCHER_MIN_DATE: '2026-09-21T19:13:59Z'} as any);
    assert.equal(response.status, 409);
    assert.equal((await response.json() as any).code, 'CONTENT_NOT_ELIGIBLE');
  }
});

test('a show already tracked in show-reel-state.json can finish publishing even though its air date is before the cutoff', async t => {
  // Same bug as isShowEligible/shouldProcessShow, but this is the Worker's own
  // independent copy of the date gate — reproduces incident #10: a show whose
  // Instagram already succeeded before WATCHER_MIN_DATE was raised could never
  // get its still-pending Facebook platforms published, because this endpoint
  // re-rejected it on every retry regardless of the caller's own state.
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/owner/repo/collaborators?per_page=1') return Response.json([]);
    if (url.startsWith('https://site.test/search-index.json')) return Response.json([{ url: '/old-show/', date: '2026-09-21T00:22:00Z' }]);
    if (url.startsWith('https://raw.githubusercontent.com/owner/repo/main/_data/show-reel-state.json')) {
      return Response.json({ '20260921002200-old-show': { instagram_reel: true, instagram_story: true, facebook_reel: false, facebook_story: false } });
    }
    if (url === 'https://graph.facebook.com/v21.0//video_reels') return Response.json({ video_id: 'v1', upload_url: 'https://upload.test' });
    throw new Error('Unexpected external request: ' + url);
  });
  const response = await worker.fetch(new Request('https://worker/api/videos/publish-social', {
    method: 'POST', headers: { Authorization: 'Bearer authorized-test-token' },
    body: JSON.stringify({
      videoUrl: 'https://site.test/videos/reel-20260921002200-old-show.mp4',
      postUrl: '/old-show/', platforms: ['facebook_reel'],
    }),
  }), { ...env, SITE_ORIGIN: 'https://site.test', WATCHER_MIN_DATE: '2026-09-21T19:13:59Z' } as any);
  assert.notEqual(response.status, 409);
});

// ── Regression tests for incidents found and fixed on 2026-09-22 ──────────────
// Each of these reproduces a defect that actually reached production once, so a
// future change can't silently reintroduce it without breaking the suite.

test('admin authorization checks real collaborator access, not the public repo GET', async t => {
  // The bare `GET /repos/{owner}/{repo}` endpoint this used to check returns 200 for
  // ANYONE on a public repo like this one — its `.permissions` sub-object was the only
  // thing standing between "authorized" and "not", and GitHub Actions' own token never
  // populated it, so every automated call failed 100% of the time regardless of retries,
  // even though the same token demonstrably had real write access (it successfully wrote
  // to the repo via the Contents API moments later in the same job). The collaborators
  // endpoint is gated on real push/admin access independent of the repo's visibility, so
  // it can't be fooled by "public repo returns 200 for everyone" the way the old check was.
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    assert.ok(String(input).includes('/collaborators'), 'must check the collaborators endpoint, not the bare repo GET');
    return Response.json([]);
  });
  assert.equal(await authorizeAdmin(new Request('https://worker/api', { headers: { Authorization: 'Bearer sufficiently-long-test-token' } }), env), true);

  // A transient 429/403-with-retry-after (genuine secondary rate limiting) is retried.
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Response('rate limited', { status: 429 });
    return Response.json([]);
  });
  assert.equal(await authorizeAdmin(new Request('https://worker/api', { headers: { Authorization: 'Bearer sufficiently-long-test-token' } }), env), true);
  assert.equal(calls, 2, 'must have retried past the 429 instead of failing on the first attempt');

  // A plain 403 with no rate-limit signal is a real, final "not authorized" — not
  // something to retry into a different answer.
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('Forbidden', { status: 403 }); });
  assert.equal(await authorizeAdmin(new Request('https://worker/api', { headers: { Authorization: 'Bearer sufficiently-long-test-token' } }), env), false);
  assert.equal(calls, 1, 'a plain 403 is final and must not be retried as if it were rate limiting');
});

test('show-reel-monitor never fails the job over Instagram still processing its video', () => {
  // Instagram's async encoding ("status: processing") used to be counted the same as
  // a real failure, turning a normal wait state into a "workflow failed" email.
  assert.equal(hasRealFailure({ instagram_reel: { ok: false, status: 'processing' } }, ['instagram_reel']), false);
  // A genuine, definite failure on the same platform must still be reported.
  assert.equal(hasRealFailure({ instagram_reel: { ok: false, error: 'Meta rejected the media' } }, ['instagram_reel']), true);
  // Success obviously isn't a failure either.
  assert.equal(hasRealFailure({ facebook_reel: { ok: true } }, ['facebook_reel']), false);
  // A platform the Worker deliberately skipped because it isn't configured/enabled
  // yet (e.g. TikTok before the site owner turns it on) is a permanent, expected
  // "not attempted" state — not a failure to retry into a workflow-failed email.
  assert.equal(hasRealFailure({ tiktok: { ok: false, skipped: true, error: 'not enabled' } }, ['tiktok']), false);
});

test('publish-social skips TikTok cleanly while it is not yet enabled, without failing the request', async t => {
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    const u = String(url);
    if (u === 'https://api.github.com/repos/owner/repo/collaborators?per_page=1') return Response.json([]);
    if (u.startsWith('https://site.test/search-index.json')) return Response.json([{ url: '/shows/test/', date: new Date().toISOString() }]);
    if (u === 'https://site.test/videos/test.mp4') return new Response(null, { status: 200 });
    throw new Error('Unexpected external request for a platform that should never be attempted: ' + url);
  });
  const response = await worker.fetch(new Request('https://worker/api/videos/publish-social', {
    method: 'POST', headers: { Authorization: 'Bearer authorized-test-token' },
    body: JSON.stringify({ videoUrl: 'https://site.test/videos/test.mp4', postUrl: '/shows/test/', platforms: ['tiktok'] }),
  }), { ...env, SITE_ORIGIN: 'https://site.test', WATCHER_MIN_DATE: '2020-01-01T00:00:00Z' } as any);
  const body: any = await response.json();
  assert.equal(body.results.tiktok.ok, false);
  assert.equal(body.results.tiktok.skipped, true);
});

test('sanitizeWrestlingTerms strips a stray Arabic suffix glued onto an English word', () => {
  // Reached production once: "عروض AEW Liveة بأنها حميمة" — Gemini glued a bare
  // feminine ة straight onto "Live" with no space. A Latin word never legitimately
  // ends in an attached ة, so it must always be safe to drop.
  assert.equal(sanitizeWrestlingTerms('عروض AEW Liveة بأنها حميمة'), 'عروض AEW Live بأنها حميمة');
  // A correctly-formed "Live" followed by real Arabic text must be left untouched.
  assert.equal(sanitizeWrestlingTerms('انضم إلى عرض AEW Live الليلة'), 'انضم إلى عرض AEW Live الليلة');
  // Ordinary Arabic words ending in ة (not glued to Latin script) must be untouched.
  assert.equal(sanitizeWrestlingTerms('شاهد المباراة القادمة'), 'شاهد المباراة القادمة');
});

test('sanitizeWrestlingTerms normalizes Persian letterforms to standard Arabic', () => {
  // Reached production once, inconsistently within the same article (title correct,
  // body/tags in Persian script): "تگ کلاسیک" instead of "تاغ كلاسيك".
  assert.equal(sanitizeWrestlingTerms('بطولة تگ کلاسیک'), 'بطولة تاغ كلاسيك');
});

test('a cross-source duplicate story is detected and skipped, unrelated stories are not', () => {
  // The existing dedup only matches an EXACT source_id/source_url repeat from the
  // SAME outlet. It never caught two different outlets covering the same real event:
  // Fightful and Ringside News both published their own article about Titus O'Neil
  // moving to WWE's alumni section, 8 minutes apart, with different source_ids/URLs.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'),
      '---\nsource_url: "https://www.fightful.com/wrestling/titus-oneil-moved-to-wwe-alumni-section/"\n---\nbody');
    const dupe = findLikelyDuplicateStory(
      "Titus O'Neil Quietly Moved To WWE Alumni Section Years Away From The Ring", 6, dir);
    assert.equal(dupe.isDuplicate, true);
    assert.equal(dupe.matchedFile, 'a.md');

    const unrelated = findLikelyDuplicateStory('CM Punk Announces Retirement Plans For Next Year', 6, dir);
    assert.equal(unrelated.isDuplicate, false, 'a genuinely different story must never be blocked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plural/singular wording alone no longer hides a cross-source duplicate', () => {
  // Reached production: Fightful's "TBS Title Bout, Will Ospreay Match Added To
  // 9/23 AEW Dynamite/Collision" and Ringside News's "Two New Matches Added To
  // September 23 AEW Dynamite And Collision Special" (17 minutes later) covered
  // the exact same two additions to the same card, but the overlap ratio landed
  // at 0.5 — just under the 0.6 bar — purely because "matches"/"match" and
  // "added"/"added" didn't line up as identical strings without stemming.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-stem-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'),
      '---\nsource_url: "https://www.fightful.com/wrestling/tbs-title-bout-will-ospreay-match-added-to-9-23-aew-dynamite-collision/"\n---\nbody');
    const dupe = findLikelyDuplicateStory(
      'Two New Matches Added to September 23 AEW Dynamite and Collision Special', 6, dir);
    assert.equal(dupe.isDuplicate, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('post-translation tag+body guard catches duplicates whose headlines share no words', () => {
  // Reached production twice: (1) Ringside News's "Two AEW Talents Have Years
  // Left On AEW Contracts, Quiet Re-Signings" vs Fightful's "Details On The AEW
  // Status Of Kip Sabian And Penelope Ford" — same re-signing story, 33 minutes
  // apart, zero shared distinctive title words. (2) Ringside News's "Gable
  // Steveson Breaks Silence After 12-Second UFC 331 Knockout And Pre-Fight
  // Allegations" vs Fightful's "Gable Steveson Denies 2019 Rape Allegation,
  // Issues Statement On KO Loss" — same statement, 40 minutes apart. Neither pre-
  // translation title/slug check (which only sees the raw, name-free headlines)
  // can catch these; the AI-translated tags and body, once available, can.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-tagbody-test-'));
  try {
    const existingBody = 'أكدت التقارير أن الثنائي كيب سابيان وبينيلوبي فورد جددا عقودهما بهدوء مع اتحاد AEW لسنوات قادمة دون أي ضجيج إعلامي، لينفيا بذلك شائعات اقتراب رحيلهما عن الاتحاد بعد تداول معلومات غير دقيقة حول عقود نجوم AEW.';
    fs.writeFileSync(path.join(dir, 'a.md'),
      `---\nsource_url: "https://www.ringsidenews.com/two-aew-talents-have-years-left-aew-contracts-quiet-re-signings/"\ntags:\n  - AEW\n  - كيب سابيان\n  - بينيلوبي فورد\n  - عقود المصارعة\nimage: /content/images/x.jpg\n---\n${existingBody}`);

    const newBody = 'كشفت تقارير صحفية عن تفاصيل موقف كيب سابيان وبينيلوبي فورد مع اتحاد AEW، حيث أكدت المصادر أنهما جددا عقودهما بهدوء دون ضجيج إعلامي رغم تكهنات سابقة حول اقتراب رحيلهما عن الاتحاد.';
    const dupe = findLikelyDuplicateStoryByTagsAndBody(
      ['AEW', 'كيب سابيان', 'بينيلوبي فورد', 'أخبار المصارعة الحرة'], newBody, 6, dir);
    assert.equal(dupe.isDuplicate, true);
    assert.equal(dupe.matchedFile, 'a.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('post-translation guard never blocks a broader story that only mentions the same people in passing', () => {
  // A narrower "heated face-off" article and a later, much broader "full NXT
  // card preview" article both legitimately tag Grayson Waller and Mason Rook —
  // sharing two specific tags, same as the real duplicates above — but the
  // preview's body is mostly about other matches entirely (women's title bout,
  // Dusty Classic, Myles Borne's return). Tag overlap alone must never be enough;
  // the bodies have to actually overlap too, or genuinely new coverage gets
  // silently dropped.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-falsepos-test-'));
  try {
    const existingBody = 'تحدد رسميا موعد نزال بطولة WWE NXT بعد مواجهة كلامية ساخنة وجها لوجه بين غرايسون والر وميسون روك، حيث استحضر والر اسم الأسطورة جون سينا محذرا منافسه من الرهان على الشخص الخطأ.';
    fs.writeFileSync(path.join(dir, 'a.md'),
      `---\nsource_url: "https://www.ringsidenews.com/wwe-nxt-championship-match-set-september-29-heated-face-off/"\ntags:\n  - WWE\n  - غرايسون والر\n  - ميسون روك\n  - بطولة NXT\nimage: /content/images/x.jpg\n---\n${existingBody}`);

    const newBody = 'يشهد عرض WWE NXT القادم مواجهات حماسية، حيث يلتقي غرايسون والر مع ميسون روك، بينما تترقب الجماهير نزال بطولة السيدات لأمريكا الشمالية بين زاريا وثيا هيل. تتواصل منافسات بطولة داستي رودز للفرق بمواجهتين قويتين بين فراكسيوم ودارك ستيت، وبين بيرثرايت وميني فيكينغو، كما يسجل مايلز بورن عودته بعد هجومه الأخير على تافيون هايتس.';
    const notDupe = findLikelyDuplicateStoryByTagsAndBody(
      ['WWE', 'غرايسون والر', 'ميسون روك', 'بطولة NXT', 'بطولة السيدات لأمريكا الشمالية'], newBody, 6, dir);
    assert.equal(notDupe.isDuplicate, false, 'a broader preview must never be blocked just for naming the same people');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cross-source dedup window covers a full day, not just 6 hours, and reads the article\'s own date rather than filesystem mtime', () => {
  // Motivated by production: Ringside News published "Vince Russo Leaves JCW..."
  // at 04:43, and WrestlingInc published a follow-up about the same announcement
  // at 16:00 — 11.3 hours later. The old 6-hour default meant the first article
  // had already aged out of the scan by the time the second one arrived, so a
  // duplicate with strong title-word overlap could never be caught this late.
  // Word-overlap thresholds (not the time window) are what prevent false
  // positives, so widening the window to a full day is safe.
  //
  // This must be checked against the file's own `date:` frontmatter, not its
  // filesystem mtime: every CI run does a fresh `git checkout`, which resets
  // every file's mtime to the checkout moment regardless of when it was
  // actually published — silently making an mtime-based cutoff never filter
  // anything out (or, just as wrong, filter out an article that just happens
  // to not have been touched in this checkout). The test below only backdates
  // the frontmatter date, and separately sets an unrelated, very recent mtime,
  // to prove mtime is not what's being read.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-window-test-'));
  try {
    const filePath = path.join(dir, 'a.md');
    const elevenHoursAgo = new Date(Date.now() - 11.3 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(filePath, `---\nsource_url: "https://www.fightful.com/wrestling/titus-oneil-moved-to-wwe-alumni-section/"\ndate: ${elevenHoursAgo}\n---\nbody`);
    fs.utimesSync(filePath, new Date(), new Date()); // mtime = right now, deliberately misleading
    // Old default (6h) would miss this — the article is already older than
    // that cutoff — but the new default (24h) must still catch it.
    const dupe = findLikelyDuplicateStory(
      "Titus O'Neil Quietly Moved To WWE Alumni Section Years Away From The Ring", undefined, dir);
    assert.equal(dupe.isDuplicate, true);

    // An article older than even the 24h window must still be excluded.
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(filePath, `---\nsource_url: "https://www.fightful.com/wrestling/titus-oneil-moved-to-wwe-alumni-section/"\ndate: ${thirtyHoursAgo}\n---\nbody`);
    fs.utimesSync(filePath, new Date(), new Date());
    const tooOld = findLikelyDuplicateStory(
      "Titus O'Neil Quietly Moved To WWE Alumni Section Years Away From The Ring", undefined, dir);
    assert.equal(tooOld.isDuplicate, false, 'an article past the window must not be matched just because its mtime is recent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('post-translation guard matches an acronym tag against its spelled-out equivalent', () => {
  // A promotion abbreviated as "JCW" by one translation run and spelled out as
  // "Juggalo Championship Wrestling" by another refer to the same organization,
  // but never match as identical tag strings — undercounting shared specific
  // tags below the required threshold of 2 even when the story is genuinely
  // the same. Body text here is written to clearly overlap so this test isolates
  // the tag-matching fix specifically, not the separate body-overlap threshold.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-acronym-test-'));
  try {
    const sharedBody = 'أعلن فينس روسو رسميا انفصاله عن اتحاد Juggalo Championship Wrestling بعد فترة طويلة من العمل معه، منهيا بذلك هذا الفصل من مسيرته المهنية والتعاون بينهما بشكل نهائي وودي بلا أي خلافات.';
    fs.writeFileSync(path.join(dir, 'a.md'),
      `---\nsource_url: "https://www.ringsidenews.com/vince-russo-leaves-jcw/"\ntags:\n  - INDIE\n  - فينس روسو\n  - JCW\nimage: /content/images/x.jpg\n---\n${sharedBody}`);
    const dupe = findLikelyDuplicateStoryByTagsAndBody(
      ['INDIE', 'فينس روسو', 'Juggalo Championship Wrestling'], sharedBody, 24, dir);
    assert.equal(dupe.isDuplicate, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('post-translation guard catches a duplicate via a shared cited source link, even with only one matching tag', () => {
  // Reached production: Ringside News's "First Look At MJF In Upcoming Thriller
  // Stranglehold" and Fightful's "MJF, Kayla Becker And David Arquette Feature
  // In First Trailer For Stranglehold" both cited the exact same source tweet
  // (https://x.com/Collider/status/2100601926169592228) 10 minutes apart, but
  // only "ام جيه اف" (MJF) matched as a shared specific tag — one article tagged
  // the genre/industry, the other tagged the film's other cast members — so the
  // required 2-tag threshold was never met and body overlap landed at 0.325,
  // just under the 0.35 bar. The identical cited link is independent, stronger
  // evidence and must catch this even when tags and body overlap both fall short.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-link-test-'));
  try {
    const existingBody = 'واصل نجم اتحاد AEW ام جيه اف تعزيز مسيرته السينمائية.\n\nhttps://x.com/Collider/status/2100601926169592228';
    fs.writeFileSync(path.join(dir, 'a.md'),
      `---\nsource_url: "https://www.ringsidenews.com/first-look-mjf-upcoming-thriller-stranglehold/"\ntags:\n  - AEW\n  - ام جيه اف\n  - مشاريع سينمائية\n  - أفلام هوليوود\nimage: /content/images/x.jpg\n---\n${existingBody}`);

    const newBody = 'ظهر النجم ام جيه اف إلى جانب كيلا بيكر وديفيد آركيت في المقطع الدعائي الأول لفيلم Stranglehold.\n\nhttps://x.com/Collider/status/2100601926169592228';
    const dupe = findLikelyDuplicateStoryByTagsAndBody(
      ['AEW', 'ام جيه اف', 'ديفيد آركيت', 'كيلا بيكر'], newBody, 24, dir);
    assert.equal(dupe.isDuplicate, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('names glossary hint surfaces the canonical Arabic spelling for a name in the source text', () => {
  // Reached production: one article spelled Thunder Rosa "ثندر روزا" instead of
  // the glossary's own canonical "ثاندر روزا" used everywhere else on the site.
  // applyNamesGlossary (English->Arabic substitution) can never catch this class
  // of bug, since the AI already translated the name — just to a different,
  // equally-plausible Arabic transliteration. The hint must surface the exact
  // pair for any glossary name actually present in the source text, so the
  // model is told the canonical spelling before it generates anything.
  const hint = buildNamesGlossaryHint('Thunder Rosa spoke about her favorite looks from her career.');
  assert.match(hint, /Thunder Rosa = ثاندر روزا/);

  // A name that never appears in the source must not be mentioned at all.
  const empty = buildNamesGlossaryHint('CM Punk cut a promo on Monday Night Raw.');
  assert.equal(empty.includes('Thunder Rosa'), false);
});

test('names glossary hint drops a short name subsumed by a longer matched name', () => {
  // Reached production: "Lio Rush" (glossary: "ليو راش") got written as "ليو روش"
  // instead — a splice with the UNRELATED wrestler "Rush" (glossary: "روش"). The
  // first version of this hint made that worse, not better: for text containing
  // "Lio Rush" it surfaced BOTH "Lio Rush = ليو راش" AND "Rush = روش" side by
  // side, since "Rush" is also a literal whole-word match inside "Lio Rush" —
  // self-contradicting guidance for the same word that could reproduce the exact
  // splice it exists to prevent. The shorter name must be dropped whenever it is
  // a whole-word substring of a longer name also present in the same text.
  const hint = buildNamesGlossaryHint('Lio Rush appeared on ROH TV tonight.');
  assert.match(hint, /Lio Rush = ليو راش/);
  assert.equal(/(?<!Lio )Rush = روش/.test(hint), false, 'standalone "Rush" must not also be listed');

  // But text that only mentions the unrelated "Rush" (not "Lio Rush") must still
  // get its own hint — the suppression only applies when the longer name is
  // ALSO present in the same text.
  const standalone = buildNamesGlossaryHint('Rush defended the AAA Mega Championship tonight.');
  assert.match(standalone, /Rush = روش/);
});

test('sanitizeWrestlingTerms drops an orphaned English "The" glued to a transliterated team name', () => {
  // Reached production twice: "فريق The نيو ليفل" and "فريق The يانج باكس" — the
  // team name itself got transliterated to Arabic, but the English article "The"
  // was left glued in front of it instead of being dropped or, alternatively,
  // the whole name kept in English. Neither half-and-half form is readable.
  assert.equal(sanitizeWrestlingTerms('فريق The نيو ليفل'), 'فريق نيو ليفل');
  assert.equal(sanitizeWrestlingTerms('فريق The يانج باكس يحسمان الجدل'), 'فريق يانج باكس يحسمان الجدل');
  // A team name that stayed fully English must be left untouched — the rule
  // only targets "The" immediately followed by Arabic script.
  assert.equal(sanitizeWrestlingTerms('فريق The Young Bucks قادم بقوة'), 'فريق The Young Bucks قادم بقوة');
});

test('a failed TikTok init call surfaces the x-tt-logid header for support tickets', async t => {
  // TikTok's own bug-report form requires a log ID captured from the
  // "x-tt-logid" response header to investigate any API issue — without it a
  // support ticket can't be filed usefully. We were discarding that header
  // entirely and only kept the human-readable error message.
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ error: { code: 'url_ownership_unverified', message: 'Please review our URL ownership verification rules' } }),
      { status: 403, headers: { 'x-tt-logid': '202609231234560000000000000001' } }));
  const result = await publishTikTokVideo({ accessToken: 'token', videoUrl: 'https://site.test/videos/a.mp4', kv: { get: async () => null, put: async () => {} } as any });
  assert.equal(result.ok, false);
  assert.match(result.error!, /log_id: 202609231234560000000000000001/);
});

test('TikTok posts SELF_ONLY until the app is approved for public posting', async t => {
  // An unaudited TikTok app is rejected outright if it asks for PUBLIC_TO_EVERYONE;
  // the allowed levels come from creator_info, so the init call must follow them.
  const sent: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: any) => {
    if (url.endsWith('/creator_info/query/')) return new Response(JSON.stringify({ error: { code: 'ok' }, data: { privacy_level_options: ['SELF_ONLY'] } }));
    if (url.endsWith('/video/init/')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ error: { code: 'ok' }, data: { publish_id: 'p1' } })); }
    return new Response(JSON.stringify({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE' } }));
  });
  const result = await publishTikTokVideo({ accessToken: 'token', videoUrl: 'https://site.test/videos/a.mp4', kv: { get: async () => null, put: async () => {}, delete: async () => {} } as any });
  assert.equal(result.ok, true);
  assert.equal(sent[0].post_info.privacy_level, 'SELF_ONLY');
});

test('sanitizeWrestlingTerms keeps WWF in English like every other federation name', () => {
  // WWE, AEW, TNA, ROH, MLW and NJPW all had a rule enforcing their English
  // name over a phonetic Arabic transliteration, but WWF (the promotion's own
  // name before its 2002 rename to WWE) was missing from that list entirely —
  // any historical article about that era rendered it as "دبليو دبليو إف"
  // instead, inconsistent with how every other federation name is handled.
  assert.equal(sanitizeWrestlingTerms('نجم دبليو دبليو إف السابق'), 'نجم WWF السابق');
  assert.equal(sanitizeWrestlingTerms('مسيرته في اتحاد دبليو دبليو إف'), 'مسيرته في WWF');
});

test('names glossary hint covers Violent J, added after inconsistent spellings reached production', () => {
  // Reached production: "Violent J" (Insane Clown Posse / JCW owner) had no
  // glossary entry at all, so two articles about the same Vince Russo/JCW
  // story spelled him "فايولنت جاي" and a third spelled him "فايلنت جاي" —
  // this class of bug (buildNamesGlossaryHint) can only help once a name is
  // actually IN the glossary, so the missing entry itself was the root cause.
  const hint = buildNamesGlossaryHint('Violent J broke his silence on Vince Russo leaving JCW.');
  assert.match(hint, /Violent J = فايولنت جاي/);
});

test('sanitizeWrestlingTerms normalizes "MLP Northern Rising" idempotently, never stacking prefixes', () => {
  // Reached production: a tag and the article body both showed
  // "عرض MLPعرض MLPعرض MLPعرض MLP Northern Rising" — the old regex only matched
  // an optional عرض directly before "Northern Rising" and never consumed an
  // existing "MLP", so on already-correct text it left "MLP" in place and
  // prepended a whole new "عرض MLP" — and since something in the pipeline calls
  // sanitizeWrestlingTerms more than once on the same text, that compounded
  // every extra call. A second, separate bug in the same regex: a leading \b
  // right before the Arabic alternation doesn't behave as a boundary at all
  // (JS's default \w excludes Arabic letters), which silently broke the
  // optional-عرض branch entirely once the first bug was naively "fixed".
  const variants = ['Northern Rising', 'MLP Northern Rising', 'عرض MLP Northern Rising', 'عرض Northern Rising', 'مهرجان Northern Rising'];
  for (const input of variants) {
    let s = input;
    for (let i = 0; i < 5; i++) s = sanitizeWrestlingTerms(s);
    assert.equal(s, 'عرض MLP Northern Rising', `input "${input}" must converge to the canonical form and stay stable across repeated passes`);
  }
});

test('_redirects is converted to rules Cloudflare Pages accepts', () => {
  // Reached production: every rule used Netlify's "301!", which Pages rejects,
  // so none of the 166 redirects worked and every renamed article URL 404'd.
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(site, 'tag', 'جديد', '2'), { recursive: true });
  const out = toPagesRedirects([
    'https://arab-wrestling.pages.dev/* https://arab-wrestling.com/:splat 301!',
    '/news/قديم/* /news/جديد/:splat 301!',
    '/tag/قديم/* /tag/جديد/:splat 301!',
  ].join('\n'), site).trim().split('\n');
  assert.ok(out.every(l => /^\/\S* \S+ \d{3}$/.test(l)), 'bare numeric status, path-only sources');
  assert.ok(out.includes('/news/قديم/ /news/جديد/ 301'));
  assert.ok(out.includes('/news/قديم /news/جديد/ 301'));
  assert.ok(out.includes('/tag/قديم/* /tag/جديد/:splat 301'), 'paginated target keeps its splat');
  const firstSplat = out.findIndex(l => l.includes('*'));
  assert.ok(out.slice(firstSplat).every(l => l.includes('*')), 'static rules must precede every splat rule');
});

test('news QA auto-fixes defects that reached production and leaves legit text alone', async () => {
  const { autoFix, checkArticle, applyCorrections } = await import('../scripts/news-qa');
  assert.equal(autoFix('لعروض WWE Liveة والمتلفزة'), 'لعروض WWE Live والمتلفزة');
  assert.equal(autoFix('بطلة سابقة ل *NXTبطولة السيدات*'), 'بطلة سابقة لـ *NXT بطولة السيدات*');
  assert.equal(autoFix('في عرض MLPعرض MLP Northern Rising'), 'في عرض MLP Northern Rising');
  assert.equal(autoFix('ظهور خاص ل زينا ستيرلينج'), 'ظهور خاص لـزينا ستيرلينج');
  assert.equal(autoFix('التحکيم'), 'التحكيم');
  assert.equal(autoFix('فريق بانغ بانغ غانغ'), 'فريق بانغ بانغ غانغ');
  assert.equal(autoFix('فاز 3 و 4'), 'فاز 3 و 4');
  assert.equal(applyCorrections('رئيس AEW تونسي خان في عرض WWE إيفولف'), 'رئيس AEW توني خان في عرض WWE EVOLVE');
  assert.equal(applyCorrections('الرومانسية'), 'الرومانسية');
  const codes = checkArticle('نتائج عرض WWE إيفولف', 'x'.repeat(300) + ' سيطرت على مجريات اللعب').map(i => i.code);
  assert.ok(codes.includes('transliterated_show') && codes.includes('game_terms'));
});

test('AI copy-editor edits are applied only when verifiable', async () => {
  const { applyProofEdits, parseDuplicateAnswer } = await import('../scripts/editorial');
  const draft = { title: 'تونسي خان يعلن', body: 'أعلن تونسي خان عن عرض خاصة.', tags: ['تونسي خان'] };
  const { article, applied } = applyProofEdits(draft, [
    { field: 'body', find: 'تونسي خان', replace: 'توني خان' },
    { field: 'body', find: 'عرض خاصة', replace: 'عرض خاص' },
    { field: 'title', find: 'تونسي خان', replace: 'توني خان' },
    { field: 'tags', find: 'تونسي خان', replace: 'توني خان' },
    { field: 'body', find: 'نص غير موجود', replace: 'أي شيء' },
    { field: 'body', find: 'أعلن', replace: 'أعلن '.repeat(40) },
  ]);
  assert.equal(article.body, 'أعلن توني خان عن عرض خاص.');
  assert.equal(article.title, 'توني خان يعلن');
  assert.deepEqual(article.tags, ['توني خان']);
  // The body fix already carries the name into the tags, so the explicit tags
  // edit finds nothing left to change.
  assert.equal(applied.length, 3);
  const candidates = [{ file: 'a.md', title: '', body: '', tags: [], date: 0 }];
  assert.equal(parseDuplicateAnswer('{"duplicate_of":0,"reason":"same"}', candidates)?.file, 'a.md');
  assert.equal(parseDuplicateAnswer('{"duplicate_of":null}', candidates), null);
  assert.equal(parseDuplicateAnswer('{"duplicate_of":5}', candidates), null);
});

test('copy editor may not invent numbers or English words the source lacks', async () => {
  const { applyProofEdits } = await import('../scripts/editorial');
  const draft = { title: 'نتائج العرض (24 سبتمبر 2026)', body: 'تحدثت Lainey Reid عن اﻻنتقال', tags: [] };
  const edits = [
    { field: 'title' as const, find: '(24 سبتمبر 2026)', replace: '(23 سبتمبر 2026)' },
    { field: 'body' as const, find: 'Lainey Reid', replace: 'Lainey Reed' },
  ];
  assert.equal(applyProofEdits(draft, edits, '').applied.length, 0);
  assert.equal(applyProofEdits(draft, edits, 'Lainey Reed spoke on Sept. 23').applied.length, 2);
});

test('copy editor may not turn "يذكر أن" into "يتذكر أن"', async () => {
  const { applyProofEdits } = await import('../scripts/editorial');
  const r = applyProofEdits({ title: 'عنوان الخبر هنا', body: 'يذكر أن الاتحاد يعتزم', tags: [] }, [{ field: 'body', find: 'يذكر أن', replace: 'يتذكر أن' }]);
  assert.equal(r.applied.length, 0);
});

test('recurring copy-editor fixes are promoted to permanent corrections, one-offs are not', async () => {
  const { learnCorrections } = await import('../scripts/learn-corrections');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-'));
  fs.mkdirSync(path.join(dir, 'editorial')); fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'editorial', 'corrections.json'), JSON.stringify({ corrections: [{ wrong: 'سي إم بانك', right: 'سي ام بانك' }] }));
  fs.writeFileSync(path.join(dir, 'scripts', 'wrestler-names.json'), JSON.stringify({ 'Seth Rollins': 'سيث رولينز' }));
  const log = (file: string, find: string, replace: string) => JSON.stringify({ file, field: 'body', find, replace });
  fs.writeFileSync(path.join(dir, 'editorial', 'proofread-log.jsonl'), [
    log('a.md', 'سيت رولينز', 'سيث رولينز'), log('b.md', 'سيت رولينز', 'سيث رولينز'), log('c.md', 'سيت رولينز', 'سيث رولينز'),
    log('a.md', 'نادر جدا', 'نادرة جدا'),
    log('a.md', 'سيث رولينز', 'سيت رولينز'), log('b.md', 'سيث رولينز', 'سيت رولينز'), log('c.md', 'سيث رولينز', 'سيت رولينز'),
  ].join('\n'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const learned = learnCorrections(3, true);
    assert.deepEqual(learned.map(l => `${l.wrong}→${l.right}`), ['سيت رولينز→سيث رولينز']);
  } finally { process.chdir(cwd); }
});

test('copy editor edits that break the site rules are refused', async () => {
  const { editIsAnImprovement } = await import('../scripts/editorial');
  // All seen in real copy-editor output on 2026-09-24:
  assert.equal(editIsAnImprovement('عرض MLW Fusion', 'إم إل دبليو فيوجن'), false);
  assert.equal(editIsAnImprovement('بطولة العالم للزوجي الثلاثي', 'بطولة AEW World Trios Championships'), false);
  assert.equal(editIsAnImprovement('رسميا', 'رسمياً'), false);
  assert.equal(editIsAnImprovement('حلقة العرض', 'عرض العرض'), false);
  assert.equal(editIsAnImprovement('تونسي خان', 'توني خان'), true);
  assert.equal(editIsAnImprovement('عرض خاصة', 'عرض خاص'), true);
});

test('date tags are junk; copy-editor edits never add tanween', async () => {
  const { isJunkTag } = await import('../scripts/news-qa');
  const { applyProofEdits } = await import('../scripts/editorial');
  assert.equal(isJunkTag('تاريخ 24 سبتمبر 2026'), true);
  assert.equal(isJunkTag('نيكي بيلا'), false);
  const r = applyProofEdits({ title: 'عنوان عربي هنا', body: 'بعد فترة ال 90 يوما من الرحيل', tags: [] },
    [{ field: 'body', find: 'فترة ال 90 يوما', replace: 'فترة الـ 90 يوماً' }], 'the 90-day period');
  assert.equal(r.article.body, 'بعد فترة الـ 90 يوما من الرحيل');
});

test('platforms still processing are retried after 10 minutes, real failures after 45', () => {
  const entry = applyResults(undefined, { instagram_story: { ok: false, status: 'processing' }, facebook_reel: { ok: true } } as any, ['instagram_story', 'facebook_reel'], 'x');
  assert.deepEqual(entry.processing, ['instagram_story']);
  assert.equal(retryDelayMs(entry, ['instagram_story']), 10 * 60_000);
  const failed = applyResults(entry, { instagram_story: { ok: false, error: 'boom' } } as any, ['instagram_story'], 'x');
  assert.deepEqual(failed.processing, []);
  assert.equal(retryDelayMs(failed, ['instagram_story']), 45 * 60_000);
});

test('copy editor may not undo an approved spelling', async () => {
  const { editIsAnImprovement } = await import('../scripts/editorial');
  assert.equal(editIsAnImprovement('ذا يانغ باكس', 'يانغ باكس'), false);
  assert.equal(editIsAnImprovement('فيتنس مكمان', 'فينس مكمان'), true);
});

test('Instagram video publishes are capped per run so a burst of shows cannot trip its action limit', () => {
  const budget = { tiktok: 1, instagram: 2 };
  assert.deepEqual(takePlatformBudget(['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'], budget), ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story']);
  assert.deepEqual(takePlatformBudget(['facebook_reel', 'instagram_reel', 'instagram_story'], budget), ['facebook_reel']);
});

test('a platform pause (rate_limited) does not fail the reel monitor job', () => {
  assert.equal(hasRealFailure({ instagram_reel: { ok: false, status: 'rate_limited', error: 'paused' } }, ['instagram_reel']), false);
  assert.equal(hasRealFailure({ instagram_reel: { ok: false, error: 'boom' } }, ['instagram_reel']), true);
});

test('watcher state merge keeps both runs\' processed IDs and the higher API count', async () => {
  const { mergeStates } = await import('../scripts/merge-watcher-state');
  const local = { processedIds: [1, 2, 3, 330164], apiCallsToday: 40, apiCallDate: '2026-09-24', lastChecked: '2026-09-24T13:14:00Z' };
  const remote = { processedIds: [1, 2, 3, 330170], apiCallsToday: 55, apiCallDate: '2026-09-24', lastChecked: '2026-09-24T13:10:00Z' };
  const m = mergeStates(local, remote);
  assert.deepEqual(m.processedIds, [1, 2, 3, 330170, 330164]);
  assert.equal(m.apiCallsToday, 55);
  assert.equal(m.lastChecked, '2026-09-24T13:14:00Z');
});


test('copy-editor edits apply to whole words only and conflicting edits are skipped', () => {
  // Live 2026-09-24: «فايولنت جا» → «فايولنت جاي» matched inside «فايولنت جاي» and
  // produced «فايولنت جايي»; «جيه بي إل» was proposed as both a name fix and a show name.
  const { article, applied } = applyProofEdits({ title: 'عنوان', body: 'باع حصته إلى فايولنت جاي. وقال جيه بي إل', tags: [] }, [
    { field: 'body', find: 'إلى فايولنت جا', replace: 'إلى فايولنت جاي' },
    { field: 'body', find: 'جيه بي إل', replace: 'جي بي إل' },
    { field: 'body', find: 'جيه بي إل', replace: 'AAA Worlds Collide' },
  ]);
  assert.equal(article.body, 'باع حصته إلى فايولنت جاي. وقال جيه بي إل');
  assert.equal(applied.length, 0);
  const fixed = applyProofEdits({ title: 'عنوان', body: 'الفترة التي قضها ويل', tags: [] }, [{ field: 'body', find: 'قضها', replace: 'قضاها' }]);
  assert.equal(fixed.article.body, 'الفترة التي قضاها ويل');
});


test('a results article with invented winners is caught, real finishes are not', () => {
  // INCIDENTS #39: TNA iMPACT was written from an empty live-results stub.
  const vague = checkArticle('نتائج عرض TNA iMPACT', 'نزال ثلاثي.\n🏆 **الفائز:** تم حسم النتيجة وتحديد الفائز في أجواء تنافسية مثيرة.', []);
  assert.ok(vague.some(i => i.code === 'vague_result'));
  const real = checkArticle('نتائج عرض WWE RAW', '🏆 **الفائز:** انتهى النزال بالاستبعاد بعد تدخل خارجي\n🏆 **الفائز:** كينوه', []);
  assert.ok(!real.some(i => i.code === 'vague_result'));
});

test('letters from another script inside Arabic text are caught', () => {
  // INCIDENTS #54: «وパاتريك ويطمان», «ناтан فرايزر», tag «مصارعة חברה».
  for (const [body, tags] of [['فريق كاش ماكغينيس وパاتريك', []], ['فريق Fraxiom (ناтан فرايزر وأكسيوم)', []], ['نص سليم', ['مصارعة חברה']]] as [string, string[]][])
    assert.ok(checkArticle('عنوان عربي سليم تماما هنا', body, tags).some(i => i.code === 'foreign_script'));
  assert.ok(!checkArticle('عنوان عربي سليم تماما هنا', 'فاز Bobby Casale بلقب IWTV — نص عادي', ['Beyond Wrestling']).some(i => i.code === 'foreign_script'));
});

test('punctuation left behind by a deleted clause is cleaned', () => {
  // INCIDENTS #57: «…لجارجانو وزوجته كانديس ليراي، .»
  assert.equal(autoFix('لجارجانو وزوجته كانديس ليراي، .'), 'لجارجانو وزوجته كانديس ليراي.');
  assert.equal(autoFix('فاز، ، ثم رحل .'), 'فاز، ثم رحل.');
  assert.equal(autoFix('نص عادي، ثم نص.'), 'نص عادي، ثم نص.');
});

test('a paragraph written twice is kept once', () => {
  // INCIDENTS #58
  const intro = 'شهد عرض WWE SmackDown الذي أقيم مساء 25 سبتمبر 2026 أحداثا ساخنة ومواجهات قوية تمهيدا للعرض المرتقب.';
  assert.equal(autoFix(`${intro}\n\n---\n${intro}\n\n---\n**المواجهة الأولى**`), `${intro}\n\n---\n**المواجهة الأولى**`);
  assert.equal(autoFix(`${intro}\n${intro}\n\n**المواجهة الأولى**`), `${intro}\n\n**المواجهة الأولى**`);
  assert.equal(autoFix(`${intro}\n\n${intro}\n\n**المواجهة الأولى**\n\n🏆 **الفائز:** تريك ويليامز\n\n🏆 **الفائز:** تريك ويليامز`), `${intro}\n\n**المواجهة الأولى**\n\n🏆 **الفائز:** تريك ويليامز\n\n🏆 **الفائز:** تريك ويليامز`);
});

test('a live results article follows its source until the show ends', async () => {
  // The owner used to re-publish every results article by hand after the show
  // (new URL + social re-post). Now it is rewritten in place as the source grows.
  const { decideLiveUpdate } = await import('../scripts/live-results-updater');
  const min = 60_000;
  let e = { lastSeenHash: '', lastChangeAt: 0, generatedHash: 'h3', generatedResults: 3, generatedLength: 3000, lastRegenAt: 0, rewrites: 0 };
  // Same page as published → nothing to do.
  assert.equal(decideLiveUpdate(e, { hash: 'h3', results: 3, length: 3000 }, 10 * min).rewrite, false);
  // One more finish mid-show → wait for more.
  let d = decideLiveUpdate(e, { hash: 'h4', results: 4, length: 4000 }, 20 * min);
  assert.equal(d.rewrite, false);
  // Two more finishes → rewrite now.
  d = decideLiveUpdate(d.entry, { hash: 'h5', results: 5, length: 5000 }, 25 * min);
  assert.equal(d.rewrite, true);
  e = { ...d.entry, generatedHash: 'h5', generatedResults: 5, generatedLength: 5000, lastRegenAt: 25 * min, rewrites: 1 };
  // Main event added, then the page stops changing → final rewrite after 20 min.
  d = decideLiveUpdate(e, { hash: 'h6', results: 6, length: 6500 }, 40 * min);
  assert.equal(d.rewrite, false);
  d = decideLiveUpdate(d.entry, { hash: 'h6', results: 6, length: 6500 }, 61 * min);
  assert.equal(d.rewrite, true);
  // A broken fetch with fewer results never replaces a fuller article.
  assert.equal(decideLiveUpdate(e, { hash: 'x', results: 1, length: 900 }, 200 * min).rewrite, false);
});

test('same event or same wording is not the same story', () => {
  // INCIDENTS #62: a start-time preview was dropped as a duplicate of a predictions
  // piece, and «CM Punk qualifies…» as a duplicate of «Lash Legend qualifies…».
  assert.ok(clearlyDifferentStories('AEW All Out 2026 Preview, Start Time, How To Watch', 'aew-all-out-2026-predictions-winners'));
  assert.ok(clearlyDifferentStories('CM Punk Qualifies For Men’s Money In The Bank On 9/25 WWE SmackDown', 'lash-legend-qualifies-for-womens-money-in-the-bank-on-9-25-wwe-smackdown'));
  assert.ok(!clearlyDifferentStories('Gable Steveson Denies 2019 Rape Allegation, Issues Statement On KO Loss', 'gable-steveson-breaks-silence-12-second-ufc-331-knockout-pre-fight-allegations'));
  assert.ok(!clearlyDifferentStories('Trick Williams Beats Baron Corbin In WWE SmackDown Steel Cage Match', 'trick-williams-retains-us-title-steel-cage-smackdown'));
});

test('a draft that dropped its hamzas is blocked, names and N-1 are not', () => {
  // INCIDENTS #64: Logan Paul petition — «انها»، «اطلق»، «اشار إلى ان»…
  const bad = checkArticle('إطلاق عريضة تطالب لوغان بول بقص شعره', 'اطلق صديقه عريضة، واشار إلى ان مظهره السابق افضل، مؤكدا انها حملة ساخرة وان الجميع سيوقع.', []);
  assert.ok(bad.some(i => i.code === 'hamza_dropped'));
  const ok = checkArticle('روب فان دام يدافع عن كيفن ناش', 'قال روب فان دام إن ناش محق، وتابع نزالات بطولة ان 1 فيكتوري بعد أن فاز فان دام.', []);
  assert.ok(!ok.some(i => i.code === 'hamza_dropped'));
});

test('a pre-show match card is not a results report', () => {
  // INCIDENTS #53: Ringside's live SmackDown page listed «X vs. Y» before the show
  // and was published as results with «الفائز: قيد الانتظار».
  assert.ok(isEmptyResultsStub('Ringside News will provide live, match-by-match updates. Stay tuned. Trick Williams (c) vs. Baron Corbin. CM Punk vs. Finn Balor. Charlotte Flair vs. Giulia.'));
  assert.ok(!isEmptyResultsStub('Trick Williams def. Baron Corbin to retain. CM Punk defeated Finn Balor. Giulia beats Charlotte Flair.'));
  // Ringside's play-by-play style is a real result too.
  assert.ok(!isEmptyResultsStub('Stay tuned. Williams hits a third Book End for the win. The winner of the Steel Cage Match, Trick Williams! Punk hits the GTS for the win. Flair hits Natural Selection for the win.'));
  const pending = checkArticle('نتائج عرض WWE SmackDown', '🏆 **الفائز:** قيد الانتظار', []);
  assert.ok(pending.some(i => i.code === 'vague_result'));
  // INCIDENTS #65: «الفائزة/الفائزان: قيد الانتظار» and a live page whose preview narrates past wins.
  assert.ok(checkArticle('نتائج عرض AEW All Out', '🏆 **الفائزة:** قيد الانتظار', []).some(i => i.code === 'vague_result'));
  assert.ok(checkArticle('نتائج عرض AEW All Out', '🏆 **الفائزان:** قيد الانتظار', []).some(i => i.code === 'vague_result'));
  assert.ok(isEmptyResultsStub("Welcome to Wrestling Inc.'s live coverage for AEW All Out. Ospreay defeated Omega at All In; Cage and Copeland retained against the Bucks; Okada won the title; Andrade defeated The Demand."));
});


test('an article that arrived during an Instagram pause is posted to Instagram after the pause, and nothing else is re-posted', async t => {
  // INCIDENTS #44: a 5h Instagram cooldown outlasted the 3h window and 16
  // articles never reached Instagram.
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [
    { url: '/news/paused/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(5), published_at: hours(5) },
    // 13h old when the pause ended: past the 12h catch-up limit, stays out.
    { url: '/news/old/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(14), published_at: hours(14) },
  ];
  const state: any = { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: { instagram: Date.now() - 3600_000 } };
  for (const slug of ['paused', 'old']) for (const p of ['telegram', 'facebook']) state[p][`httpssitetestnews${slug}`] = Date.now();
  state.cooldowns.instagram = Date.now() - 3600_000; // pause ended 1h ago, i.e. after both arrived
  delete state.telegram['httpssitetestnewsold']; // old: never on Telegram and must NOT be sent there now
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.includes('api.telegram.org')) sent.push('telegram');
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const touched = Object.keys(after.deferrals || {}).concat(Object.keys(after.instagram));
  assert.ok(touched.some(k => k === 'instagram:httpssitetestnewspaused' || k === 'httpssitetestnewspaused'), 'Instagram retried for the paused article');
  assert.ok(!touched.some(k => k.endsWith('httpssitetestnewsold') && !k.startsWith('instagram')), 'no other platform touched for stale articles');
  assert.ok(!sent.includes('telegram'), 'a stale article is never sent to Telegram');
});


test('sharing only a show name is not a duplicate (WWE Main Event results vs Main Event streaming news)', () => {
  // INCIDENTS #45
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-show-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'),
      `---\ndate: ${new Date().toISOString()}\nsource_url: "https://www.fightful.com/wrestling/wwe-main-event-heading-to-rumble-exclusively-in-october/"\n---\nbody`);
    assert.equal(findLikelyDuplicateStory('WWE Main Event Results (9/24)', 24, dir).isDuplicate, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('catch-up on remaining platforms uses when the article reached the site, not its source date', async t => {
  // INCIDENTS #46: recovered articles (source date 16h old, on the site 1.5h)
  // got Telegram+Facebook but Instagram catch-up judged them "too old".
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [{ url: '/news/recovered/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(16), published_at: hours(1.5) }];
  const state: any = { telegram: { httpssitetestnewsrecovered: Date.now() }, facebook: { httpssitetestnewsrecovered: Date.now() }, instagram: {}, x: {}, cooldowns: {} };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const touched = Object.keys(after.deferrals || {}).concat(Object.keys(after.instagram));
  assert.ok(touched.some(k => k.endsWith('httpssitetestnewsrecovered')), 'Instagram attempted for the recovered article');
});


test('Instagram actions keep a minimum gap so a backlog never goes out as a burst', async t => {
  // INCIDENTS #47: 4 Instagram posts in 3 minutes → "too many actions" → a
  // 6-hour Instagram block that also hit the show reels.
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [{ url: '/news/queued/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(1), published_at: hours(1) }];
  const state: any = { telegram: { httpssitetestnewsqueued: Date.now() }, facebook: { httpssitetestnewsqueued: Date.now() }, instagram: {}, x: {}, cooldowns: {} };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  const kv = new Map<string, string>([['ig_last_action_ts', String(Date.now() - 60_000)]]);
  const PUSH_KV = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  await runWatcherPoll({ ...env, PUSH_KV, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const igTouched = (st: any) => Object.keys(st.deferrals || {}).filter(k => k.startsWith('instagram:')).concat(Object.keys(st.instagram));
  assert.ok(!igTouched(after).some(k => k.endsWith('httpssitetestnewsqueued')), 'no Instagram attempt within 10 minutes of the previous one');
  kv.set('ig_last_action_ts', String(Date.now() - 11 * 60_000));
  await runWatcherPoll({ ...env, PUSH_KV, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const later = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(igTouched(later).some(k => k.endsWith('httpssitetestnewsqueued')), 'attempted once the gap has passed');
});

test('no correction rule matches its own correct form', () => {
  // 2026-09-25: an FTR rule written as «[اإ]ف تي [اآ]ر → إف تي آر» also matched the
  // right spelling, so QA flagged correct articles and the copy editor could never
  // write the approved name.
  const { corrections } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8'));
  const selfMatching = corrections.filter((c: any) => {
    if (!c.right) return false;
    const body = c.regex ? c.wrong : c.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\u0621-\\u064A])(?:${body})(?![\\u0621-\\u064A])`).test(c.right);
  }).map((c: any) => `${c.wrong} → ${c.right}`);
  assert.deepEqual(selfMatching, []);
});

test('corrections never undo each other and never rewrite a glossary spelling', () => {
  // 2026-09-26: «جايسي جاين → جيسي جين» was added while «جيسي جين → جايسي جاين»
  // existed — the two rules flipped the name back and forth (INCIDENTS #58).
  const { corrections } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8'));
  const plain = new Map<string, string>(corrections.filter((c: any) => !c.regex).map((c: any) => [c.wrong, c.right]));
  assert.deepEqual([...plain].filter(([w, r]) => plain.get(r) === w), []);
  const glossary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/wrestler-names.json'), 'utf8'));
  assert.deepEqual(Object.entries(glossary).filter(([, v]) => typeof v === 'string' && plain.has(v as string)), []);
});

test('a waiting show reel reserves the next Instagram slot over news', async t => {
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [{ url: '/news/queued/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: hours(1), published_at: hours(1) }];
  const state: any = { telegram: { httpssitetestnewsqueued: Date.now() }, facebook: { httpssitetestnewsqueued: Date.now() }, instagram: {}, x: {}, cooldowns: {} };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  // Gap already satisfied (20 min), but a reel is waiting for the slot.
  const kv = new Map<string, string>([['ig_last_action_ts', String(Date.now() - 20 * 60_000)], ['ig_video_waiting', String(Date.now() - 60_000)]]);
  const PUSH_KV = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  await runWatcherPoll({ ...env, PUSH_KV, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const ig = Object.keys(after.deferrals || {}).filter(k => k.startsWith('instagram:')).concat(Object.keys(after.instagram));
  assert.ok(!ig.some(k => k.endsWith('httpssitetestnewsqueued')), 'news leaves the Instagram slot to the waiting reel');
});

test('news stops using Instagram once the daily budget (minus the video reserve) is spent', async t => {
  const database = ledger();
  const items = [{ url: '/news/capped/', title: 'خبر عام', description: 'تفاصيل الخبر', kind: 'news', date: new Date(Date.now() - 3600_000).toISOString(), published_at: new Date(Date.now() - 3600_000).toISOString() }];
  const state: any = { telegram: { httpssitetestnewscapped: Date.now() }, facebook: { httpssitetestnewscapped: Date.now() }, instagram: {}, x: {}, cooldowns: {} };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  const spent = Array.from({ length: 33 }, (_, i) => Date.now() - (i + 1) * 20 * 60_000);
  const kv = new Map<string, string>([['ig_last_action_ts', String(Date.now() - 30 * 60_000)], ['ig_actions_24h', JSON.stringify(spent)]]);
  const PUSH_KV = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  await runWatcherPoll({ ...env, PUSH_KV, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const ig = Object.keys(after.deferrals || {}).filter(k => k.startsWith('instagram:')).concat(Object.keys(after.instagram));
  assert.ok(!ig.some(k => k.endsWith('httpssitetestnewscapped')), 'news leaves the remaining daily budget to show reels');
});

test("results matches left with only a «---» separator get a numbered heading", () => {
  const body = "مقدمة.\n\n**المواجهة الأولى: نزال تورنيدو للفرق**\n\nفريق Hyperactive يفوز.\n\n🏆 **الفائز:** فريق Hyperactive\n\n---\nكورو يحقق الفوز على ليدز لويس.\n\n🏆 **الفائز:** كورو\n\n**المواجهة الرابعة: بطولة 24/7**\n\nكيلر كيلي تتوج.\n\n🏆 **الفائزة:** كيلر كيلي\n\n**الحدث الرئيسي (Main Event): اللقب**\n\nأهورا يحتفظ.\n\n🏆 **الفائز:** أهورا";
  const fixed = autoFix(body);
  assert.match(fixed, /\*\*المواجهة الثانية\*\*\n+كورو/);
  assert.match(fixed, /\*\*المواجهة الثالثة: بطولة 24\/7\*\*/);
  assert.ok(!/^---$/m.test(fixed));
  assert.match(fixed, /\*\*الحدث الرئيسي \(Main Event\): اللقب\*\*/);
  // A news article with a plain «---» and no match headings is untouched.
  const plain = "فقرة.\n\n---\nفقرة أخرى.\n\n🏆 ليس تقريرا";
  assert.equal(headUnheadedMatches(plain), plain);
});

test("sweep leftovers: doubled federation, stray «The» before Arabic, Knockouts TV untouched", () => {
  assert.equal(autoFix("في عرض WWE WWE RAW القادم"), "في عرض WWE RAW القادم");
  assert.equal(autoFix("فريق The نيو ليفل ضد The Bloodline"), "فريق ذا نيو ليفل ضد The Bloodline");
  assert.equal(applyCorrections("بطولة TNA Knockouts TV للسيدات"), "بطولة TNA Knockouts TV للسيدات");
  assert.equal(applyCorrections("بطولة TNA Knockouts World Championship."), "بطولة TNA العالمية للسيدات.");
  // Renumbering keeps what a heading says; untouched when no match lacks a heading.
  const h = "**المواجهة الثانية (نزال فردي): أ**\n\nس";
  assert.equal(headUnheadedMatches(h), h);
});

test("the copy editor without a source only corrects — never rewrites, invents or deletes (INCIDENTS #70)", async () => {
  const { editStaysClose, applyProofEdits } = await import('../scripts/editorial');
  assert.ok(editStaysClose("أوميجا", "أوميغا"));
  assert.ok(editStaysClose("قبولاعند", "قبولا عند"));
  assert.ok(editStaysClose("🏆 **الفائزة:** قيد الانتظار", ""));
  assert.ok(editStaysClose("قدم اتحاد AEW حلقة نارية ومثيرة من عرض Dynamite", "قدم اتحاد AEW عرضا ناريا ومثيرا من عرض Dynamite"));
  assert.ok(!editStaysClose("نيك وين (نيك واين).", "نيك واين (البطل) ضد بانديدو."));
  assert.ok(!editStaysClose("تدخل البطلة فلامر ورد حاسم بحركة Pop Rox", ""));
  assert.ok(!editStaysClose("لـليزاي راين", "لـلايني ريد"));
  assert.ok(!editStaysClose("نهائي بطولة Tokyo Princess Cup 2026", "نهائي بطولة كأس أميرة طوكيو 2026"));
  assert.ok(!editStaysClose("أرييل وسامي لين", "أرييل وساامي لين"));
  assert.ok(!editStaysClose("وتحديد مواجهة جماعية كبرى.", "وتحديد مواجهة جماعية كبرى *"));
  const out = applyProofEdits({ title: "ت", body: "عودة وظهور خاص للنجمة بايج.", tags: [] }, [{ field: "body", find: "للنجمة بايج", replace: "للنجمة سارايا" } as any]);
  assert.equal(out.article.body, "عودة وظهور خاص للنجمة بايج.");
  assert.equal(autoFix("* المباراة (بطولة WWE الموحدة - بطل (الاتحاد)): أ"), "* المباراة (بطولة WWE الموحدة): أ");
});

test("glued separators and banned filler are cleaned (INCIDENTS #72)", () => {
  assert.equal(autoFix("🏆 x\n\n---**المواجهة الثانية: فرق**\n\nنص."), "🏆 x\n\n---\n\n**المواجهة الثانية: فرق**\n\nنص.");
  assert.equal(autoFix("تجهيزا للمنافسات القوية، تواجه فريق أ ضد فريق ب."), "تواجه فريق أ ضد فريق ب.");
  assert.equal(autoFix("أقيم عرض AEW All Out في شيكاغو، وشهد العرض مواجهات حماسية وتحديات على عدة ألقاب كبرى."), "أقيم عرض AEW All Out في شيكاغو.");
});

test("filler removal never cuts inside a word; self-promo lines, <br> and Burmese letters are handled", () => {
  assert.equal(autoFix("إلى جانب نزال اللقب، يشهد العرض مواجهات قوية أخرى تتضمن لقاء."), "إلى جانب نزال اللقب، يشهد العرض مواجهات قوية أخرى تتضمن لقاء.");
  assert.equal(autoFix("أقيم العرض في اليابان. شهد العرض مواجهات قوية وحماسية بين النجوم، وإليكم النتائج.\n\nنص"), "أقيم العرض في اليابان.\n\nنص");
  assert.equal(autoFix("نص.\n\nلا تنسى زيارة موقعنا باستمرار لمتابعة أحدث الأخبار---").trim(), "نص.");
  assert.equal(autoFix("---\n<br><br>**المواجهة الأولى**<br><br>نص"), "---\n\n**المواجهة الأولى**\n\nنص");
  // INCIDENTS #93: a paragraph cut off on a comma is closed; list lines are left alone
  assert.equal(autoFix("يذكر أن النجمة تحدثت عن النزال الذي أدى إلى غيابها عام 2022، \n\nhttps://x.com/a"), "يذكر أن النجمة تحدثت عن النزال الذي أدى إلى غيابها عام 2022.\n\nhttps://x.com/a");
  assert.equal(autoFix("- فاز فريق ذا هارديز على الثنائي في نزال طويل وصعب،"), "- فاز فريق ذا هارديز على الثنائي في نزال طويل وصعب،");
  assert.ok(checkArticle("عنوان عربي", "مာ**المواجهة**", []).some(i => i.code === "foreign_script"));
});

test("one results report per show: another source's report of the same show is a duplicate (weekly shows need the same date)", async () => {
  const { showResultsKey, findSameShowResults } = await import('../scripts/fightful-watcher');
  assert.deepEqual(showResultsKey("AEW All Out Results 9/26 - Several Titles On The Line, Two #1 Contenders Matches"), { name: "aew all out", md: "9/26" });
  assert.deepEqual(showResultsKey("AEW All Out 2026 Results (9/26)"), { name: "aew all out", md: "9/26" });
  assert.notEqual(showResultsKey("wXw Pro-Wrestling Grand Prix 2026 Day 1 Results (9/25)").name, showResultsKey("wXw Pro-Wrestling Grand Prix 2026 Day 2 Results (9/26)").name);
  const fs = await import('fs'); const os = await import('os'); const path = await import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showres-'));
  const now = new Date(Date.now() - 2 * 3600_000).toISOString();
  fs.writeFileSync(path.join(dir, '20260927010000-all-out.md'), `---\ntitle: "x"\ndate: ${now}\nsource_title: "AEW All Out Results 9/26 - Several Titles On The Line"\nsource_results: 6\n---\nbody`);
  fs.writeFileSync(path.join(dir, '20260927010001-njpw.md'), `---\ntitle: "x"\ndate: ${now}\nsource_title: "NJPW Road To Destruction Results (9/21)"\nsource_results: 6\n---\nbody`);
  assert.equal(findSameShowResults("AEW All Out 2026 Results (9/26)", 30, dir).isDuplicate, true);
  assert.equal(findSameShowResults("NJPW Road To Destruction Results (9/22)", 30, dir).isDuplicate, false);
  assert.equal(findSameShowResults("AEW Collision Results (9/26)", 30, dir).isDuplicate, false);
});

test("a finished show's results title states the outcome, taken from the report's own winner lines", async () => {
  const { resultsTitleOutcome } = await import('../scripts/news-qa');
  const body = "**المواجهة الأولى: نزال فردي**\n\nتغلب مستر إغوانا على تيروس.\n\n🏆 **الفائز:** مستر إغوانا\n";
  assert.equal(resultsTitleOutcome("نتائج عرض AAA on FOX (26 سبتمبر 2026): مستر إغوانا في مواجهة تيروس", body), "نتائج عرض AAA on FOX (26 سبتمبر 2026): مستر إغوانا يتغلب على تيروس");
  assert.equal(resultsTitleOutcome("نتائج عرض X (1 أكتوبر 2026): تيروس في مواجهة مستر إغوانا", body), "نتائج عرض X (1 أكتوبر 2026): مستر إغوانا يتغلب على تيروس");
  const fem = "**المواجهة السادسة**\n\nتغلبت كاي لي راي على ستيفاني ميز.\n\n🏆 **الفائزة:** كاي لي راي\n";
  assert.equal(resultsTitleOutcome("نتائج عرض wXw (25 سبتمبر 2026): كاي لي راي ضد ستيفاني ميز", fem), "نتائج عرض wXw (25 سبتمبر 2026): كاي لي راي تتغلب على ستيفاني ميز");
  // A two-part subtitle or a descriptive phrase is left alone.
  assert.equal(resultsTitleOutcome("نتائج عرض TNA iMPACT (17 سبتمبر 2026): موس يواجه فرانكي كازاريان بمسيرته.. وليون سلاتر يتألق", "**المواجهة**\nموس ضد فرانكي كازاريان\n🏆 **الفائز:** موس"), "نتائج عرض TNA iMPACT (17 سبتمبر 2026): موس يواجه فرانكي كازاريان بمسيرته.. وليون سلاتر يتألق");
  assert.equal(resultsTitleOutcome("نتائج عرض X (13 سبتمبر 2025): أكس كولون وإيفي في مواجهة دامية ضد فريق ذا ريجكتس", "🏆 **الفائز:** أكس كولون وإيفي"), "نتائج عرض X (13 سبتمبر 2025): أكس كولون وإيفي في مواجهة دامية ضد فريق ذا ريجكتس");
  // Unknown winner (live page, no 🏆 for that match) or not a results title: untouched.
  assert.equal(resultsTitleOutcome("نتائج عرض AEW All Out (26 سبتمبر 2026): أوسبراي في مواجهة موكسلي", body), "نتائج عرض AEW All Out (26 سبتمبر 2026): أوسبراي في مواجهة موكسلي");
  assert.equal(resultsTitleOutcome("أوسبراي في مواجهة موكسلي", body), "أوسبراي في مواجهة موكسلي");
});

test("a Fightful story's featured video (outside the API content) is found (INCIDENTS #78)", async () => {
  const { extractFeaturedVideos } = await import('../scripts/fightful-watcher');
  const page = '<div class="featured-area"><div class="featured-area-inner"><div class="post-video"><iframe width="560" height="315" src="https://www.youtube.com/embed/CxC1DbTl89U" frameborder="0" allowfullscreen></iframe></div></div></div><div class="entry-content"><p>Catch…</p></div><aside><img data-src="https://img.youtube.com/vi/DxMUL5DA2qM/maxresdefault.jpg"></aside>';
  assert.deepEqual(extractFeaturedVideos(page), ["https://www.youtube.com/watch?v=CxC1DbTl89U"]);
  assert.deepEqual(extractFeaturedVideos('<div class="entry-content"><p>no video</p></div>'), []);
});

test("a story about a match at tonight's show is kept off social even with an announcement title (INCIDENTS #79)", async () => {
  const { revealsTonightsMatch } = await import('../scripts/fightful-watcher');
  const shows = ["aew all out"];
  assert.equal(revealsTonightsMatch("Thekla Vs. Mercedes Mone For AEW Women's World Title Official For AEW WrestleDream", "Thekla gets a title shot against Mercedes Mone at AEW WrestleDream. At AEW All Out 2026, Thekla and Willow Nightingale went up against each other to determine Mercedes Mone's challenger.", shows), true);
  // A crowd moment or a segment at the same show is not a match outcome.
  assert.equal(revealsTonightsMatch("Marina Shafir Chokes Out Woman During Andrade's Selfie Moment At AEW All Out", "Marina Shafir choked out a fan during Andrade's selfie segment at AEW All Out.", shows), false);
  // A story about another show is untouched.
  assert.equal(revealsTonightsMatch("Harley Cameron Reveals Knee Injury", "Harley Cameron said she hurt her knee teaming with Kris Statlander, and they won at AEW All In.", shows), false);
  assert.equal(revealsTonightsMatch("X Official For AEW WrestleDream", "At AEW All Out, X won.", []), false);
  // INCIDENTS #98: the result deep in a story about the show
  assert.equal(revealsTonightsMatch("How Will Ospreay's Assassin's Creed Entrance At AEW All Out Came Together", "The entrance at AEW All Out was months in the making. " + "Ubisoft brought in the voice actor. ".repeat(30) + "Ospreay then defeated Jon Moxley to retain the AEW World Title.", shows), true);
  assert.equal(revealsTonightsMatch("Donovan Dijak Blasts Fans Mocking Injured Wrestlers", "Dijak said he saw three examples during AEW All Out night alone. " + "People mock injuries. ".repeat(40), shows), false);
});

test("the worker lets Arabic titles about a return that hasn't happened through (INCIDENTS #95)", async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler("كوري غريفز يؤكد حصوله على التصريح الطبي ولا يستبعد العودة إلى المصارعة"), false);
  assert.equal(isSingleMatchSpoiler("أنتوني هنري نجم AEW لا يعرف ما إذا كان سيعود إلى المصارعة الحرة"), false);
  assert.equal(isSingleMatchSpoiler("ساموا جو يعود في عرض AEW All Out"), true);
  assert.equal(isSingleMatchSpoiler("عودة مفاجئة لنجم سابق في عرض الرو"), true);
});

test("a title never repeats its subject, and a bare finished results title names the main-event winner (INCIDENTS #96)", async () => {
  const { numberWordsInTitle, resultsTitleOutcome } = await import('../scripts/news-qa');
  assert.equal(numberWordsInTitle("ثاندر روزا تتحدث ثاندر روزا عن نزالها التاريخي"), "ثاندر روزا تتحدث عن نزالها التاريخي");
  assert.equal(numberWordsInTitle("كين يعتبر تريبل إتش أفضل عقل"), "كين يعتبر تريبل إتش أفضل عقل");
  const body = "**المواجهة الأولى: نزال فردي**\n\nتغلب أ على ب.\n\n🏆 **الفائز:** أ\n\n**الحدث الرئيسي (Main Event): بطولة wXw العالمية الموحدة**\n\nتغلب أهورا على ميرون ريد.\n\n🏆 **الفائز:** أهورا";
  assert.equal(resultsTitleOutcome("نتائج عرض wXw Pro-Wrestling Grand Prix (الليلة الثانية)", body), "نتائج عرض wXw Pro-Wrestling Grand Prix (الليلة الثانية): فوز أهورا في الحدث الرئيسي");
  // Still live (no main-event winner yet): untouched
  assert.equal(resultsTitleOutcome("نتائج عرض TNA iMPACT (24 سبتمبر 2026)", "**المواجهة الأولى**\n\nنص"), "نتائج عرض TNA iMPACT (24 سبتمبر 2026)");
});

test("videos stay, social posts are capped, and «دفع عن» becomes «دافع عن» (INCIDENTS #98)", async () => {
  const { MAX_SOCIAL_EMBEDS } = await import('../scripts/fightful-watcher');
  assert.equal(MAX_SOCIAL_EMBEDS, 4);
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections("والتي دفع فيها عن بطولة AEW الوطنية"), "والتي دافع فيها عن بطولة AEW الوطنية");
  const { autoFix } = await import('../scripts/news-qa');
  assert.equal(autoFix("نص الخبر.\n\nما رأيك في دخول ويل أوسبراي في عرض AEW All Out? هل تراه الأفضل?").trim(), "نص الخبر.");
  assert.equal(autoFix("من غريمتها بريت بيكر, موضحة أنها"), "من غريمتها بريت بيكر، موضحة أنها");
  assert.equal(autoFix("قال: What's Your Story? هنا"), "قال: What's Your Story? هنا");
});

test("a promotion war is not a match result (INCIDENTS #97)", async () => {
  const { leadHasMatchResult } = await import('../scripts/fightful-watcher');
  assert.equal(leadHasMatchResult("", "Jonathan Coachman Explains Why AEW Won Battle Against WWE In Chicago"), false);
  assert.equal(leadHasMatchResult("", "AEW Beat WWE In Ticket Sales"), false);
  assert.equal(leadHasMatchResult("", "Kevin Knight Wins Battle Royal At AEW Collision"), true);
  assert.equal(leadHasMatchResult("", "Swerve Strickland Won The Match At All Out"), true);
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler("جوناثان كوتشمان يوضح لماذا تفوقت AEW في المعركة ضد WWE في شيكاغو"), false);
});

test("a return that has not happened yet is not a spoiler (INCIDENTS #95)", async () => {
  const { isReturnOrDebutStory } = await import('../scripts/fightful-watcher');
  assert.equal(isReturnOrDebutStory("AEW's Anthony Henry Doesn't Know If He'll Return To Pro Wrestling"), false);
  assert.equal(isReturnOrDebutStory("Cody Rhodes Hopes To Return Before WrestleMania"), false);
  assert.equal(isReturnOrDebutStory("Samoa Joe Returns At AEW All Out"), true);
  assert.equal(isReturnOrDebutStory("Former Champion Makes Surprise Return On RAW"), true);
});

test("a match at a show from the last three days is still a spoiler the next day (INCIDENTS #94)", async () => {
  const { recentShowNames, revealsTonightsMatch } = await import('../scripts/fightful-watcher');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-'));
  const report = (hoursAgo: number, name: string) => `---\npublished_at: ${new Date(Date.now() - hoursAgo * 3600_000).toISOString()}\nsource_title: "${name} Results (9/26/2026)"\n---\nنص\n`;
  fs.writeFileSync(path.join(dir, '20260927030000-all-out.md'), report(15, 'AEW All Out 2026'));
  fs.writeFileSync(path.join(dir, '20260920030000-old.md'), report(24 * 5, 'WWE Old Show'));
  const shows = recentShowNames(undefined, dir);
  assert.ok(shows.includes('aew all out'), JSON.stringify(shows));
  assert.ok(!shows.some(s => s.includes('old show')));
  assert.equal(revealsTonightsMatch("Andrade: Pac Has To Be A World Champion In The Future, But He Needs To Leave The Death Riders",
    "Andrade comments after wrestling Pac at AEW All Out. On the show, he defended his AEW National Championship against Pac and retained the belt successfully.", shows), true);
});

test("a vague results title names the main-event winner from the report (INCIDENTS #80)", async () => {
  const { resultsTitleOutcome } = await import('../scripts/news-qa');
  // «بطل جديد… والتفاصيل الكاملة» says nothing either (INCIDENTS #94)
  assert.equal(resultsTitleOutcome("نتائج عرض SLA Mega Ticket (25 سبتمبر 2026): بطل جديد للبطولة والتفاصيل الكاملة", "**الحدث الرئيسي: بطولة Gateway Heritage**\n\nفازت لايني ريد على مات فيتشيت.\n\n🏆 **الفائزة:** لايني ريد"), "نتائج عرض SLA Mega Ticket (25 سبتمبر 2026): فوز لايني ريد في الحدث الرئيسي");
  const body = "**المواجهة الأولى: نزال فردي**\n\n🏆 **الفائز:** دراغون لي\n\n**الحدث الرئيسي (Main Event): نزال فرق سداسي**\n\nانتصر فريق سي ام بانك.\n\n🏆 **الفائز:** فريق سي ام بانك وري ميستيريو وإل غراندي أمريكانو\n";
  assert.equal(resultsTitleOutcome("نتائج عرض WWE x AAA Worlds Collide (26 سبتمبر 2026): مواجهات كبرى بقيادة سي ام بانك وري ميستيريو ودومينيك ميستيريو", body),
    "نتائج عرض WWE x AAA Worlds Collide (26 سبتمبر 2026): فوز فريق سي ام بانك وري ميستيريو وإل غراندي أمريكانو في الحدث الرئيسي");
  // A title that already states an outcome is left alone.
  assert.equal(resultsTitleOutcome("نتائج عرض X (1 أكتوبر 2026): بانك يحتفظ باللقب.. ومواجهات قوية", body), "نتائج عرض X (1 أكتوبر 2026): بانك يحتفظ باللقب.. ومواجهات قوية");
  // «الفائز (وما زال البطل):» — a note in parentheses before the name.
  assert.equal(resultsTitleOutcome("نتائج عرض AEW All Out (26 سبتمبر 2026): عدة نزالات على الألقاب", "**الحدث الرئيسي (Main Event): بطولة AEW العالمية**\n\nاحتفظ ويل أوسبراي باللقب.\n\n🏆 **الفائز (وما زال البطل):** ويل أوسبراي\n"), "نتائج عرض AEW All Out (26 سبتمبر 2026): فوز ويل أوسبراي في الحدث الرئيسي");
  // A bare line-up title of a finished show names the main-event winner; while the main
  // event has no winner yet (live report), it is left alone.
  const kobe = "**الحدث الرئيسي (Main Event): بطولة IWGP العالمية**\n\n🏆 **الفائز:** يوتا تسوجي\n";
  assert.equal(resultsTitleOutcome("نتائج عرض NJPW Destruction in Kobe (27 سبتمبر 2026): يوتا تسوجي ضد هيرووكي غوتو وجيب كيد ضد دريلا مولوني", kobe), "نتائج عرض NJPW Destruction in Kobe (27 سبتمبر 2026): فوز يوتا تسوجي في الحدث الرئيسي");
  assert.equal(resultsTitleOutcome("نتائج عرض NJPW Destruction in Kobe (27 سبتمبر 2026): يوتا تسوجي ضد هيرووكي غوتو وجيب كيد ضد دريلا مولوني", "**المواجهة الأولى**\n\n🏆 **الفائز:** يوه\n"), "نتائج عرض NJPW Destruction in Kobe (27 سبتمبر 2026): يوتا تسوجي ضد هيرووكي غوتو وجيب كيد ضد دريلا مولوني");
  // A team whose name starts with «في» (VNDL48 → «في إن دي إل 48») keeps its name.
  assert.equal(resultsTitleOutcome("نتائج عرض GCW The Score (26 سبتمبر 2026): فوز فريق في الحدث الرئيسي", "**الحدث الرئيسي (Main Event): نزال فرق**\n\n🏆 **الفائزون:** فريق في إن دي إل 48 (أتيكوس كوغار وأوتيس كوغار)\n"), "نتائج عرض GCW The Score (26 سبتمبر 2026): فوز فريق في إن دي إل 48 في الحدث الرئيسي");
  // No main-event block: untouched.
  assert.equal(resultsTitleOutcome("نتائج عرض X (1 أكتوبر 2026): ليلة حافلة", "🏆 **الفائز:** أ"), "نتائج عرض X (1 أكتوبر 2026): ليلة حافلة");
});

test("two shows with the same title get different URLs instead of breaking the build (INCIDENTS #83)", async () => {
  const fs = await import('fs'); const os = await import('os'); const path = await import('path');
  const { createRequire } = await import('module');
  const { showPath } = createRequire(import.meta.url)('../lib/show-permalink.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shows-'));
  fs.writeFileSync(path.join(dir, '20260920104600-lucha-libre-aaa-19-09-2026.md'), '---\ntitle: Lucha Libre AAA 19.09.2026\n---\n');
  fs.writeFileSync(path.join(dir, '20260927053700-lucha-libre-aaa-19-09-2026.md'), '---\ntitle: Lucha Libre AAA 19.09.2026\n---\n');
  assert.equal(showPath('20260920104600-lucha-libre-aaa-19-09-2026.md', 'Lucha Libre AAA 19.09.2026', dir, true), '/shows/lucha-libre-aaa-19-09-2026/');
  assert.equal(showPath('20260927053700-lucha-libre-aaa-19-09-2026.md', 'Lucha Libre AAA 19.09.2026', dir), '/shows/lucha-libre-aaa-19-09-2026-2/');
});

test("counts in titles are written in words with the right gender (INCIDENTS #85)", async () => {
  const { numberWordsInTitle } = await import('../scripts/news-qa');
  assert.equal(numberWordsInTitle("عرض AEW All Out: 3 أمور كرهناها و3 أمور أحببناها"), "عرض AEW All Out: ثلاثة أمور كرهناها وثلاثة أمور أحببناها");
  assert.equal(numberWordsInTitle("5 مواجهات نارية في عرض RAW"), "خمس مواجهات نارية في عرض RAW");
  assert.equal(numberWordsInTitle("أفضل 10 لحظات في WrestleMania"), "أفضل عشر لحظات في WrestleMania");
  assert.equal(numberWordsInTitle("عرضي AEW Dynamite وAEW Collision: 3 أمور كرهناها و3 أحببناها"), "عرضي AEW Dynamite وAEW Collision: ثلاثة أمور كرهناها وثلاثة أحببناها");
  assert.equal(numberWordsInTitle("طردوني بعد الجراحة بـ 6 أيام!"), "طردوني بعد الجراحة بستة أيام!");
  assert.equal(numberWordsInTitle("موعد عودة SmackDown لـ 3 ساعات"), "موعد عودة SmackDown لثلاث ساعات");
  // Dates, money, scores and nouns of unknown gender stay as they are.
  assert.equal(numberWordsInTitle("نتائج عرض WWE RAW (21 سبتمبر 2026)"), "نتائج عرض WWE RAW (21 سبتمبر 2026)");
  assert.equal(numberWordsInTitle("صفقة بقيمة 3 ملايين دولار"), "صفقة بقيمة 3 ملايين دولار");
  assert.equal(numberWordsInTitle("عرض 7 أكتوبر"), "عرض 7 أكتوبر");
});

test("a story's body counts only unmistakable match-result wording (INCIDENTS #88)", async () => {
  const { isSingleMatchResultArticle } = await import('../scripts/fightful-watcher');
  assert.equal(isSingleMatchResultArticle("Paige Calls Out Fan Obsession With Female Wrestlers Changing Gear Every Week", "Paige has dealt with plenty of criticism since returning to WWE. Right after joking that her SmackDown entrance was lost to a commercial break, the WWE star answered a fan."), false);
  assert.equal(isSingleMatchResultArticle("Jack Perry And Samoa Joe Face Off", "Jack Perry defeated Katsuyori Shibata in a Tailgate Brawl before Samoa Joe appeared."), true);
});

test("the names glossary never holds a common English word, and names inside an English show name stay English (INCIDENTS #90)", async () => {
  const fs = await import('fs');
  const g = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  const COMMON = ["Big","Little","King","Queen","The","Man","Boy","Girl","Gay","Party","Night","Day","Show","Cup","War","Best","Real","Great","Young","Old","New","Top","Star","Gold","Bad","Good"];
  assert.deepEqual(COMMON.filter(w => w in g), []);
  const { applyNamesGlossary } = await import('../scripts/fightful-watcher');
  assert.equal(applyNamesGlossary("نتائج عرض TNT Extreme Effy's Big Gay Brunch"), "نتائج عرض TNT Extreme Effy's Big Gay Brunch");
  assert.equal(applyNamesGlossary("فاز Effy على خصمه"), "فاز إيفي على خصمه");
});


test('the spoiler shield records what it held, for the owner to review in the panel', async t => {
  const database = ledger();
  const items = [{ url: '/news/joe-returns/', title: 'ساموا جو يعود في عرض AEW All Out', description: 'تفاصيل', kind: 'news', date: new Date(Date.now() - 600_000).toISOString(), published_at: new Date(Date.now() - 600_000).toISOString() }];
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify({ telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} })).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  const key = 'httpssitetestnewsjoe-returns';
  assert.ok(after.telegram[key] && after.facebook[key] && after.instagram[key], 'kept off every platform');
  assert.equal(after.held[key].reason, 'return');
  assert.equal(after.held[key].url, '/news/joe-returns/');
  assert.match(after.held[key].title, /ساموا جو/);
});

test('a story the owner releases from the hold is posted even when it is older than the usual window', async t => {
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [
    { url: '/news/fresh/', title: 'خبر عام', description: 'تفاصيل', kind: 'news', date: hours(1), published_at: hours(1) },
    { url: '/news/released/', title: 'ساموا جو يعود في عرض AEW All Out', description: 'تفاصيل', kind: 'news', date: hours(30), published_at: hours(30) },
    { url: '/news/not-released/', title: 'خبر قديم', description: 'تفاصيل', kind: 'news', date: hours(31), published_at: hours(31) },
  ];
  const state: any = { telegram: { httpssitetestnewsfresh: Date.now() }, facebook: { httpssitetestnewsfresh: Date.now() }, instagram: { httpssitetestnewsfresh: Date.now() }, x: { httpssitetestnewsfresh: Date.now() }, cooldowns: {},
    released: { httpssitetestnewsreleased: Date.now() - 60_000 } };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  const opened: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.startsWith('https://site.test/')) { opened.push(decodeURIComponent(new URL(url).pathname)); return new Response('', { status: 404 }); }
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  assert.ok(opened.some(p => p.startsWith('/news/released')), 'the released story went on to be checked live and posted');
  assert.ok(!opened.some(p => p.startsWith('/news/not-released')), 'an old story nobody released stays out');
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(!after.telegram.httpssitetestnewsreleased, 'the shield does not hold a released story again');
});

test('a story that already reached a platform is not listed as held when a later edit makes it a spoiler', async t => {
  const database = ledger();
  const items = [{ url: '/news/edited/', title: 'ساموا جو يعود في عرض AEW All Out', description: 'تفاصيل', kind: 'news', date: new Date(Date.now() - 600_000).toISOString(), published_at: new Date(Date.now() - 600_000).toISOString() }];
  const file = '/repos/owner/repo-edited/contents/_data/publish-state.json'; // own repo name: no cached state from the tests before
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify({ telegram: { httpssitetestnewsedited: Date.now() - 300_000 }, facebook: {}, instagram: {}, x: {}, cooldowns: {} })).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, GITHUB_REPO: 'repo-edited', SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(after.facebook.httpssitetestnewsedited, 'stopped before the other platforms');
  assert.ok(!after.held?.httpssitetestnewsedited, 'not offered to the owner as held');
});

test('when the main AI model is overloaded (503), the story is written with a fallback model instead of waiting', () => {
  // INCIDENTS #102: gemini-3.5-flash-lite answered «high demand» for 3+ hours; no Fightful story was written.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-gemini-fallback-'));
  try {
    const script = `
      globalThis.setTimeout = ((fn) => { fn(); return 0; });
      const calls = [];
      globalThis.fetch = async (url, init) => {
        const model = String(url).match(/models\\/([^:]+):/)[1];
        calls.push(model + ':' + (JSON.parse(init.body).generationConfig.thinkingConfig ? 'nothink' : 'default'));
        if (model === 'gemini-3.5-flash-lite' || model === 'gemini-3.6-flash') return new Response('{"error":{"code":503}}', { status: 503 });
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
      };
      const m = await import(${JSON.stringify(path.resolve('scripts/fightful-watcher.ts'))});
      const text = await m.queryGemini('prompt');
      console.log(JSON.stringify({ text, calls }));
    `;
    fs.writeFileSync(path.join(dir, 'run.mts'), script);
    const out = execSync(`${JSON.stringify(path.resolve("node_modules/.bin/tsx"))} run.mts`, {
      cwd: dir, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEYS: 'k1', GEMINI_API_KEY: 'k1', GEMINI_MODEL: '', GEMINI_FALLBACK_MODELS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r = JSON.parse(out.trim().split('\n').pop()!);
    assert.equal(r.text, '{"ok":true}');
    assert.deepEqual(r.calls, ['gemini-3.5-flash-lite:default', 'gemini-3.5-flash-lite:default', 'gemini-3.5-flash-lite:default', 'gemini-3.6-flash:nothink', 'gemini-flash-latest:nothink']);
    // Counted like any other call (the daily safety cap still applies)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'watcher-state.json'), 'utf8')).apiCallsToday, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a story the writer flagged goes to social when its title and opening give nothing away, and is held when the opening does', async t => {
  // INCIDENTS #104: the flag alone held a tribute, a medical clearance and a match announcement.
  const database = ledger();
  const fresh = new Date(Date.now() - 600_000).toISOString();
  const items = [
    { url: '/news/tribute/', title: 'الجماهير تتدفق على منشور أندرادي الأخير', description: 'تحولت صفحة التعليقات على منشور أندرادي إلى مساحة للعزاء بعد إعلان وفاة باك.', kind: 'news', date: fresh, published_at: fresh, single_match_result: true },
    { url: '/news/challenge/', title: 'ويل أوسبراي يتحدى كازوتشيكا أوكادا لنزال في عرض Grand Slam باريس', description: 'تلقى أوسبراي تحديا جديدا عقب نجاحه في تجاوز عقبة جون موكسلي في عرض AEW All Out.', kind: 'news', date: fresh, published_at: fresh, single_match_result: true },
  ];
  const file = '/repos/owner/repo-flag/contents/_data/publish-state.json'; // own repo name: no cached state from other tests
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify({ telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} })).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.startsWith('https://site.test/')) return new Response('', { status: 404 });
    return database.fetch(input, init);
  });
  for (let i = 0; i < 3; i++) await runWatcherPoll({ ...env, GITHUB_REPO: 'repo-flag', SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(!after.held?.httpssitetestnewstribute && !after.telegram.httpssitetestnewstribute, 'the tribute is not held (it only waits for the live page)');
  assert.equal(after.held?.httpssitetestnewschallenge?.why, 'lead', 'the challenge story says Ospreay got past Moxley in its opening');
});

test('the AI read of the finished title + opening holds a story the word rules miss', async t => {
  // INCIDENTS #105: word lists always miss a phrasing; the writer stores an AI verdict with the story.
  const database = ledger();
  const fresh = new Date(Date.now() - 600_000).toISOString();
  const items = [
    { url: '/news/ai-held/', title: 'أوسبراي يواصل مشواره مع اللقب بعد ليلة شيكاغو', description: 'تفاصيل', kind: 'news', date: fresh, published_at: fresh, single_match_result: false, social_spoiler: true, social_spoiler_kind: 'result', social_spoiler_note: 'العنوان بيقول إنه لسه البطل بعد العرض' },
    { url: '/news/ai-clean/', title: 'خبر عام عن تعاقد جديد', description: 'تفاصيل', kind: 'news', date: fresh, published_at: fresh, single_match_result: false, social_spoiler: false },
  ];
  const file = '/repos/owner/repo-ai/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify({ telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} })).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.startsWith('https://site.test/')) return new Response('', { status: 404 });
    return database.fetch(input, init);
  });
  for (let i = 0; i < 3; i++) await runWatcherPoll({ ...env, GITHUB_REPO: 'repo-ai', SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.equal(after.held?.['httpssitetestnewsai-held']?.why, 'ai');
  assert.match(after.held?.['httpssitetestnewsai-held']?.note || '', /البطل/);
  assert.ok(!after.held?.['httpssitetestnewsai-clean'], 'a clean verdict with a clean title is not held');
});

test('the writer asks the AI about exactly the text that will be posted, and reads its answer safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-social-judge-'));
  try {
    fs.writeFileSync(path.join(dir, 'run.mts'), `
      globalThis.setTimeout = ((fn) => { fn(); return 0; });
      let prompt = '';
      globalThis.fetch = async (url, init) => { prompt = JSON.parse(init.body).contents[0].parts[0].text;
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"spoils": true, "kind": "none", "note": "بيقول مين فاز"}' }] } }] }); };
      const m = await import(${JSON.stringify(path.resolve('scripts/fightful-watcher.ts'))});
      const opening = m.socialOpening('## عنوان فرعي\\n\\n**فاز** فلان [بالنزال](https://x.y) ![صورة](a.jpg) في عرض كبير');
      const verdict = await m.judgeSocialSpoiler('عنوان الخبر', 'فاز فلان في عرض كبير', 'Source Title', '2026-09-27T10:00:00Z');
      console.log(JSON.stringify({ opening, verdict, hasTitle: prompt.includes('عنوان الخبر'), hasOpening: prompt.includes('فاز فلان في عرض كبير'), hasDate: prompt.includes(new Date().toISOString().slice(0, 10)) && prompt.includes('الحرق مدته ٢٤ ساعة بس') && prompt.includes('2026-09-27T10:00:00Z') && prompt.includes('= امبارح') && prompt.includes('(أكتر من ٢٤ ساعة أكيد)') }));
    `);
    const out = execSync(`${JSON.stringify(path.resolve('node_modules/.bin/tsx'))} run.mts`, { cwd: dir, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEYS: 'k1', GEMINI_API_KEY: 'k1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(out.trim().split('\n').pop()!);
    assert.equal(r.opening, 'عنوان فرعي فاز فلان بالنزال في عرض كبير');
    assert.deepEqual(r.verdict, { spoils: true, kind: 'result', age: 'recent', note: 'بيقول مين فاز' }); // no age given: treated as recent (never as «old»)
    assert.ok(r.hasTitle && r.hasOpening);
    assert.ok(r.hasDate, 'knows the time now and the owner rule: a spoiler lasts 24 hours (a Hardys return from last year was held — INCIDENTS #107)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a results report goes to social as «show + date» only — never with the winner the site title carries', async () => {
  // INCIDENTS #106: «نتائج عرض AEW All Out (26 سبتمبر 2026): فوز ويل أوسبراي في الحدث الرئيسي» reached every platform.
  const { socialResultsTitle } = await import('../worker/src/index');
  const cases: [string, string][] = [
    ['نتائج عرض AEW All Out (26 سبتمبر 2026): فوز ويل أوسبراي في الحدث الرئيسي', 'نتائج عرض AEW All Out (26 سبتمبر 2026)'],
    ['نتائج عرض Sareee-ISM Chapter XII (26 سبتمبر 2026): سبارك روش تتغلب على هازوكي وVENY', 'نتائج عرض Sareee-ISM Chapter XII (26 سبتمبر 2026)'],
    ['نتائج عرض wXw Pro-Wrestling Grand Prix (الليلة الثانية): فوز أهورا في الحدث الرئيسي', 'نتائج عرض wXw Pro-Wrestling Grand Prix (الليلة الثانية)'],
    ['نتائج عرض UFC Fight Night: راؤول روزاس جونيور ضد راوني بارسيلوس (26 سبتمبر 2026)', 'نتائج عرض UFC Fight Night: راؤول روزاس جونيور ضد راوني بارسيلوس (26 سبتمبر 2026)'],
    ['نتائج عرض WWE RAW: فوز رومان رينز في الحدث الرئيسي', 'نتائج عرض WWE RAW'],
    ['نتائج تسريبات عرض WWE SmackDown (30 سبتمبر 2026): فوز كودي', 'نتائج تسريبات عرض WWE SmackDown (30 سبتمبر 2026)'],
  ];
  for (const [site, social] of cases) assert.equal(socialResultsTitle(site), social);
});

test('a key out of the main model\'s daily quota still writes with the fallback models (their quota is separate)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-gemini-quota-'));
  try {
    fs.writeFileSync(path.join(dir, 'run.mts'), `
      globalThis.setTimeout = ((fn) => { fn(); return 0; });
      const calls = [];
      globalThis.fetch = async (url, init) => {
        const model = String(url).match(/models\\/([^:]+):/)[1];
        const key = init.headers['x-goog-api-key'];
        calls.push(key + ':' + model);
        if (model === 'gemini-3.5-flash-lite') return new Response('{"error":{"code":429,"message":"Quota exceeded for quota metric GenerateRequestsPerDay"}}', { status: 429 });
        return Response.json({ candidates: [{ content: { parts: [{ text: 'ok ' + calls.length }] } }] });
      };
      const m = await import(${JSON.stringify(path.resolve('scripts/fightful-watcher.ts'))});
      const first = await m.queryGemini('a');
      const second = await m.queryGemini('b');
      console.log(JSON.stringify({ first, second, calls }));
    `);
    const out = execSync(`${JSON.stringify(path.resolve('node_modules/.bin/tsx'))} run.mts`, { cwd: dir, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEYS: 'k1', GEMINI_API_KEY: 'k1', GEMINI_MODEL: '', GEMINI_FALLBACK_MODELS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(out.trim().split('\n').pop()!);
    assert.ok(r.first && r.second, 'both requests written');
    // Once the key is known to be out of the main model's quota it goes straight to the fallback
    assert.deepEqual(r.calls, ['k1:gemini-3.5-flash-lite', 'k1:gemini-3.6-flash', 'k1:gemini-3.6-flash']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an old result named in the title (last April) goes out when the meaning check states it is over a week old — and only then', async t => {
  // INCIDENTS #107: «داربي ألين كان يعاني من تمزق في طبلة الأذن عندما فاز ببطولة AEW العالمية» was held by the title's words.
  const database = ledger();
  const fresh = new Date(Date.now() - 600_000).toISOString();
  const base = { description: 'كشف داربي ألين عن تفاصيل قاسية سبقت لحظة تتويجه بلقب AEW العالمي في أبريل', kind: 'news', date: fresh, published_at: fresh, single_match_result: true };
  const items = [
    { ...base, url: '/news/old-win/', title: 'داربي ألين كان يعاني من تمزق في طبلة الأذن عندما فاز ببطولة AEW العالمية', social_spoiler: false, social_spoiler_age: 'old' },
    { ...base, url: '/news/unsure/', title: 'داربي ألين يفوز ببطولة AEW العالمية', social_spoiler: false, social_spoiler_age: 'recent' },
    { ...base, url: '/news/no-verdict/', title: 'داربي ألين يفوز ببطولة AEW العالمية' },
  ];
  const file = '/repos/owner/repo-old/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify({ telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {} })).toString('base64') });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.startsWith('https://site.test/')) return new Response('', { status: 404 });
    return database.fetch(input, init);
  });
  for (let i = 0; i < 4; i++) await runWatcherPoll({ ...env, GITHUB_REPO: 'repo-old', SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(!after.held?.['httpssitetestnewsold-win'], 'stated over a week old: not held');
  assert.equal(after.held?.httpssitetestnewsunsure?.why, 'title', 'the words win when the check does not say «old»');
  assert.equal(after.held?.['httpssitetestnewsno-verdict']?.why, 'title', 'no verdict: the words decide');
});

test('a connective written twice in a row is collapsed before publishing', () => {
  // INCIDENTS #107: «أعربت لولا فايس عن رغبتها في أن أن يكون بول هيمان مديرا لأعمالها»
  assert.equal(autoFix('عن رغبتها في أن أن يكون بول هيمان'), 'عن رغبتها في أن يكون بول هيمان');
  assert.equal(autoFix('وصل إلى إلى الحلبة من من الخلف'), 'وصل إلى الحلبة من الخلف');
  assert.equal(autoFix('قال: لا لا يمكن'), 'قال: لا لا يمكن', 'a quoted «no, no» stays');
  assert.equal(autoFix('أنا أنت'), 'أنا أنت', 'only whole repeated words');
});

test('«ة» glued to the next word gets its space back', () => {
  // INCIDENTS #107: «عرابتها الأولى في عالم المصارعةجاز», «المصارعةالحرة»
  assert.equal(autoFix('في عالم المصارعةجاز'), 'في عالم المصارعة جاز');
  assert.equal(autoFix('المصارعةالحرة'), 'المصارعة الحرة');
  assert.equal(autoFix('المصارعة الحرة وجماعة'), 'المصارعة الحرة وجماعة', 'correct text untouched');
});

test('a spoiler lasts 24 hours: a held story goes out on its own after that — unless the owner chose «سيبه»', async t => {
  // Owner's rule, 2026-09-29
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [
    { url: '/news/held-25h/', title: 'فلان يهزم علان في عرض RAW', description: 'تفاصيل', kind: 'news', date: hours(25), published_at: hours(25) },
    { url: '/news/held-10h/', title: 'فلان يهزم علان في عرض NXT', description: 'تفاصيل', kind: 'news', date: hours(10), published_at: hours(10) },
    { url: '/news/kept-off/', title: 'فلان يهزم علان في عرض SmackDown', description: 'تفاصيل', kind: 'news', date: hours(25), published_at: hours(25) },
  ];
  const stamp = (h: number) => Date.now() - h * 3600_000;
  const keys = { a: 'httpssitetestnewsheld-25h', b: 'httpssitetestnewsheld-10h', c: 'httpssitetestnewskept-off' };
  const state: any = { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {}, held: {} };
  for (const [k, h] of [[keys.a, 25], [keys.b, 10], [keys.c, 25]] as [string, number][]) {
    for (const p of ['telegram', 'facebook', 'instagram', 'x']) state[p][k] = stamp(h);
    state.held[k] = { at: stamp(h), title: 'x', url: '/news/x/', reason: 'result', why: 'title' };
  }
  state.held[keys.c].dismissedAt = stamp(20);
  const file = '/repos/owner/repo-24h/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  const opened: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.startsWith('https://site.test/')) { opened.push(decodeURIComponent(new URL(url).pathname)); return new Response('', { status: 404 }); }
    return database.fetch(input, init);
  });
  for (let i = 0; i < 3; i++) await runWatcherPoll({ ...env, GITHUB_REPO: 'repo-24h', SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(after.held[keys.a].releasedAt && after.released[keys.a], 'held 25h ago: released');
  assert.equal(after.held[keys.a].by, 'تلقائي بعد ٢٤ ساعة');
  assert.ok(opened.some(p => p.startsWith('/news/held-25h')), 'and on its way to the platforms');
  assert.ok(!after.held[keys.b].releasedAt, 'held 10h ago: still held');
  assert.ok(!after.held[keys.c].releasedAt, 'the owner kept it off: stays off');
});

test('the writer notes why a source story did not become an article, for the panel', () => {
  // The owner asked for a reason next to every «اتخطى» in «مصادر الأخبار».
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-outcomes-'));
  try {
    fs.writeFileSync(path.join(dir, 'run.mts'), `
      const m = await import(${JSON.stringify(path.resolve('scripts/fightful-watcher.ts'))});
      m.noteOutcome('https://www.fightful.com/wrestling/a/', 'خدمة الكتابة بالذكاء الاصطناعي مردتش، هيتحاول تاني', true);
      m.noteOutcome('https://www.fightful.com/wrestling/b', 'قائمة مصارعين طويلة، مش خبر');
    `);
    execSync(`${JSON.stringify(path.resolve('node_modules/.bin/tsx'))} run.mts`, { cwd: dir, stdio: 'ignore' });
    const notes = JSON.parse(fs.readFileSync(path.join(dir, 'watcher-outcomes.json'), 'utf8'));
    assert.equal(notes['https://www.fightful.com/wrestling/a'].retry, true, 'keyed without the trailing slash');
    assert.equal(notes['https://www.fightful.com/wrestling/b'].reason, 'قائمة مصارعين طويلة، مش خبر');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Every place the writer gives up on a story says why
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  const pp = src.slice(src.indexOf('export async function processPost('));
  const body = pp.slice(0, pp.indexOf('\n}\n'));
  assert.ok((body.match(/noteOutcome\(/g) || []).length >= 11);
});

test('the same story from a second source reaches the same-story check even when it is worded differently', async () => {
  const { findDuplicateCandidates } = await import('../scripts/editorial');
  const now = Date.parse('2026-09-29T00:36:00Z');
  const original = { file: '20260929030502-raw-pac.md', title: "عرض WWE RAW يفتتح فعالياته بتكريم المصارع الراحل باك", body: "افتتح اتحاد WWE عرض WWE RAW مساء 28 سبتمبر 2026 بتكريم خاص للمصارع الراحل بنجامين ساتيرلي، المعروف جماهيريا باسم نيفيل في WWE وباسم باك في AEW. وقبل انطلاق أي نزال أو فقرة، عرض الاتحاد صورة تذكارية باللونين الأبيض والأسود تحمل عبارة WWE تتذكر بنجامين ساتيرلي نيفيل مع تاريخ ميلاده ووفاته 1986-2026، وذلك في لفتة سريعة ومؤثرة فور بدء البث.\n\nجاء هذا التكريم بعد أقل من يوم واحد على وفاة المصارع عن عمر يناهز 40 عاما، حيث عثر عليه فاقدا للوعي داخل سيارة مستأجرة في ديس بلينز بولاية إلينوي، وأعلن عن وفاته مساء الأحد دون الكشف عن السبب الرسمي بانتظار نتائج الفحوصات. وكان باك قد شارك في عرض AEW All Out مساء السبت الماضي، حيث واجه أندرادي على بطولة ناشيونال وظهر في الحدث الرئيسي الذي جمع جون موكسلي وويل أوسبراي.\n\nويحمل هذا التكريم دلالة خاصة نظرا لمسيرة ساتيرلي في WWE التي بدأت عام 2012، حيث صنع لنفسه اسما كبيرا كبطل لـ NXT قبل انتقاله للقائمة الرئيسية وتصدره قسم الوزن الخفيف. ورغم تنقله بين الاتحادات، أكدت خطوة WWE بافتتاح عرضها بهذا التكريم أن إرثه كـ نيفيل لا يزال يحظى بالتقدير، مما أضفى طابعا من الحزن والوقار على انطلاقة العرض في ميلووكي.\n\nhttps://x.com/ringsidenews_/status/2104723369987846328", tags: ["WWE", "WWE RAW", "باك", "نيفيل", "بنجامين ساتيرلي", "المصارعة الحرة"], date: Date.parse('2026-09-29T00:05:02Z') };
  const other = (i: number) => ({ file: `other-${i}.md`, title: `خبر آخر رقم ${i} عن كودي رودس`, body: 'كودي رودس يتحدث عن مباراته القادمة في WWE RAW', tags: ['WWE', 'WWE RAW', 'كودي رودس'], date: now - i * 3600_000 });
  const draft = { title: "WWE ينعي نجم AEW باك عبر وسائل التواصل الاجتماعي وفي افتتاح عرض WWE RAW", body: "افتتح عرض WWE RAW بوضع صورة تذكارية للنجم الراحل باك، واسمه الحقيقي بنجامين ساتيرلي، الذي توفي يوم الأحد عن عمر ناهز أربعين عاما. وكان ساتيرلي قد خاض مسيرة مميزة في اتحاد WWE تحت اسم نيفيل بين عامي 2012 و2018، حيث توج ببطولة NXT وبطولة WWE للوزن الخفيف مرتين.\n\nنشر الاتحاد صورة تذكارية للنجم على منصة X تضمنت رسالة تعزية لعائلته وأصدقائه وجماهيره. من جانبه، قاد رئيس اتحاد AEW توني خان دقيقة صمت تلتها مراسم قرع الجرس عشر مرات تكريما للراحل قبل تسجيل عروض رينغ أوف هونر، وأكد أن عرض AEW Dynamite القادم سيكون مخصصا بالكامل لتأبين ساتيرلي.\n\nتأتي هذه اللفتة بعد أن أعلن اتحاد AEW خبر رحيل النجم عبر منصات التواصل الاجتماعي، إثر مشاركته الأخيرة في عرض AEW All Out 2026 ضمن مواجهة افتتاحية جمعته مع أندرادي إل إيدولو على بطولة النجوم.\n\nhttps://x.com/WWE/status/2104723194880094595", tags: ["WWE", "WWE RAW", "AEW", "باك", "توني خان"] };
  const files = findDuplicateCandidates(draft, [original, ...Array.from({ length: 20 }, (_, i) => other(i + 1))], now).map(c => c.file);
  assert.ok(files.includes(original.file), 'Wrestling Inc\'s PAC tribute story must be checked against Ringside News\'s');
  // A shared promotion or show tag alone is no reason to ask
  assert.ok(!files.some(f => f.startsWith('other-')));
});

test('shared names and wording only raise a suspicion: the AI same-story check decides, so a real development still gets published', async () => {
  const { withSuspect } = await import('../scripts/fightful-watcher');
  const n = (file: string) => ({ file, title: file, body: '', tags: [], date: 0 });
  const news = [n('ten-bells.md'), n('a.md'), n('b.md'), n('c.md'), n('d.md'), n('e.md')];
  // «Dynamite will be a PAC tribute show» was dropped as a copy of the ROH ten-bell story
  // without anyone asking whether it was the same news (INCIDENTS #113)
  assert.deepEqual(withSuspect([n('a.md'), n('b.md'), n('c.md'), n('d.md'), n('e.md')], news, 'ten-bells.md').map(c => c.file),
    ['ten-bells.md', 'a.md', 'b.md', 'c.md', 'd.md']);
  assert.deepEqual(withSuspect([n('a.md'), n('ten-bells.md')], news, 'ten-bells.md').map(c => c.file), ['ten-bells.md', 'a.md']);
  assert.deepEqual(withSuspect([n('a.md')], news, '').map(c => c.file), ['a.md']);

  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  const guard = src.slice(src.indexOf('const postDupe = findLikelyDuplicateStoryByTagsAndBody('), src.indexOf('// Editorial pass'));
  assert.match(guard, /if \(postDupe\.isDuplicate\) suspectedDuplicate = /, 'no skip on shared names or a shared tweet alone');
  assert.ok(!/return false/.test(guard), 'the post-translation guard never skips on its own');
  // The title-words guard asks the same-story check too (INCIDENTS #115: «no foul play in PAC's death»)
  const titleGuard = src.slice(src.indexOf('const dupe = findLikelyDuplicateStory(rawTitle);'), src.indexOf('// 1. Download & compress image'));
  assert.match(titleGuard, /duplicatePrompt\(\{ title: rawTitle/);
  assert.match(titleGuard, /if \(verdict \|\| !match\.length\)/);
  // The same embedded post is still proof on its own
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-dedupe-link-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), `---\ndate: ${new Date().toISOString()}\nsource_url: "https://x.test/a"\ntags:\n  - باك\n  - توني خان\nimage: /x.jpg\n---\nنص\n\nhttps://x.com/TonyKhan/status/2104679231078694942`);
    const hit = findLikelyDuplicateStoryByTagsAndBody(['باك', 'توني خان'], 'نص مختلف\n\nhttps://x.com/TonyKhan/status/2104679231078694942', 6, dir);
    assert.equal(hit.isDuplicate, true);
    assert.equal(hit.byLink, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a story about tonight\'s show says «الليلة», not today\'s date (US time); other dates stay', async () => {
  const { tonightInTitle } = await import('../scripts/news-qa');
  const duringRaw = Date.parse('2026-09-29T00:26:00Z'); // 20:26 on 28 September in New York
  assert.equal(tonightInTitle('الكشف عن خطط جايدا باركر في عرض WWE RAW يوم 28 سبتمبر', duringRaw), 'الكشف عن خطط جايدا باركر في عرض WWE RAW الليلة');
  assert.equal(tonightInTitle('ترتيب فقرات عرض WWE RAW (28 سبتمبر 2026)', duringRaw), 'ترتيب فقرات عرض WWE RAW الليلة');
  assert.equal(tonightInTitle('ماذا حدث في عرض WWE RAW يوم 21 سبتمبر', duringRaw), 'ماذا حدث في عرض WWE RAW يوم 21 سبتمبر');
  assert.equal(tonightInTitle('عرض AEW Dynamite يوم 30 سبتمبر سيكون تأبينا لباك', duringRaw), 'عرض AEW Dynamite يوم 30 سبتمبر سيكون تأبينا لباك');
  // The writer never touches a results report's «show + date» title
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /if \(!isShowResultsArticle\(rawTitle, plainText\)\) rewritten\.title = tonightInTitle\(rewritten\.title\)/);
});

test('whatever happened ON a show that aired in the last 24h is a spoiler — a match made during RAW too', async () => {
  const { happenedOnRecentShow, settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const shows = ['wwe raw'];
  // INCIDENTS #114: both reached Telegram and Facebook while RAW was on the air
  assert.equal(happenedOnRecentShow('Big Match Added To Money In The Bank During 9/28 WWE RAW', 'إضافة نزال كبير إلى عرض موني إن ذا بانك', shows), true);
  assert.equal(happenedOnRecentShow('Oba Femi Vs. Bronson Reed Set For WWE Money In The Bank', 'أوبا فيمي يواجه برونسون ريد في عرض WWE موني إن ذا بانك جاء هذا الإعلان رسميا بعد أن وقع الثنائي عقد النزال خلال عرض WWE RAW هذا الأسبوع', shows), true);
  // Previews of the show are not something that happened
  assert.equal(happenedOnRecentShow('Spoiler: Two NXT Talents Scheduled For September 28 WWE RAW', 'يستعد عرض WWE RAW الليلة لاستقبال وجهين جديدين', shows), false);
  assert.equal(happenedOnRecentShow('Tony Khan Announces PAC Tribute Show For September 30 AEW Dynamite', 'توني خان يعلن أن عرض داينامايت القادم سيكون تأبينا لباك', shows), false);
  assert.equal(happenedOnRecentShow('Big Match Added During 9/28 WWE RAW', '', []), false, 'no show aired in the last 24h');
  // An earlier episode named after «خلال عرض RAW» is history, not tonight (INCIDENTS #119)
  assert.equal(happenedOnRecentShow('WWE Preparing For Naomi Return After Pregnancy Hiatus', 'WWE تستعد لعودة نايومي بعد فترة غياب بسبب الحمل وكانت نايومي قد تخلت عن بطولة العالم للسيدات خلال عرض WWE RAW في شهر أغسطس من عام 2025 بعد إعلان حملها', shows), false);
  assert.equal(happenedOnRecentShow('', 'فاز باللقب خلال عرض WWE RAW الأسبوع الماضي', shows), false);
  const nowD = new Date();
  const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  assert.equal(happenedOnRecentShow('', `وقع الثنائي العقد خلال عرض WWE RAW الذي أقيم يوم ${nowD.getUTCDate()} ${AR[nowD.getUTCMonth()]} ${nowD.getUTCFullYear()}`, shows), true, 'tonight\'s date is tonight');
  // Next week's card was made on the show that just aired (INCIDENTS #117) — but tonight's card is a preview
  const afterRaw = Date.now();
  const inAWeek = new Date(afterRaw + 6 * 86400_000);
  const md = `${inAWeek.getUTCMonth() + 1}/${inAWeek.getUTCDate()}`;
  assert.equal(happenedOnRecentShow(`AAA World Cruiserweight Title Bout, Becky Lynch vs. Liv Morgan, More Set For ${md} WWE Raw`, 'نزال على بطولة AAA الكروزرويت العالمية', shows), true);
  assert.equal(happenedOnRecentShow('', 'تأكيد عودة رومان رينز وإقامة نزالات عدة في عرض WWE RAW القادم', shows), true);
  const today = new Date(afterRaw);
  assert.equal(happenedOnRecentShow(`Matches Set For ${today.getUTCMonth() + 1}/${today.getUTCDate()} WWE Raw`, 'نزالات عرض الليلة', shows), false);
  // The same-story check is told that a small extra detail or the same card from another source is a duplicate
  const { duplicatePrompt } = await import('../scripts/editorial');
  const dp = duplicatePrompt({ title: 'x', body: 'y', tags: [] }, []);
  assert.match(dp, /تفصيلة صغيرة زيادة على نفس الإعلان/);
  assert.match(dp, /جدول أو بطاقة نزالات نفس العرض الجاي من مصدرين = تكرار/);

  // «28 سبتمبر» at 01:00 UTC on the 29th is not «over 24 hours ago» (the model said it was)
  const now = Date.parse('2026-09-29T01:00:00Z');
  const old = { spoils: false, kind: 'none' as const, age: 'old' as const, note: '' };
  assert.equal(settleSpoilerAge(old, 'شهد عرض WWE RAW الذي أقيم يوم 28 سبتمبر 2026 إعلانا', [], now).age, 'recent');
  assert.equal(settleSpoilerAge(old, 'Big Match Added During 9/28 WWE RAW', [], now).age, 'recent');
  assert.equal(settleSpoilerAge(old, 'شهد عرض WWE RAW إعلانا', shows, now).age, 'recent');
  assert.equal(settleSpoilerAge(old, 'فاز باللقب يوم 12 أبريل الماضي', shows, now).age, 'old');
  // The panel names the new reason
  assert.match(fs.readFileSync('studio/js/views/held.js', 'utf8'), /show: 'حاجة حصلت في عرض لسه متذاع'/);
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /item\.social_spoiler_kind === "show" \? "show"/);
});

test('two bots writing the same story at the same moment: the second to push drops its copy before it goes live', async () => {
  const { crossRunDuplicates } = await import('../scripts/cross-run-dedupe');
  const now = Date.parse('2026-09-29T01:00:00Z');
  const mk = (file: string, title: string, body: string, tags: string[]) => ({ file, title, body, tags, date: now - 60_000 });
  const rsn = mk('rsn.md', 'إضافة نزال كبير إلى عرض موني إن ذا بانك خلال عرض WWE RAW', 'شهد عرض رو إعلانا رسميا عن مواجهة بين أوبا فيمي وبرونسون ريد.\n\nhttps://x.com/WWE/status/2104734692498932211', ['WWE', 'أوبا فيمي', 'برونسون ريد']);
  const fightful = mk('fightful.md', 'أوبا فيمي يواجه برونسون ريد في عرض WWE موني إن ذا بانك', 'تأكدت إقامة نزال ضخم بين أوبا فيمي وبرونسون ريد.\n\nhttps://x.com/WWE/status/2104734692498932211', ['WWE', 'أوبا فيمي', 'برونسون ريد']);
  // Same embedded post: the same-story check decides; with no answer the tweet does
  assert.deepEqual((await crossRunDuplicates([fightful], [rsn], async () => '{"duplicate_of": 0, "reason": "نفس الإعلان"}', now)).map(h => [h.file, h.matchedFile]), [['fightful.md', 'rsn.md']]);
  assert.deepEqual((await crossRunDuplicates([fightful], [rsn], async () => null, now)).map(h => h.matchedFile), ['rsn.md']);
  // One tweet, two stories (Tony Khan: ten bells at ROH + a Dynamite tribute show) — kept (INCIDENTS #115)
  assert.deepEqual(await crossRunDuplicates([fightful], [rsn], async () => '{"duplicate_of": null, "reason": "خبر تاني"}', now), []);
  // Different tweets: the AI same-story check decides
  const noLink = { ...fightful, body: 'تأكدت إقامة نزال ضخم ضمن فعاليات عرض موني إن ذا بانك بين أوبا فيمي وبرونسون ريد بعد توقيع العقد.' };
  const judged = await crossRunDuplicates([noLink], [rsn], async () => '{"duplicate_of": 0, "reason": "نفس الإعلان"}', now);
  assert.deepEqual(judged.map(h => h.matchedFile), ['rsn.md']);
  // A different story is kept
  const other = mk('other.md', 'توني خان يعلن تأبين باك في داينامايت', 'أعلن توني خان أن عرض داينامايت سيكون تأبينا لباك.', ['AEW', 'توني خان', 'باك']);
  assert.deepEqual(await crossRunDuplicates([other], [rsn], async () => '{"duplicate_of": null}', now), []);
  // Every writer bot runs it after pulling, with the AI keys
  for (const wf of ['fightful-watcher', 'ringsidenews-watcher', 'wrestlinginc-watcher']) {
    const y = fs.readFileSync(`.github/workflows/${wf}.yml`, 'utf8');
    const push = y.slice(y.indexOf('Commit and push if new articles were generated'));
    assert.match(push, /GEMINI_API_KEYS/, wf);
    assert.match(push, /BASE=\$\(git rev-parse HEAD\^\)/, wf);
    assert.ok(push.indexOf('cross-run-dedupe.ts "$BASE"') > push.indexOf('git pull --rebase'), wf);
  }
});

test('a results report names the match type from the sides in the source line — one against two is a handicap match, not «نزال فردي»', () => {
  // NWA Powerrr 9/26: «Nattie def. Kenzie Paige and Kylie Paige» was written as «نزال فردي» (INCIDENTS #118)
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  const prompt = src.slice(src.indexOf('async function rewriteWithGemini('));
  assert.match(prompt, /«X def\. Y and Z» \(واحد ضد اتنين\) = نزال غير متكافئ/);
  assert.match(prompt, /«A & B def\. C & D» = نزال فرق/);
  assert.match(prompt, /مش افتراضيا «نزال فردي»/);
  const corrections = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf8')).corrections;
  assert.ok(corrections.some((c: any) => c.wrong === 'أحدث عرض من عرض'));
});

test('«بتوقيت أمريكا» stays in the story but not in a headline', async () => {
  const { dropTimezoneFromTitle } = await import('../scripts/news-qa');
  // INCIDENTS #122
  assert.equal(dropTimezoneFromTitle('WWE RAW 28 سبتمبر 2026 (بتوقيت أمريكا): ثلاثة أمور كرهناها وثلاثة أحببناها'), 'WWE RAW 28 سبتمبر 2026: ثلاثة أمور كرهناها وثلاثة أحببناها');
  assert.equal(dropTimezoneFromTitle('نتائج عرض AEW Dynamite يوم 30 سبتمبر بتوقيت أمريكا'), 'نتائج عرض AEW Dynamite يوم 30 سبتمبر');
  assert.equal(dropTimezoneFromTitle('توني خان يعلن تأبين باك'), 'توني خان يعلن تأبين باك');
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /rewritten\.title = dropTimezoneFromTitle\(rewritten\.title\)/);
});

test('show reel: the Arabic name is never cut — one line, scaled to fit; the English name is readable; the layout clears the platforms\' top buttons', () => {
  // «عرض بروجريس شابتر 198 وين سبتمبر اندز 27.09.2026 مترجم» was cut to «…مترج» (INCIDENTS #124)
  const src = fs.readFileSync('scripts/generate-news-video.ts', 'utf8');
  assert.match(src, /function fitOneLine\(boxId, innerId, avail, maxSize, minSize/);
  assert.match(src, /Math\.floor\(size \* avail \/ w\)/, 'the size comes from the measured width');
  assert.match(src, /fitOneLine\('headlineText', 'headlineTextInner', 928, " \+ titleFontSize \+ ", 26/);
  assert.match(src, /fitOneLine\('secondaryTitle', 'secondaryTitleInner', 938, 38, 24\)/);
  assert.match(src, /\$\{isShow \? '' : 'overflow: hidden;\\n        text-overflow: ellipsis;'\}/, 'no ellipsis on show reels');
  const layout = src.match(/\? \{ header: (\d+), media: (\d+), mediaH: (\d+), ribbon: (\d+), specs: (\d+), specH: (\d+), cta: (\d+), ctaH: (\d+) \}/)!.slice(1).map(Number);
  const [header, , , , , , cta, ctaH] = layout;
  assert.ok(header >= 140, 'below the platforms\' top buttons');
  assert.ok(cta + ctaH <= 1700, 'above the caption area');
  assert.match(src, /if \(process\.env\.REEL_HTML_ONLY\) return;/);
});

test('show reel «الحلبة»: the whole poster, names on one line sized to fit, a seekable 8-second timeline', async () => {
  const { showReelHtml, posterName, shortDuration } = await import('../scripts/show-reel-template');
  // The date has its own box; «عرض … مترجم» is said by the poster itself
  assert.equal(posterName('عرض بروجريس شابتر 198 وين سبتمبر اندز 27.09.2026 مترجم'), 'بروجريس شابتر 198 وين سبتمبر اندز');
  assert.equal(posterName('عرض سماك داون 25.09.2026 مترجم'), 'سماك داون');
  assert.equal(shortDuration('03:20:49'), '3:20:49');
  const html = showReelHtml({ arTitle: 'سماك داون', enTitle: 'WWE Smackdown 25.09.2026', federation: 'WWE', dateLabel: '25 سبتمبر', duration: '1:27:45', poster: 'assets/news-cover.jpg', logo: 'assets/logo.png' });
  // one line each, measured at the final letter-spacing (the English starts spaced out)
  assert.match(html, /fit\('ar', 'arIn', 112, 970, 34\); fit\('en', 'enIn', 54, 970, 24, '2px'\)/);
  assert.match(html, /\.ar \{ white-space: nowrap;/);
  assert.match(html, /\.en \{ white-space: nowrap;/);
  // the whole poster: no «cover» crop, the zone takes the image's proportions
  assert.match(html, /background: url\('assets\/news-cover\.jpg'\) center \/ 100% 100% no-repeat/);
  assert.match(html, /var ratio = img\.naturalWidth \/ img\.naturalHeight/);
  // the renderer seeks one paused timeline; the embers are seeded so every render matches
  assert.match(html, /data-duration="8"/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /window\.__timelines\['main'\] = tl;/);
  assert.match(html, /var seed = 7;/);
  assert.ok(!/Math\.random/.test(html));
  // shows use it; news keep their card
  const gen = fs.readFileSync('scripts/generate-news-video.ts', 'utf8');
  assert.match(gen, /const htmlTemplate = isShow \? showReelHtml\(\{/);
});

test('a published story whose title (and so URL) was edited is never posted again; Arabic results titles go out as show + date', async t => {
  // INCIDENTS #127: fixing «بآربارو» in the CMLL 28 Sep report changed its URL, and the new URL was
  // posted to Telegram, Facebook and Instagram a second time — with the winners in the title, because
  // «\b» next to Arabic never matched and the report wasn't recognised as a results report.
  const { contentFileId, isResultsArticle } = await import('../worker/src/index');
  assert.equal(contentFileId({ inputPath: './content/news/20260929081500-نتائج-عرض-cmll.md' }), '20260929081500-نتائج-عرض-cmll');
  assert.equal(isResultsArticle('نتائج عرض CMLL Lunes Clásico (28 سبتمبر 2026): فوز زاندوكان جونيور'), true);
  assert.equal(isResultsArticle('نتائج تسريبات عرض NXT'), true);
  assert.equal(isResultsArticle('توني خان يعلن تأبين باك'), false);

  const database = ledger();
  const now = new Date(Date.now() - 20 * 60_000).toISOString();
  const inputPath = './content/news/20260929081500-cmll.md';
  const items = [
    { url: '/news/edited-title/', inputPath, title: 'نتائج عرض CMLL (28 سبتمبر 2026): فوز باربارو', description: 'x', kind: 'news', date: now, published_at: now },
    { url: '/news/other-story/', inputPath: './content/news/20260929090000-other.md', title: 'خبر عام', description: 'تفاصيل', kind: 'news', date: now, published_at: now },
  ];
  const old = 'httpssitetestnewsold-title';
  const state: any = { telegram: { [old]: Date.now() }, facebook: { [old]: Date.now() }, instagram: { [old]: Date.now() }, x: { [old]: Date.now() }, cooldowns: {},
    byFile: { '20260929081500-cmll': old } };
  const file = '/repos/owner/repo/contents/_data/publish-state.json';
  database.records.set(file, { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') });
  const telegramTitles: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://site.test/watcher-recent-content.json')) return Response.json(items);
    if (url.includes('api.telegram.org')) telegramTitles.push(String(init?.body || ''));
    return database.fetch(input, init);
  });
  await runWatcherPoll({ ...env, SITE_ORIGIN: 'https://site.test', GITHUB_STATE_PATH: '_data/publish-state.json' } as any);
  const after = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(!after.telegram['httpssitetestnewsedited-title'], 'the edited-title URL is not posted again');
  assert.ok(!telegramTitles.some(b => b.includes('باربارو')), 'nothing about it went to Telegram');
  // the source code keeps the file with every send
  const src = fs.readFileSync('worker/src/index.ts', 'utf8');
  assert.match(src, /await markSendSuccess\(env, platform, key, item\.file \|\| ""\)/);
  assert.match(src, /if \(firstKey && firstKey !== key\) continue;/);
});

test('a news story whose title was edited keeps its first URL alive: the build redirects it to the new one', async () => {
  // INCIDENTS #127
  const { renamedArticleRedirects, toPagesRedirects } = await import('../lib/redirects.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-renamed-'));
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-site-'));
  try {
    fs.writeFileSync(path.join(dir, '20260929081500-فوز-وبآربارو.md'), '---\ntitle: "فوز وباربارو"\n---\nx');
    fs.writeFileSync(path.join(dir, '20260929090000-خبر-عادي.md'), '---\ntitle: "خبر عادي"\n---\nx');
    fs.writeFileSync(path.join(dir, '20260929091000-مثبت.md'), '---\ntitle: "عنوان جديد"\npermalink: "/news/مثبت/index.html"\n---\nx');
    const extra = renamedArticleRedirects(dir, site);
    assert.deepEqual(extra, [['/news/فوز-وبآربارو/', '/news/فوز-وباربارو/']]);
    const out = toPagesRedirects('/news/manual/* /news/kept/:splat 301!\n', site, extra);
    assert.match(out, /\/news\/فوز-وبآربارو\/ \/news\/فوز-وباربارو\/ 301/);
    // a written rule always wins, and the limit is never passed
    const manual = toPagesRedirects('/news/فوز-وبآربارو/* /news/elsewhere/:splat 301!\n', site, extra);
    assert.ok(!/فوز-وباربارو/.test(manual));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(site, { recursive: true, force: true });
  }
  assert.match(fs.readFileSync('eleventy.config.js', 'utf8'), /toPagesRedirects\(fs\.readFileSync\("_redirects", "utf-8"\), "_site", renamedArticleRedirects\(\)\)/);
});

test('no «\\b» next to an Arabic letter in scripts/ or worker/src/ — JS «\\b» only knows ASCII, so the rule is silently dead', async () => {
  // INCIDENTS #129 (and #68, #127): «/\bنتاليا\b/», «/\bالعرض\s+القادم\b/»… never matched Arabic text.
  // Use «(?<![؀-ۿ])…(?![؀-ۿ])» (or arWord / arBoundL in sanitizeWrestlingTerms).
  const AR = '[\\u0600-\\u06FF]';
  const B = '\\\\{1,2}b'; // «\b» in a regex literal, «\\b» in a RegExp string
  const bad = new RegExp(`${B}(?:\\(\\?:|\\()*${AR}|${AR}\\)*${B}`);
  const offenders: string[] = [];
  for (const dir of ['scripts', 'worker/src']) {
    for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      fs.readFileSync(path.join(dir, name), 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/(^|\s)\/\/.*$/, '$1'); // comments may explain the bug
        if (bad.test(code)) offenders.push(`${dir}/${name}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
  assert.deepEqual(offenders, []);

  // the rules that were worth keeping now actually run
  const { translateTitleDeterministic } = await import('../scripts/fightful-watcher');
  assert.equal(sanitizeWrestlingTerms('موعد حلقة RAW الليلة'), 'موعد عرض RAW الليلة');
  assert.equal(sanitizeWrestlingTerms('حلقة عرض NXT'), 'عرض NXT');
  assert.equal(translateTitleDeterministic('Seth Rollins Returns To To RAW'), 'سيث رولينز يعود إلى RAW');
  assert.match(translateTitleDeterministic('Who From WWE Will Win') || '', /من من WWE/); // "who from", not a duplicate
  assert.equal(applyCorrections('مواجهة نتاليا وناتي'), 'مواجهة ناتاليا وناتاليا');
});
