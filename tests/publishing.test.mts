import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliverOnce, authorizeAdmin } from '../worker/src/delivery';
import { finishPublication, publishFacebookVideo, publishInstagramVideo, mustRetainVideo, publishTikTokVideo } from '../worker/src/video-publishing';
import worker, { runWatcherPoll } from '../worker/src/index';
import { showUrl, findReelVideo, applyResults, isShowEligible, shouldProcessShow, hasRealFailure, retryDelayMs, takePlatformBudget } from '../scripts/show-reel-monitor';
import { toPagesRedirects } from '../lib/redirects.cjs';
import { applyProofEdits } from '../scripts/editorial';
import { checkArticle } from '../scripts/news-qa';
import { sanitizeWrestlingTerms, findLikelyDuplicateStory, findLikelyDuplicateStoryByTagsAndBody, buildNamesGlossaryHint, isEmptyResultsStub } from '../scripts/fightful-watcher';

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

test('a pre-show match card is not a results report', () => {
  // INCIDENTS #53: Ringside's live SmackDown page listed «X vs. Y» before the show
  // and was published as results with «الفائز: قيد الانتظار».
  assert.ok(isEmptyResultsStub('Ringside News will provide live, match-by-match updates. Stay tuned. Trick Williams (c) vs. Baron Corbin. CM Punk vs. Finn Balor. Charlotte Flair vs. Giulia.'));
  assert.ok(!isEmptyResultsStub('Trick Williams def. Baron Corbin to retain. CM Punk defeated Finn Balor. Giulia beats Charlotte Flair.'));
  const pending = checkArticle('نتائج عرض WWE SmackDown', '🏆 **الفائز:** قيد الانتظار', []);
  assert.ok(pending.some(i => i.code === 'vague_result'));
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
