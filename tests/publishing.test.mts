import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliverOnce, authorizeAdmin } from '../worker/src/delivery';
import { finishPublication, publishFacebookVideo, publishInstagramVideo, mustRetainVideo, publishTikTokVideo } from '../worker/src/video-publishing';
import worker, { runWatcherPoll, newestFeedItem } from '../worker/src/index';
import { showUrl, findReelVideo, applyResults, isShowEligible, shouldProcessShow, hasRealFailure, retryDelayMs, takePlatformBudget } from '../scripts/show-reel-monitor';
import { toPagesRedirects, writeRedirectPages } from '../lib/redirects.cjs';
import { applyProofEdits } from '../scripts/editorial';
import { checkArticle, autoFix, headUnheadedMatches, applyCorrections } from '../scripts/news-qa';
import { extractBodyImages, extractEmbeds, sanitizeWrestlingTerms, findLikelyDuplicateStory, findLikelyDuplicateStoryByTagsAndBody, buildNamesGlossaryHint, isEmptyResultsStub, clearlyDifferentStories, analyzeShowTiming } from '../scripts/fightful-watcher';

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

/** The article/show page: the template and the styles and scripts it loads from /assets (INCIDENTS #311). */
function layoutSource(): string {
  return ['_includes/post-layout.njk', 'assets/post-layout.css', 'assets/post-seasons.js', 'assets/post-player.js', 'assets/post-theme.js']
    .map(f => fs.readFileSync(f, 'utf-8')).join('\n');
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

test('TikTok stays SELF_ONLY on an unaudited app even when the account offers public', async t => {
  // creator_info offered PUBLIC_TO_EVERYONE to our Sandbox app; asking for it got every
  // init rejected with "review our integration guidelines" (INCIDENTS #191).
  const sent: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: any) => {
    if (url.endsWith('/creator_info/query/')) return new Response(JSON.stringify({ error: { code: 'ok' }, data: { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] } }));
    if (url.endsWith('/video/init/')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ error: { code: 'ok' }, data: { publish_id: 'p' + sent.length } })); }
    return new Response(JSON.stringify({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE' } }));
  });
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} } as any;
  await publishTikTokVideo({ accessToken: 'token', videoUrl: 'https://site.test/videos/a.mp4', kv });
  await publishTikTokVideo({ accessToken: 'token', videoUrl: 'https://site.test/videos/b.mp4', kv, audited: true });
  assert.deepEqual(sent.map(b => b.post_info.privacy_level), ['SELF_ONLY', 'PUBLIC_TO_EVERYONE']);
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
  const e = encodeURIComponent; // Pages matches encoded paths (INCIDENTS #200)
  assert.ok(out.includes(`/news/${e('قديم')}/ /news/${e('جديد')}/ 301`));
  assert.ok(out.includes(`/news/${e('قديم')} /news/${e('جديد')}/ 301`));
  assert.ok(out.includes(`/tag/${e('قديم')}/* /tag/${e('جديد')}/:splat 301`), 'paginated target keeps its splat');
  const firstSplat = out.findIndex(l => l.includes('*'));
  assert.ok(out.slice(firstSplat).every(l => l.includes('*')), 'static rules must precede every splat rule');
});

test('the 100 dynamic redirects keep room for wildcard rules that can only be dynamic (INCIDENTS #314)', () => {
  // 1 Oct–7 Oct: new articles gave one more tag pagination, the splats filled all 100 slots, the
  // «/studio/*»-style rules came on top: 101/100 and every Cloudflare build failed for 40 minutes.
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const lines: string[] = [];
  for (let i = 0; i < 105; i++) { fs.mkdirSync(path.join(site, 'tag', `t${i}`, '2'), { recursive: true }); lines.push(`/tag/o${i}/* /tag/t${i}/:splat 301!`); }
  lines.push('/studio/* /admin/ 301', '/raw/* /library/wwe-raw/ 301', '/smackdown/* /library/wwe-smackdown/ 301');
  const out = toPagesRedirects(lines.join('\n'), site).trim().split('\n');
  const dynamic = out.filter(l => /[*:]/.test(l.split(' ')[0]));
  assert.equal(dynamic.length, 100);
  for (const l of ['/studio/* /admin/ 301', '/raw/* /library/wwe-raw/ 301', '/smackdown/* /library/wwe-smackdown/ 301']) assert.ok(out.includes(l), l);
  // a splat that didn't fit still redirects, as static rules
  assert.ok(out.includes('/tag/o104/ /tag/t104/ 301') && out.includes('/tag/o104 /tag/t104/ 301'));
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
      console.log(JSON.stringify({ opening, verdict, hasTitle: prompt.includes('عنوان الخبر'), hasOpening: prompt.includes('فاز فلان في عرض كبير'), hasDate: prompt.includes(new Date().toISOString().slice(0, 10)) && prompt.includes('الحرق مدته ٦ ساعات بس') && prompt.includes('2026-09-27T10:00:00Z') && prompt.includes('= امبارح') && prompt.includes('(أكتر من ٦ ساعات أكيد)') }));
    `);
    const out = execSync(`${JSON.stringify(path.resolve('node_modules/.bin/tsx'))} run.mts`, { cwd: dir, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEYS: 'k1', GEMINI_API_KEY: 'k1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(out.trim().split('\n').pop()!);
    assert.equal(r.opening, 'عنوان فرعي فاز فلان بالنزال في عرض كبير');
    assert.deepEqual(r.verdict, { spoils: true, kind: 'result', age: 'recent', note: 'بيقول مين فاز', priority: 'normal' }); // no age given: treated as recent (never as «old»); no priority: normal
    assert.ok(r.hasTitle && r.hasOpening);
    assert.ok(r.hasDate, 'knows the time now and the owner rule: a spoiler lasts 6 hours (INCIDENTS #107, #215)');
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

test('a held story goes out on its own 12 hours after the hold — unless the owner chose «سيبه»', async t => {
  // Owner's rule, 2026-09-29; 12 hours since 2026-09-30 (INCIDENTS #157); 6 hours since 2026-10-02 (#215)
  const database = ledger();
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const items = [
    { url: '/news/held-25h/', title: 'فلان يهزم علان في عرض RAW', description: 'تفاصيل', kind: 'news', date: hours(13), published_at: hours(13) },
    { url: '/news/held-10h/', title: 'فلان يهزم علان في عرض NXT', description: 'تفاصيل', kind: 'news', date: hours(10), published_at: hours(10) },
    { url: '/news/kept-off/', title: 'فلان يهزم علان في عرض SmackDown', description: 'تفاصيل', kind: 'news', date: hours(25), published_at: hours(25) },
  ];
  const stamp = (h: number) => Date.now() - h * 3600_000;
  const keys = { a: 'httpssitetestnewsheld-25h', b: 'httpssitetestnewsheld-10h', c: 'httpssitetestnewskept-off' };
  const state: any = { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {}, held: {} };
  for (const [k, h] of [[keys.a, 13], [keys.b, 10], [keys.c, 25]] as [string, number][]) {
    for (const p of ['telegram', 'facebook', 'instagram', 'x']) state[p][k] = stamp(h);
    state.held[k] = { at: stamp(h), title: 'فلان يهزم علان في عرض RAW', url: '/news/x/', reason: 'result', why: 'title' };
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
  assert.ok(after.held[keys.a].releasedAt && after.released[keys.a], 'held 13h ago: released');
  assert.equal(after.held[keys.a].by, 'تلقائي بعد ١٢ ساعة');
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
  // «at the same event» must name the show, not point back to the wrong one (INCIDENTS #281)
  const styleGuide = (await import('node:fs')).readFileSync(path.join(process.cwd(), 'editorial/style-guide.md'), 'utf8');
  assert.match(styleGuide, /at the same event \/ on the same show ← اكتب اسم العرض صراحة/);
  // Every article and title, from every source, is written in very simple white fusha (owner request 2026-10-08)
  assert.match(styleGuide, /## 0\. أسلوب الكتابة — فصحى بيضاء مبسطة جدا/);
  assert.match(styleGuide, /في خضم \/ في غمار ← وسط \/ خلال/);
  assert.match(styleGuide, /\*\*العنوان بنفس الأسلوب تماما\*\*/);
  const { editorialGuideForPrompt, proofreadPrompt } = await import('../scripts/editorial');
  assert.match(editorialGuideForPrompt(), /فصحى بيضاء مبسطة جدا/);
  assert.match(proofreadPrompt({ title: 'x', body: 'y', tags: [] }, 'x', 'y', '', []), /كلمة ثقيلة أو قديمة أو أدبية لها بديل يومي أسهل/);
  assert.doesNotMatch(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /بليغة|بلاغة الأسلوب|رشيقة/);

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
  // The whole Arabic title, as on the site: «الرو» alone looked unfinished (INCIDENTS #133)
  assert.equal(posterName('عرض الرو 28.09.2026 مترجم'), 'عرض الرو 28.09.2026 مترجم');
  assert.equal(posterName('  عرض بروجريس شابتر 198  وين سبتمبر اندز 27.09.2026 مترجم '), 'عرض بروجريس شابتر 198 وين سبتمبر اندز 27.09.2026 مترجم');
  assert.equal(shortDuration('03:20:49'), '3:20:49');
  const html = showReelHtml({ arTitle: 'سماك داون', enTitle: 'WWE Smackdown 25.09.2026', federation: 'WWE', dateLabel: '25 سبتمبر', duration: '1:27:45', poster: 'assets/news-cover.jpg', logo: 'assets/logo.png' });
  // one line each, measured at the final letter-spacing (the English starts spaced out)
  assert.match(html, /fit\('ar', 'arIn', 112, 970, 34\);/);
  assert.match(html, /fit\('en', 'enIn', Math\.min\(54, Math\.round\(arSize \* 0\.7\)\), 970, 22, '2px'\)/);
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
  // INCIDENTS #137: TV tapings
  assert.equal(isResultsArticle('نتائج تسجيلات عرض ROH TV (28 سبتمبر 2026)'), true);
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
    assert.ok(out.includes(`/news/${encodeURIComponent('فوز-وبآربارو')}/ /news/${encodeURIComponent('فوز-وباربارو')}/ 301`));
    // a written rule always wins, and the limit is never passed
    const manual = toPagesRedirects('/news/فوز-وبآربارو/* /news/elsewhere/:splat 301!\n', site, extra);
    assert.ok(!manual.includes(encodeURIComponent('فوز-وباربارو')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(site, { recursive: true, force: true });
  }
  assert.match(fs.readFileSync('eleventy.config.js', 'utf8'), /toPagesRedirects\(fs\.readFileSync\("_redirects", "utf-8"\), "_site", renamedArticleRedirects\(\), tooLong\)/);
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

test('the worker entry file exports functions only — Cloudflare refuses to start on any other named export', async () => {
  // INCIDENTS #132: «export const NOTIFY_WINDOW_MS = …» stopped the worker from starting at all
  // («Incorrect type for map entry … not of type function or ExportedHandler»), caught locally.
  const mod: any = await import('../worker/src/index');
  const bad = Object.entries(mod).filter(([k, v]) => k !== 'default' && typeof v !== 'function').map(([k]) => k);
  assert.deepEqual(bad, []);
});

test('a debut that was only planned is not a spoiler; a real debut still is', async () => {
  // INCIDENTS #135: «جو هندري يقول إنه كان من المفترض أن يسجل ظهوره الأول…» was held off social
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('جو هندري يقول إنه كان من المفترض أن يسجل ظهوره الأول في القائمة الرئيسية في عرض WWE RAW بعد عرض WrestleMania'), false);
  assert.equal(isSingleMatchSpoiler('الكشف عن خطط ظهوره الأول في عرض RAW'), false);
  assert.equal(isSingleMatchSpoiler('نجمة WWE السابقة تسجل ظهورها الأول في عرض ROH خلال تصوير العروض'), true);
  assert.equal(isSingleMatchSpoiler('روميو مالفيردي يعود إلى الحلبات في أول نزال له'), true);
});

test('the promotion follows the site\'s recent stories on the same wrestler when the source never names the one the model chose', async () => {
  // INCIDENTS #136: Joe Hendry (WWE RAW on this site) came out TNA with TNA tags
  const { federationFromHistory } = await import('../scripts/fightful-watcher');
  const now = Date.now();
  const news = [1, 2, 3, 4].map(i => ({ tags: ['WWE', 'جو هندري'], federation: 'WWE', date: now - i * 86400_000 }));
  const r = federationFromHistory('TNA', ['TNA', 'جو هندري', 'TNA iMPACT', 'أخبار المصارعة', 'عروض TNA'],
    'Joe Hendry Explains Why He Faces Harsher Criticism Over His In-Ring Skills. Hendry spoke to Chris Van Vliet…', news, now);
  assert.equal(r.federation, 'WWE');
  assert.deepEqual(r.tags, ['WWE', 'جو هندري', 'أخبار المصارعة']);
  // the source names TNA: the model's choice stands
  assert.equal(federationFromHistory('TNA', ['TNA', 'جو هندري'], 'Joe Hendry returns to TNA iMPACT tonight', news, now).federation, 'TNA');
  // too little history: no change
  assert.equal(federationFromHistory('TNA', ['TNA', 'جو هندري'], 'Hendry spoke about criticism', news.slice(0, 2), now).federation, 'TNA');
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /federationFromHistory\(rewritten\.federation \|\| "", rewritten\.tags \|\| \[\], `\$\{rawTitle\}\\n\$\{plainText\}`, loadNews\(NEWS_DIR\)\)/);
});

test('a ring name that is a doubled word survives the repeated-word fix', async () => {
  // INCIDENTS #138: «Kelly Kelly» came out «كيلي»
  const { autoFix, checkArticle } = await import('../scripts/news-qa');
  assert.equal(autoFix('كشفت كيلي كيلي أنها رفضت العرض'), 'كشفت كيلي كيلي أنها رفضت العرض');
  assert.equal(autoFix('ظهر بووم بووم في العرض'), 'ظهر بووم بووم في العرض');
  assert.equal(autoFix('المصارع المصارع قال'), 'المصارع قال', 'a real repeat is still fixed');
  assert.ok(!checkArticle('كيلي كيلي تكشف السبب', 'نص الخبر عن كيلي كيلي', []).some(i => i.code === 'repeated_word'));
  assert.equal(JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'))['Kelly Kelly'], 'كيلي كيلي');
});

test('a wrestler named in the headline becomes a tag', async () => {
  // INCIDENTS #140
  const { titleNamesAsTags } = await import('../scripts/fightful-watcher');
  const names = { 'Layla': 'لايلا', 'Kelly Kelly': 'كيلي كيلي', 'Kelly': 'كيلي', 'Sirena Linton': 'سيرينا لينتون', 'IWGP Championship': 'بطولة IWGP' };
  assert.deepEqual(titleNamesAsTags('كيلي كيلي تلقي بولها بطريق الخطأ في فم لايلا خلال إحدى رحلات WWE', ['WWE', 'كيلي كيلي', 'سيرينا ديب'], names),
    ['WWE', 'كيلي كيلي', 'لايلا', 'سيرينا ديب']);
  assert.deepEqual(titleNamesAsTags('ظهور أول لسيرينا لينتون', ['ROH'], names), ['ROH', 'سيرينا لينتون']);
  assert.deepEqual(titleNamesAsTags('خبر بدون أسماء', ['WWE'], names), ['WWE']);
});

test('a news page carries no video in its HTML: YouTube is a thumbnail until clicked, the reel player is added only when a reel exists', () => {
  // INCIDENTS #142: Search Console listed ~900 stories under «video isn't on a watch page»
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  const facade = cfg.slice(cfg.indexOf('function ytFacade('), cfg.indexOf('module.exports'));
  assert.ok(facade.includes('yt-facade-btn') && !/<iframe/.test(facade), 'the build-time YouTube embed is a thumbnail');
  assert.match(cfg, /return ytFacade\(ytId\);/);
  const layout = layoutSource();
  const html = layout.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!/<video id="arwReelVideo"/.test(html), 'no reel <video> in the page HTML');
  assert.match(layout, /document\.createElement\('video'\)/, 'the reel player is created when a reel exists');
  assert.match(layout, /closest\('\.yt-facade-btn'\)/, 'a click turns the thumbnail into the player');
  assert.ok(!/embedDiv\.innerHTML = '<div class="embed-skeleton-card youtube-skeleton">/.test(layout), 'the in-page YouTube embed is a thumbnail too');
});

test('a word broken between Arabic and lowercase Latin is flagged for the copy editor; real Latin names are not', async () => {
  // INCIDENTS #143: «شخصية أك uma الشهيرة»
  const { checkArticle } = await import('../scripts/news-qa');
  const codes = (b: string) => checkArticle('عنوان خبر عادي عن المصارعة', b, []).map(i => i.code);
  assert.ok(codes('يستعد رومان رينز للظهور بدور شخصية أك uma الشهيرة، وذلك قبل طرح فيلم ستريت فايتر المرتقب في دور السينما').includes('broken_word'));
  assert.ok(!codes('تحدثت تشيلسي غرين مع زوجها عبر منصة SiriusXM عن أغاني إمينيم، وخلال برنامج Good Karma Wrestling قال ألين').includes('broken_word'));
  assert.ok(!codes('ظهر في برنامج Two Count Tuesday وتحدث عن WWE وAEW بعد عرض All Out الأخير في شيكاغو أمام الجماهير').includes('broken_word'));
});

test('one wrestler, one tag: a part of a longer Arabic name tag is dropped', async () => {
  // INCIDENTS #144
  const { dropPartialNameTags } = await import('../scripts/fightful-watcher');
  assert.deepEqual(dropPartialNameTags(['AEW', 'مايك بيلي', 'سبيدبول', 'باك', 'سبيدبول مايك بيلي', 'بنجامين ساتيرلي']), ['AEW', 'باك', 'سبيدبول مايك بيلي', 'بنجامين ساتيرلي']);
  assert.deepEqual(dropPartialNameTags(['WWE', 'WWE RAW', 'كيلي كيلي', 'لايلا']), ['WWE', 'WWE RAW', 'كيلي كيلي', 'لايلا']);
  assert.deepEqual(dropPartialNameTags(['باك', 'باك نيفيل']), ['باك نيفيل']);
});

test('compound ordinals take «ال» and PAC\'s names and AEW\'s National title read as on the rest of the site', async () => {
  // INCIDENTS #146
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('جلسة في الثاني وعشرين من سبتمبر'), 'جلسة في الثاني والعشرين من سبتمبر');
  assert.equal(applyCorrections('والحادي والعشرين'), 'والحادي والعشرين');
  assert.equal(applyCorrections('المعروف باسم باك ونفيل'), 'المعروف باسم باك ونيفيل');
  assert.equal(applyCorrections('واجه أندرادي على بطولة ناشيونال'), 'واجه أندرادي على بطولة AEW الوطنية');
});

test('a quoted nickname is dropped from a tag; PAC\'s nickname and a broken phrase are fixed', async () => {
  // INCIDENTS #147
  const { tagInArabic } = await import('../scripts/fightful-watcher');
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections(tagInArabic('تشانينغ “ستاكس” لورينزو')), 'تشانينج لورينزو');
  assert.equal(applyCorrections('ذكرياته عن الرجل الذي نساه الجذب'), 'ذكرياته عن الرجل الذي نسيته الجاذبية');
  assert.equal(applyCorrections('توفي صغيرا في اليعمل يناهز 40 عاما'), 'توفي صغيرا عن عمر يناهز 40 عاما');
});

test('a doubled ya, a bare cardinal date and a genitive object are corrected (INCIDENTS #149)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('وسييشهد مراسم قرع الجرس'), 'وسيشهد مراسم قرع الجرس');
  assert.equal(applyCorrections('يوم ثلاثين سبتمبر'), 'يوم الثلاثين من سبتمبر');
  assert.equal(applyCorrections('أبدت استيائها الشديد'), 'أبدت استياءها الشديد');
  assert.equal(applyCorrections('عبرت عن استيائها'), 'عبرت عن استيائها');
});

test('the same-story check tells a new statement or backstage detail apart from the story it follows (INCIDENTS #150)', async () => {
  const { duplicatePrompt } = await import('../scripts/editorial');
  const dp = duplicatePrompt({ title: 'x', body: 'y', tags: [] }, []);
  assert.match(dp, /«نفس الحدث» يعني نفس الواقعة المحددة، مش نفس الموضوع العام/);
  assert.match(dp, /تأبين أو تصريح من شخص مش مذكور في الخبر المنشور/);
  assert.match(dp, /كواليس أو سبب أو خطة وراء مشهد/);
  const skips = JSON.parse(fs.readFileSync('_data/duplicate-skips.json', 'utf8'));
  assert.equal(skips['https://www.fightful.com/wrestling/kemalito-pays-tribute-to-benjamin-satterley-pac'], undefined);
  // INCIDENTS #327: the wrestler's own podcast account of how she pulled it off is new, not the match again.
  assert.match(dp, /صاحب الواقعة نفسه يحكي في مقابلة أو بودكاست إزاي أو ليه عملها/);
  assert.equal(skips['https://www.ringsidenews.com/wren-sinclair-reveals-how-she-pulled-off-her-nxt-battle-royal-heist/'], undefined);
});

test('RVD is written «آر في دي» with the madda everywhere (INCIDENTS #327)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('وتحدث ار في دي عن القائمة'), 'وتحدث آر في دي عن القائمة');
  assert.equal(applyCorrections('آر في دي'), 'آر في دي');
});

test('Raquel Rodriguez and Aalyah Gutierrez have one spelling each (INCIDENTS #332)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('وراككيل رودريغيز وروكسان بيريز'), 'وراكيل رودريغيز وروكسان بيريز');
  assert.equal(applyCorrections('انضمام أليا غوتيريز إلى مركز الأداء'), 'انضمام ألياه غوتييرز إلى مركز الأداء');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Raquel Rodriguez'], 'راكيل رودريغيز');
  assert.equal(names['Aalyah Gutierrez'], 'ألياه غوتييرز');
});

test('a story about someone the matched story never mentions is published whatever the same-story check says (INCIDENTS #150)', async () => {
  const { newSubject } = await import('../scripts/editorial');
  const rock = { title: 'ذا روك يشيد بـ باك', body: 'تحدث النجم ذا روك عن باك بعد وفاته.', tags: ['AEW', 'ذا روك', 'باك'] };
  assert.equal(newSubject({ title: 'كيماليتو يرثي باك', body: '...', tags: ['AEW', 'كيماليتو', 'باك', 'أخبار المصارعة'] }, rock), 'كيماليتو');
  // the same statement from another source stays a duplicate
  assert.equal(newSubject({ title: 'ذا روك ينعى باك', body: '...', tags: ['ذا روك', 'باك'] }, rock), null);
  // a generic tag in the title is not a new subject
  assert.equal(newSubject({ title: 'عروض WWE تكرم باك', body: '...', tags: ['عروض WWE', 'باك'] }, rock), null);
  const { crossRunDuplicates } = await import('../scripts/cross-run-dedupe');
  const now = Date.parse('2026-09-29T21:00:00Z');
  const mine = { file: 'a.md', title: 'باتيستا يرثي ريك أتشبيرغر', body: 'وجه باتيستا رسالة لريك أتشبيرغر', tags: ['باتيستا', 'ريك أتشبيرغر'], date: now };
  const arrived = [{ file: 'b.md', title: 'وفاة ريك أتشبيرغر', body: 'توفي ريك أتشبيرغر المعروف بسين جاي', tags: ['ريك أتشبيرغر'], date: now }];
  assert.deepEqual(await crossRunDuplicates(mine ? [mine] : [], arrived, async () => '{"duplicate_of":0,"reason":"نفس الحدث"}', now), []);
});

test('a nickname or a longer form of a name is not a new subject that overrules a duplicate (INCIDENTS #151)', async () => {
  const { newSubject } = await import('../scripts/editorial');
  const { applyCorrections } = await import('../scripts/news-qa');
  const wi = { title: 'نجم WWE السابق ديف باتيستا يعلق على وفاة ريك أتشبيرغر الملقب بصاحب اللافتات', body: 'انضم ديف باتيستا إلى المودعين', tags: ['ديف باتيستا', 'ريك أتشبيرغر'] };
  assert.equal(newSubject({ title: 'باتيستا يشيد بـ «ساين غاي ريك» بعد وفاته', body: '', tags: ['باتيستا', 'ساين غاي ريك', 'ريك أتشبيرغر'] }, wi), null);
  // a person the other story never mentions still is
  assert.equal(newSubject({ title: 'إل كيماليتو يكرم باك', body: '', tags: ['إل كيماليتو', 'باك'] }, { title: 'ذا روك يشيد بـ باك', body: 'ذا روك', tags: ['ذا روك', 'باك'] }), 'إل كيماليتو');
  assert.equal(applyCorrections('رحيل ريك أخبرغر وريك أتشبيرجر'), 'رحيل ريك أتشبيرغر وريك أتشبيرغر');
});

test('a weekly show dated to a day it does not air on is flagged, and one tweet is embedded once (INCIDENTS #152)', async () => {
  const { showOnWrongWeekday, checkArticle } = await import('../scripts/news-qa');
  assert.equal(showOnWrongWeekday('عرض AEW Dynamite الذي يقام يوم الثامن والعشرين من سبتمبر', 2026), 'AEW Dynamite الذي يقام يوم الثامن والعشرين من سبتمبر');
  assert.equal(showOnWrongWeekday('عرض AEW Dynamite الذي يقام يوم الثلاثين من سبتمبر', 2026), null);
  assert.equal(showOnWrongWeekday('عرض WWE RAW يوم 28 سبتمبر', 2026), null);
  assert.equal(showOnWrongWeekday('عرض WWE NXT Live يوم 18 سبتمبر', 2026), null);
  assert.ok(checkArticle('x', 'يستعد الاتحاد لعرض AEW Dynamite يوم 28 سبتمبر المقبل.', []).some(i => i.code === 'show_wrong_day') || new Date().getUTCFullYear() !== 2026);
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /const key = `x:\$\{tweetId\}`/);
});

test('«first televised title defense» is not «his first television title» (INCIDENTS #153)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('يستعد غرايسون والر للدفاع عن لقبه التلفزيوني الأول منذ تتويجه'), 'يستعد غرايسون والر لخوض أول دفاع تلفزيوني عن لقبه منذ تتويجه');
});

test('names from the NXT Dusty Classic coverage, and the same-story rules for replies and single results (INCIDENTS #154)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('فوز تشارز «ستاربوي» هول بعد حركة ستاننر وهجوم رجينا فولكانو'), 'فوز تشاز «ستاربوي» هول بعد حركة ستانر وهجوم رينا فولكانو');
  assert.equal(applyCorrections('تأهل فرأكسيوم وستارلوي'), 'تأهل فراكسيوم وستاربوي');
  assert.equal(applyCorrections('تحية لروح النصر الراحل باك'), 'تحية لروح النجم الراحل باك');
  assert.equal(applyCorrections('وصلت رينا فولكانو'), 'وصلت رينا فولكانو');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Mini Vikingo'], 'ميني فيكينغو');
  assert.equal(names['Chazz Hall'], 'تشاز هول');
  const { duplicatePrompt } = await import('../scripts/editorial');
  const p = duplicatePrompt({ title: 'x', body: 'y', tags: [] } as any, []);
  assert.match(p, /رد صاحب الشأن نفسه/);
  assert.match(p, /تقرير نتائج كامل فيه نفس النزال = تكرار/);
});

test('Kendal Grey is always «كيندال غراي» — never «غري» or «جراي» (INCIDENTS #159)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('قصة كيندال غري مع كيندال جراي'), 'قصة كيندال غراي مع كيندال غراي');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Kendal Grey'], 'كيندال غراي');
  const wrong = /كيندال (جراي|غري)/;
  for (const dir of ['content/news', 'content/shows']) {
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.md'))) {
      const body = fs.readFileSync(`${dir}/${f}`, 'utf8').replace(/^permalink:.*$/m, '');
      assert.doesNotMatch(body, wrong, f);
    }
  }
});

test('«بالتميز» not «بالتمييز», and Kenta Kobashi is «كوباشي» — never the other Kenta (INCIDENTS #160)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('مسيرته الحافلة بالتمييز والإبداع'), 'مسيرته الحافلة بالتميز والإبداع');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Kenta Kobashi'], 'كينتا كوباشي');
  for (const f of fs.readdirSync('content/news').filter(n => n.endsWith('.md'))) {
    const body = fs.readFileSync(`content/news/${f}`, 'utf8');
    assert.doesNotMatch(body, /بالتمييز والإبداع|إتقان كينتا الأصلي/, f);
  }
});

test('Hollywood is «هوليوود» with two waws (INCIDENTS #161)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('شبّه النجم الهوليودي نيكولاس كيج'), 'شبّه النجم الهوليوودي نيكولاس كيج');
  assert.equal(applyCorrections('نجوم هوليود'), 'نجوم هوليوود');
  assert.equal(applyCorrections('نجوم هوليوود'), 'نجوم هوليوود');
  for (const f of fs.readdirSync('content/news').filter(n => n.endsWith('.md'))) {
    const body = fs.readFileSync(`content/news/${f}`, 'utf8');
    assert.doesNotMatch(body, /هوليود/, f);
    // No story on the site embeds one tweet twice (the #152 fix came after the Tony Khan story)
    const ids = [...body.matchAll(/^https:\/\/(?:x|twitter)\.com\/[^/\s]+\/status\/(\d+)/gm)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, f);
  }
  // Two stories with one title are one story twice (RAW 21 Sep had two results reports, from before the one-report rule)
  const titles = new Map<string, string>();
  for (const f of fs.readdirSync('content/news').filter(n => n.endsWith('.md'))) {
    const t = (fs.readFileSync(`content/news/${f}`, 'utf8').match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1];
    if (!t) continue;
    assert.ok(!titles.has(t), `${f} has the same title as ${titles.get(t)}`);
    titles.set(t, f);
  }
});

test('a debut months ago told as history («منذ ظهوره الأول في أبريل») does not hold a story off social (INCIDENTS #154)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('نجح ميسون روك نجم عرض WWE NXT في ترك انطباع قوي سريع منذ ظهوره الأول في شهر أبريل الماضي، ليحصل على فرصة'), false);
  assert.equal(isSingleMatchSpoiler('ميسون روك يسجل ظهوره الأول في عرض WWE NXT'), true);
  assert.equal(isSingleMatchSpoiler('ساموا جو يعود في عرض AEW All Out'), true);
});

test('a title win someone is aiming for, and a return to training, do not hold a story off social (INCIDENTS #155)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('كاسي لي: الفوز ببطولة AEW العالمية للفرق للسيدات هو هدفي الأبرز في عالم المصارعة'), false);
  assert.equal(isSingleMatchSpoiler('كايري ساني تعود إلى التدريبات داخل الحلبة مع اقتراب موعد عودتها للمصارعة'), false);
  assert.equal(isSingleMatchSpoiler('كاسي لي تحقق الفوز ببطولة AEW العالمية للفرق للسيدات'), true);
  assert.equal(isSingleMatchSpoiler('كايري ساني تعود في عرض WWE RAW'), true);

  // The model called a win at AEW All Out «recent» three days after the show
  const { settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const now = Date.parse('2026-09-30T05:00:00Z');
  const said = { spoils: true, kind: 'result' as const, age: 'recent' as const, note: '' };
  const day = ['wwe nxt', 'roh tv'], week = ['aew all out', 'wwe nxt', 'roh tv'];
  const out = settleSpoilerAge(said, 'ألقى ويل أوسبراي تصريحات عقب عرض AEW All Out بعد فوزه على جون موكسلي', day, now, week);
  assert.equal(out.spoils, false);
  assert.equal(out.age, 'old');
  // A show that aired in the last day still spoils
  assert.equal(settleSpoilerAge(said, 'فوز غرايسون والر في عرض WWE NXT بعد عرض AEW All Out', day, now, week).spoils, true);
  // So does a stated date from today
  assert.equal(settleSpoilerAge(said, 'فوزه في عرض AEW All Out يوم 30 سبتمبر', day, now, week).spoils, true);
});

test('an announcement about a weekly show that has not aired yet is not «something from a show» (INCIDENTS #156)', async () => {
  const { weeklyShowsAiredWithin, settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const beforeNxt = Date.parse('2026-09-29T21:50:00Z'); // NXT airs 00:00 UTC on the 30th
  const afterNxt = Date.parse('2026-09-30T01:45:00Z');
  assert.deepEqual(weeklyShowsAiredWithin(27, beforeNxt), ['wwe raw']);
  assert.ok(weeklyShowsAiredWithin(27, afterNxt).includes('wwe nxt'));
  const held = { spoils: true, kind: 'show' as const, age: 'recent' as const, note: '' };
  const text = 'ميسون روك غير حاصل على التصريح الطبي للمنافسة في عرض WWE NXT';
  assert.equal(settleSpoilerAge(held, text, [], beforeNxt, []).spoils, false);
  assert.equal(settleSpoilerAge(held, 'إقامة نزال باتل رويال للسيدات في عرض WWE NXT', [], afterNxt, []).spoils, true);
  // a show named only through the results list still counts
  assert.equal(settleSpoilerAge(held, 'حصل في عرض WWE NXT', ['wwe nxt'], beforeNxt, []).spoils, true);
});

test('the spoiler window of a weekly show starts when it goes off the air, not 3 hours after it starts (INCIDENTS #329)', async () => {
  const { weeklyShowsInSpoilerWindow, settleSpoilerAge } = await import('../scripts/fightful-watcher');
  // NXT 6 October: 00:00–02:00 UTC on the 7th; Wren Sinclair's interview was held at 08:54
  const during = Date.parse('2026-10-07T07:30:00Z');
  const after = Date.parse('2026-10-07T08:54:00Z');
  assert.ok(weeklyShowsInSpoilerWindow(during).includes('wwe nxt'));
  assert.ok(!weeklyShowsInSpoilerWindow(after).includes('wwe nxt'));
  // RAW runs three hours: still a spoiler at 08:30 UTC on Tuesday
  assert.ok(weeklyShowsInSpoilerWindow(Date.parse('2026-10-06T08:30:00Z')).includes('wwe raw'));
  const said = { spoils: true, kind: 'result' as const, age: 'recent' as const, note: '' };
  const text = 'رين سنكلير تكشف كيف نفذت عملية تسللها في نزال باتل رويال ضمن عرض WWE NXT الذي أقيم في السادس من أكتوبر';
  assert.equal(settleSpoilerAge(said, text, [], during, ['wwe nxt'], weeklyShowsInSpoilerWindow(during), ['wwe nxt']).spoils, true);
  assert.equal(settleSpoilerAge(said, text, [], after, ['wwe nxt'], weeklyShowsInSpoilerWindow(after), ['wwe nxt']).spoils, false);
});

test('a card set more than a week out names the day instead of «القادم» (INCIDENTS #162)', async () => {
  const { farFutureShowDate, arabicDayOrdinal } = await import('../scripts/fightful-watcher');
  assert.equal(arabicDayOrdinal(13), 'الثالث عشر');
  assert.equal(arabicDayOrdinal(21), 'الحادي والعشرين');
  assert.equal(arabicDayOrdinal(11), 'الحادي عشر');
  assert.equal(arabicDayOrdinal(6), 'السادس');
  const src = 'Saquon Shugars vs. Tristan Angels Made Official For 10/13 WWE NXT';
  assert.equal(
    farFutureShowDate('تحديد نزال بين ساكوان شوجرز وتريستان أنجيلز رسميا في عرض WWE NXT القادم', src, '2026-09-30T12:35:53Z'),
    'تحديد نزال بين ساكوان شوجرز وتريستان أنجيلز رسميا في عرض WWE NXT يوم الثالث عشر من أكتوبر');
  // next week's episode stays «القادم»
  const next = 'نزال في عرض WWE NXT القادم';
  assert.equal(farFutureShowDate(next, 'Match Set For 10/6 WWE NXT', '2026-09-30T12:35:53Z'), next);
});

test('the site watchdog checks pages, bots and platforms every minute and keeps a problem open until it is fixed (INCIDENTS #158)', async t => {
  const { failedWorkflows, stuckOnSocial, mergeProblems, runSiteHealthCheck, siteHealth, deployLag, onlyBookkeeping } = await import('../worker/src/health');
  assert.equal(onlyBookkeeping([{ filename: 'watcher-state.json' }, { filename: 'seo/new-shows.json' }]), true, 'bookkeeping-only changes are not a stale deploy');
  assert.equal(onlyBookkeeping([{ filename: 'watcher-state.json' }, { filename: 'content/news/x.md' }]), false);
  assert.equal(onlyBookkeeping([]), false);
  const nowMs = Date.parse('2026-10-08T14:00:00Z');
  assert.equal(deployLag(nowMs / 1000 - 3600, nowMs) > 0, true, 'a live build an hour behind main is a problem');
  assert.equal(deployLag(nowMs / 1000 - 600, nowMs), 0);
  assert.equal(deployLag(0, nowMs), 0);
  const now = Date.parse('2026-09-30T12:00:00Z');
  // latest finished run per workflow decides
  assert.deepEqual(failedWorkflows([
    { name: 'A', status: 'completed', conclusion: 'success', created_at: '2026-09-30T11:00:00Z' },
    { name: 'A', status: 'completed', conclusion: 'failure', created_at: '2026-09-30T10:00:00Z' },
    { name: 'B', status: 'in_progress', conclusion: null },
    { name: 'B', status: 'completed', conclusion: 'failure', created_at: '2026-09-30T09:00:00Z', html_url: 'u' },
  ]).map(f => f.name), ['B']);
  // on the site over an hour, not held, missing a platform
  const items = [
    { url: '/news/a/', title: 'أ', published_at: '2026-09-30T10:30:00Z' },
    { url: '/news/b/', title: 'ب', published_at: '2026-09-30T10:30:00Z' },
    { url: '/news/c/', title: 'ج', published_at: '2026-09-30T11:30:00Z' },
    { url: '/news/d/', title: 'د', published_at: '2026-09-30T10:30:00Z' },
  ];
  const state = { telegram: { a: 1, b: 1 }, facebook: { a: 1, b: 1 }, instagram: { a: 1 }, held: { d: { at: 1 } } };
  // Instagram silent for hours: a fault
  assert.deepEqual(stuckOnSocial(items, state, (it: any) => it.url.split('/')[2], now), [{ title: 'ب', missing: ['إنستغرام'] }]);
  // Instagram posting newer stories (its daily ration): not a fault
  assert.deepEqual(stuckOnSocial(items, { ...state, instagram: { a: 1, z: now - 5 * 60_000 } }, (it: any) => it.url.split('/')[2], now), []);
  // Instagram silent, but today's ration keeps this story off it: not a fault either
  assert.deepEqual(stuckOnSocial(items, state, (it: any) => it.url.split('/')[2], now, () => false), []);
  // past the worker's 3-hour Instagram window a story is not waiting for Instagram any more (INCIDENTS #190)
  const late = [{ url: '/news/b/', title: 'ب', published_at: '2026-09-30T06:00:00Z' }];
  assert.deepEqual(stuckOnSocial(late, { telegram: { b: 1 }, facebook: { b: 1 }, instagram: {} }, (it: any) => it.url.split('/')[2], now), []);
  // Telegram missing is always a fault
  assert.deepEqual(stuckOnSocial(items, { ...state, telegram: { a: 1 }, instagram: { a: 1, b: 1, z: now } }, (it: any) => it.url.split('/')[2], now), [{ title: 'ب', missing: ['تيليجرام'] }]);
  // released from a hold eight minutes ago: not stuck yet, whatever its publish time
  const released = { ...state, held: { ...state.held, b: { at: 1, releasedAt: now - 8 * 60_000 } } };
  assert.deepEqual(stuckOnSocial(items, released, (it: any) => it.url.split('/')[2], now), []);
  // «since» survives while the problem stays open
  const first = mergeProblems([], [{ key: 'page:/', code: 'page_down', title: 'x', detail: '' }], ['page_down'], 1000);
  assert.equal(mergeProblems(first, [{ key: 'page:/', code: 'page_down', title: 'x', detail: '' }], ['page_down'], 5000)[0].since, 1000);
  assert.deepEqual(mergeProblems(first, [], ['page_down'], 5000), []);

  // a full tick: the home page is down → recorded, and told once after two minutes
  const kv = new Map<string, string>();
  const env: any = { SITE_ORIGIN: 'https://site.test', GITHUB_TOKEN: 't', GITHUB_OWNER: 'o', GITHUB_REPO: 'r', TELEGRAM_BOT_TOKEN: 'b', ADMIN_TELEGRAM_CHAT_ID: '1',
    PUSH_KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } };
  const told: string[] = [];
  const page = '<html>' + 'x'.repeat(2000) + '</html>';
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const u = String(input);
    if (u.includes('api.telegram.org')) { told.push(JSON.parse(init.body).text); return new Response('{}'); }
    if (u.includes('watcher-recent-content.json')) return Response.json([{ url: '/news/a/', title: 'أ', published_at: new Date().toISOString() }]);
    if (u.startsWith('https://site.test/?')) return new Response('down', { status: 502 });
    return new Response(page, { status: 200 });
  });
  await runSiteHealthCheck(env, 1, (it: any) => it.url, async () => ({}));
  let h = await siteHealth(env);
  assert.deepEqual(h.problems.map(p => p.title), ['الصفحة الرئيسية مش بتفتح']);
  assert.equal(told.length, 0, 'one failed minute is not told yet');
  const rec = JSON.parse(kv.get('site_health')!); rec.problems[0].since -= 120_000; kv.set('site_health', JSON.stringify(rec));
  await runSiteHealthCheck(env, 2, (it: any) => it.url, async () => ({}));
  await runSiteHealthCheck(env, 3, (it: any) => it.url, async () => ({}));
  assert.equal(told.length, 1, 'told once, not every minute');
  assert.match(told[0], /الصفحة الرئيسية مش بتفتح/);
  // index wires it into the minute tick and the bell
  const src = fs.readFileSync('worker/src/index.ts', 'utf8');
  assert.match(src, /runSiteHealthCheck\(env, minute/);
  assert.match(src, /type: "health"/);
});

test('a debut on a show that aired two days ago is ordinary news, not a spoiler (INCIDENTS #159)', async () => {
  const { settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const now = Date.parse('2026-09-30T16:20:00Z'); // RAW of the 28th aired 00:00–03:00 UTC on the 29th
  const v = { spoils: true, kind: 'return' as const, age: 'recent' as const, note: '' };
  const text = 'بولي راي يعلق على ظهور جايدا باركر في عرض WWE RAW';
  assert.equal(settleSpoilerAge(v, text, [], now, ['wwe raw'], undefined, ['wwe raw']).spoils, false);
  // the same debut the night of the show stays held
  assert.equal(settleSpoilerAge(v, text, [], Date.parse('2026-09-29T02:00:00Z'), ['wwe raw'], undefined, ['wwe raw']).spoils, true);
});

test('a promotion or a broadcast format coming back is not a wrestler return (INCIDENTS #159)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('اتحاد MLW يعود إلى نظام الدفع مقابل المشاهدة في السابع من نوفمبر'), false);
  assert.equal(isSingleMatchSpoiler('عرض WWE Saturday Night Main Event يعود إلى قناة NBC'), false);
  assert.equal(isSingleMatchSpoiler('ساموا جو يعود في عرض AEW All Out'), true);
});

test('old-story sweep: a jussive after «لم», a cut word and a CMLL show name are corrected (INCIDENTS #160)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('لم يحتاج كينغ سوى ثوان'), 'لم يحتج كينغ سوى ثوان');
  assert.equal(applyCorrections('ضمن عرض هوميناجي ا دو لييناس'), 'ضمن عرض Homenaje a Dos Leyendas');
});

test('CNN is written in full and a broken «رضى» phrase is corrected (INCIDENTS #161)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('شبكات مثل سي إن وسي بي إس نيوز'), 'شبكات مثل سي إن إن وسي بي إس نيوز');
  assert.equal(applyCorrections('مثل سي إن إن وسي بي إس نيوز'), 'مثل سي إن إن وسي بي إس نيوز');
  assert.equal(applyCorrections('لم تكن لديهم رضى عن التوقيت'), 'لم يكونوا راضين عن التوقيت');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['CNN'], 'سي إن إن');
});

test('Instagram\'s daily posts go to the most important stories first (INCIDENTS #162)', async () => {
  const { instagramAllowedFor } = await import('../worker/src/index');
  // cap 90, 12 kept for show reels → 78 for news; normal leaves 15 of them for big stories; low only the first half
  assert.equal(instagramAllowedFor('high', 70, 90), true);
  assert.equal(instagramAllowedFor('normal', 70, 90), false);
  assert.equal(instagramAllowedFor('normal', 60, 90), true);
  assert.equal(instagramAllowedFor('', 60, 90), true, 'unrated (older) stories count as normal');
  assert.equal(instagramAllowedFor('low', 40, 90), false);
  assert.equal(instagramAllowedFor('low', 30, 90), true);
  assert.equal(instagramAllowedFor('high', 78, 90), false, 'the reels reserve is never touched');
  // the writer asks for it and records it; the feed carries it to the worker
  const writer = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(writer, /"priority": "high"\|"normal"\|"low"/);
  assert.match(writer, /social_priority: \$\{socialVerdict\.priority\}/);
  assert.match(fs.readFileSync('pages/watcher-recent-content.njk', 'utf8'), /"social_priority"/);
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /!instagramAllowedFor\(item\.social_priority, igBudget\.used, igBudget\.cap\)\) igDone = true/);
});

test('«ابدا» takes its hamza (INCIDENTS #163)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('لن تكون للبيع ابدا'), 'لن تكون للبيع أبدا');
  assert.equal(applyCorrections('لا تقل أبدا'), 'لا تقل أبدا');
});

test('a new tag takes the spelling the site already uses — one person, one tag page (INCIDENTS #164)', async () => {
  const { canonicalTags, knownTagSpellings, tagKey } = await import('../scripts/fightful-watcher');
  const news = [{ tags: ['أخبار المصارعة', 'AAA on FOX'] }, { tags: ['أخبار المصارعة', 'AAA on FOX', 'إيو سكاي'] }, { tags: ['إيو سكاي'] }];
  const known = knownTagSpellings(news, { 'Iyo Sky': 'آيو سكاي' });
  assert.deepEqual(canonicalTags(['أخبارالمصارعة', 'AAA on Fox', 'إيو سكاي', 'باك'], known), ['أخبار المصارعة', 'AAA on FOX', 'آيو سكاي', 'باك']);
  assert.equal(tagKey('إصابات المصارعة'), tagKey('اصابات المصارعة'));
  // the site's own tags have no split names left
  const files = fs.readdirSync('content/news').filter(f => f.endsWith('.md'));
  const text = files.map(f => fs.readFileSync(`content/news/${f}`, 'utf8')).join('\n');
  assert.doesNotMatch(text, /^\s+- (?:إيو سكاي|أخبارالمصارعة|اصابات المصارعة|دي فون دادلي)$/m);
  assert.match(fs.readFileSync('_redirects', 'utf8'), /\/tag\/إيو-سكاي\/\* \/tag\/آيو-سكاي\/:splat 301!/);
});

test('company names follow the glossary in tags and text: one Paramount and one Warner Bros Discovery tag (INCIDENTS #165)', async () => {
  const { tagInArabic } = await import('../scripts/fightful-watcher');
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(tagInArabic('Warner Bros Discovery'), 'وارنر براذرز ديسكفري');
  assert.equal(tagInArabic('Paramount'), 'باراماونت');
  assert.equal(applyCorrections('اندماج باراماونت وWDB'), 'اندماج باراماونت ووارنر براذرز ديسكفري');
});

test('«program» is a storyline, «Cage & Cope» is one team, and a named source is named (INCIDENTS #167)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('إثر تفوقهما على فريقي كيج وآدم كوبلاند وإف تي آر'), 'إثر تفوقهما على فريق كريستيان كيج وآدم كوبلاند وفريق إف تي آر');
  assert.equal(applyCorrections('انضمام أوميغا إلى برنامجهما الرئيسي'), 'انضمام أوميغا إلى قصتهما الكبرى');
  const writer = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(writer, /\*\*program\*\* في المصارعة = \*\*قصة\*\*/);
  assert.match(writer, /ممنوع «أوضحت الكواليس»/);
  assert.equal(JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'))['Cage & Cope'], 'كريستيان كيج وآدم كوبلاند');
});

test('a leaks report goes out like a results report: the show name and a fixed line, never a result (INCIDENTS #168)', async () => {
  const { isSingleMatchSpoiler, isResultsArticle, socialResultsTitle } = await import('../worker/src/index');
  const { isTapingSpoiler } = await import('../scripts/fightful-watcher');
  const t = 'تسريبات عرض WWE X AAA Worlds Collide من تسجيلات 26 سبتمبر في شيكاغو';
  assert.equal(isSingleMatchSpoiler(t), false, 'not held: the owner wants leaks on social as promotion');
  assert.equal(isResultsArticle(t), true, 'so its text is the fixed line, not the first result');
  assert.equal(socialResultsTitle('تسريبات عرض ROH (24 سبتمبر 2026): فوز فلان باللقب'), 'تسريبات عرض ROH (24 سبتمبر 2026)');
  assert.equal(isTapingSpoiler('WWE X AAA Worlds Collide Spoilers From 9/26 Taping In Chicago Reportedly Revealed'), true);
  assert.equal(isTapingSpoiler('WWE Raw Results 9/28/2026', 'نتائج عرض WWE RAW'), false);
  // a leak that names a winner in the title is still held
  assert.equal(isSingleMatchSpoiler('تسريبات: فلان يهزم علان في تسجيلات ROH'), true);
});

test('«free agent» is «مصارع حر» and one-word generic tags are dropped (INCIDENTS #169)', async () => {
  const { applyCorrections, isJunkTag } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('وتحوله إلى وكيل حر في الأول من أكتوبر'), 'وتحوله إلى مصارع حر في الأول من أكتوبر');
  assert.equal(isJunkTag('تلفزيون'), true);
  assert.equal(isJunkTag('اندبندنت'), true);
  assert.equal(isJunkTag('أخبار المصارعة'), false);
  assert.equal(isJunkTag('NWA'), false);
});

test('an English show name is not half-translated, and Chase Burnett keeps one spelling (INCIDENTS #170)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('يشهد عرض AEW Dynamite: Tribute To باك المخصص'), 'يشهد عرض AEW Dynamite التكريمي لباك المخصص');
  assert.equal(applyCorrections('واعتزال تشيس بينيت بسبب الإصابة'), 'واعتزال تشيس بورنيت بسبب الإصابة');
});

test('an announced return on a show still to come is not held as a spoiler (INCIDENTS #171)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('عودة فريق ذا إيليت ونزال مرتقب على البطولة القارية ضمن عرض AEW Dynamite'), false);
  assert.equal(isSingleMatchSpoiler('عودة رومان رينز في عرض WWE RAW القادم'), false);
  assert.equal(isSingleMatchSpoiler('رومان رينز يعود في عرض WWE RAW ويواجه سولو في العرض القادم'), true, 'a return that happened stays held');
  assert.equal(isSingleMatchSpoiler('ساموا جو يعود في عرض AEW All Out'), true);
});

test('Tony Schiavone is «توني شيفاني» everywhere, and the learner can never flip it back (INCIDENTS #172)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Tony Schiavone'], 'توني شيفاني');
  assert.equal(applyCorrections('توني سكيافوني يشيد بالراحل باك'), 'توني شيفاني يشيد بالراحل باك');
  assert.equal(applyCorrections('توني شيفاني'), 'توني شيفاني');
  const corrections = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf8')).corrections;
  assert.ok(!corrections.some((c: any) => c.wrong === 'توني شيفاني'), 'the learned reverse rule is gone');
  const text = fs.readdirSync('content/news').filter(f => f.endsWith('.md')).map(f => fs.readFileSync(`content/news/${f}`, 'utf8').replace(/^permalink:.*$/m, '')).join('\n');
  assert.doesNotMatch(text, /سكيافوني/);
  // the learner skips a pair whose «wrong» is the glossary's spelling
  assert.match(fs.readFileSync('scripts/learn-corrections.ts', 'utf8'), /canonical\.has\(wrong\)/);
});

test('«ساعت» and the «مستذكر» forms are corrected (INCIDENTS #173)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('بأقل من 24 ساعت عن عمر'), 'بأقل من 24 ساعة عن عمر');
  assert.equal(applyCorrections('عن باك، مستذكرا مواجهته'), 'عن باك، متذكرا مواجهته');
  assert.equal(applyCorrections('مستذكرين إسهاماته'), 'متذكرين إسهاماته');
});

test('a hold is lifted as soon as today\'s rules say it is not a spoiler (INCIDENTS #174)', async () => {
  const { stillSpoiler } = await import('../worker/src/index');
  assert.equal(stillSpoiler({ why: 'title', title: 'اتحاد MLW يعود إلى نظام الدفع مقابل المشاهدة في السابع من نوفمبر' }), false);
  assert.equal(stillSpoiler({ why: 'title', title: 'عودة فريق ذا إيليت ونزال مرتقب على البطولة القارية ضمن عرض AEW Dynamite' }), false);
  assert.equal(stillSpoiler({ why: 'title', title: 'ساموا جو يعود في عرض AEW All Out' }), true);
  // an AI hold stands until the story itself is marked clean
  assert.equal(stillSpoiler({ why: 'ai', title: 'بولي راي يعلق' }, { title: 'بولي راي يعلق', social_spoiler: true }), true);
  assert.equal(stillSpoiler({ why: 'ai', title: 'بولي راي يعلق' }, { title: 'بولي راي يعلق', social_spoiler: false }), false);
  assert.equal(stillSpoiler({ why: 'ai', title: 'x' }, undefined), true, 'unknown story: keep holding');
  // a title hold the meaning check also called a spoiler stays
  assert.equal(stillSpoiler({ why: 'title', title: 'اتحاد MLW يعود إلى نظام الدفع' }, { social_spoiler: true }), true);
});

test('NJPW has its own section: home block 3 + 4, a federation page, the panel list and the writer (INCIDENTS #175)', async () => {
  const { isNjpwStory } = await import('../scripts/fightful-watcher');
  assert.equal(isNjpwStory('NJPW Destruction In Kobe Results'), true);
  assert.equal(isNjpwStory('Yota Tsuji Wants To Build An Equal Relationship With AEW'), false);
  assert.equal(isNjpwStory('Wrestle Kingdom 21 Dates Announced'), true);
  const feds = (await import('../_data/federations.js')).default as any[];
  assert.deepEqual(feds.map(f => f.code), ['WWE', 'AEW', 'NJPW', 'TNA', 'ROH', 'MMA', 'INDIE']);
  const home = fs.readFileSync('index.njk', 'utf8');
  assert.match(home, /<div class="feds-grid feds-top">\n<a href="\/federation\/wwe\/"[^\n]*\n<a href="\/federation\/aew\/"[^\n]*\n<a href="\/federation\/njpw\/"/);
  assert.match(home, /\.fed-njpw \.fed-mark\{ background:linear-gradient\(135deg,hsl\(212 16% 46%\),hsl\(214 20% 27%\)\); \}/);
  assert.doesNotMatch(home, /class="count"/, 'no story counts on the cards');
  // phones: every card the same size, two per row, one grid (INCIDENTS #176)
  assert.match(home, /\.feds-wrap\{ display:grid; grid-template-columns:repeat\(2,1fr\); gap:10px; \} \.feds-wrap > \.feds-grid\{ display:contents; \}/);
  assert.doesNotMatch(home, /grid-column:1 \/ -1; \} \.feds-bot/);
  // an eighth card, the show library, on phones only (INCIDENTS #177)
  assert.match(home, /<a href="\/library\/" class="fed-card fed-library">/);
  assert.match(home, /\.feds-bot > \.fed-library\{ display:none; \}/);
  assert.match(home, /\.feds-bot > \.fed-library\{ display:block; \}/);
  assert.match(fs.readFileSync('eleventy.config.js', 'utf8'), /slug: "njpw", code: "NJPW"/);
  assert.match(fs.readFileSync('studio/js/schema.js', 'utf8'), /'NJPW'/);
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /const ALLOWED_FEDERATIONS = \["WWE", "AEW", "NJPW"/);
});

test('every page loads the motion and reader-experience layers, and they never hide content on their own (INCIDENTS #178, #179)', () => {
  const init = fs.readFileSync('_includes/theme-init.njk', 'utf8');
  assert.match(init, /\/assets\/motion\.css\?v=/);
  assert.match(init, /\/assets\/motion\.js\?v=\w+" defer/);
  assert.match(init, /\/assets\/experience\.js\?v=\w+" defer/);
  const css = fs.readFileSync('assets/motion.css', 'utf8');
  // cards are hidden only while the script runs (html.m-on), and reduced motion turns everything off
  assert.match(css, /html\.m-on \.m-card \{ opacity: 0;/);
  assert.doesNotMatch(css.replace(/html\.m-on[^{]*\{[^}]*\}/g, ''), /\.m-card \{[^}]*opacity: 0/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const js = fs.readFileSync('assets/motion.js', 'utf8');
  assert.match(js, /if \(reduce \|\| !\('IntersectionObserver' in window\)\) return;/);
  const xp = fs.readFileSync('assets/experience.js', 'utf8');
  assert.doesNotMatch(xp, /كمّل المشاهدة/, 'the owner removed the «continue watching» row');
  assert.match(xp, /speculationrules/);
  assert.doesNotMatch(fs.readFileSync('index.njk', 'utf8'), /<svg[^>]*>[\s\S]{0,300}?<\/svg>مكتبة العروض/, 'the library card is the word alone');
});

test('«الأكثر مشاهدة»: only single content pages are ranked, views summed per page, best first (INCIDENTS #180)', async () => {
  const { rankPages, contentKind } = await import('../worker/src/top10');
  assert.equal(contentKind('/shows/wwe-raw-28-09-2026/'), 'show');
  assert.equal(contentKind('/news/2/'), null, 'a page number is not a story');
  assert.equal(contentKind('/tag/wwe/'), null);
  assert.equal(contentKind('/'), null);
  const ranked = rankPages([
    { path: '/news/a', views: 30 }, { path: '/news/a/', views: 25 }, { path: '/shows/b/', views: 40 },
    { path: '/federation/wwe/', views: 999 }, { path: '/shows/b/?x=1', views: 5 }, { path: '/admin/', views: 500 },
  ]);
  assert.deepEqual(ranked.map(r => [r.path, r.views]), [['/shows/b/', 45]], 'news stays out of the poster row (INCIDENTS #181)');
  const { decodeEntities } = await import('../worker/src/top10');
  assert.equal(decodeEntities('أغنيتها الأولى بعنوان I&#39;m Just Drunk &amp; More &#x2014;'), 'أغنيتها الأولى بعنوان I\'m Just Drunk & More —');
  assert.equal(contentKind('/recaps/wwe-raw-28-09-2026/'), 'recap');
  assert.equal(contentKind('/nostalgia/wwf-badd-blood-in-your-house-1997/'), 'nostalgia');
  assert.equal(contentKind('/news/x/'), null);
  const src = fs.readFileSync('worker/src/index.ts', 'utf8');
  assert.match(src, /if \(path === "\/top10" && request\.method === "GET"\) return top10Response/);
  const js = fs.readFileSync('assets/top10.js', 'utf8');
  assert.match(js, /if \(!top \|\| top\.length < 5\) return;/, 'no list, no section');
  assert.match(js, /load\('week'\)\.then/, 'the week\'s top ten only (INCIDENTS #183)');
  assert.doesNotMatch(js, /اليوم|هذا الأسبوع|t10-tabs/, 'no day/week switch or label');
  assert.match(js, /overflow-y:hidden/, 'the row never scrolls up and down under the mouse wheel');
  assert.match(fs.readFileSync('index.njk', 'utf8'), /<script src="\/assets\/top10\.js\?v=\d+" defer><\/script>/);
});

test('a tatweel joins the name without a space: «لـباك», «بـباك» (INCIDENTS #184)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('قميصا تكريميا لـ باك'), 'قميصا تكريميا لـباك');
  assert.equal(applyCorrections('يشيد بـ باك'), 'يشيد بـباك');
});

test('a story stopped as a spoiler is recorded as held even when Instagram\'s ration skipped it (INCIDENTS #185)', async () => {
  const src = fs.readFileSync('worker/src/index.ts', 'utf8');
  assert.match(src, /const reachedAny = !!\(state\.telegram\[key\] \|\| state\.facebook\[key\] \|\| state\.instagram\[key\]\);/);
  assert.match(src, /if \(!reachedAny\) state\.held\[key\] = \{/);
  assert.doesNotMatch(src, /if \(!\(tgDone \|\| fbDone \|\| igDone\)\) state\.held\[key\]/);
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('عودة النجم برايان دانيلسون'), 'عودة النجم براين دانيلسون');
});

test('«real name» is «واسمه الحقيقي», and nothing the source never said is added to a death story (INCIDENTS #186)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('تحية خاصة للمصارع باك الحقيقي بنجامين ساتيرلي'), 'تحية خاصة للمصارع باك، واسمه الحقيقي بنجامين ساتيرلي');
  const writer = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(writer, /ممنوع «تمنوا له التوفيق» أو «الشفاء العاجل» لشخص متوفي/);
  assert.match(writer, /\*\*real name X\*\* = «واسمه الحقيقي X»/);
});

test('«المقاتليين» loses its extra ya (INCIDENTS #187)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('في نزال ثماني المقاتليين'), 'في نزال ثماني المقاتلين');
});

test('big numbers, years and amounts stay in digits; spelled-out ones are flagged (INCIDENTS #188)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const flag = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b, []).some(i => i.code === 'spelled_number');
  assert.equal(flag('بلغ مجموعها ألفا وخمسمائة وواحدا وخمسين دولارا أمريكيا وفلسين.'), true);
  assert.equal(flag('تم توقيفه في سبتمبر ألفين وستة وعشرين.'), true);
  assert.equal(flag('بلغ مجموعها 1501.51 دولار أمريكي، وحقق 857 ألف مشاهدة.'), false);
  // ages too: Eddie Osbourne «عن عمر يناهز ثلاثة وأربعين عاما» (INCIDENTS #194)
  assert.equal(flag('توفي عن عمر يناهز ثلاثة وأربعين عاما.'), true);
  assert.equal(flag('توفي عن عمر يناهز 43 عاما بعد عشرين عاما في الحلبات.'), true);
  assert.equal(flag('توفي عن عمر يناهز 43 عاما.'), false);
  const { isJunkTag } = await import('../scripts/news-qa');
  assert.equal(isJunkTag('اتحاد INDIE'), true);
  assert.equal(isJunkTag('Maple Leaf Pro'), false);
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /المبالغ والأعمار والسنين والأرقام الكبيرة تتكتب \*\*بالأرقام\*\*/);
});

test('an English title name cut in half by «بطولة السيدات» is put back together (INCIDENTS #189)', async () => {
  const { repairMixedTitles, autoFix } = await import('../scripts/news-qa');
  assert.equal(repairMixedTitles('(NWA World بطولة السيدات TV Championship)'), "(NWA World Women's TV Championship)");
  assert.equal(repairMixedTitles('(NXT بطولة السيدات North American Championship)'), "(NXT Women's North American Championship)");
  assert.equal(repairMixedTitles('لقب بطولة السيدات C4 Championship)'), "لقب C4 Women's Championship)");
  assert.equal(repairMixedTitles('(بطولة السيدات US Championship)'), "(Women's US Championship)");
  assert.equal(repairMixedTitles('(إيفولفبطولة السيدات)'), "(WWE EVOLVE Women's Championship)");
  assert.equal(repairMixedTitles('(بطولة العالم للسيدات Tag Team Championship)'), '(بطولة العالم للفرق النسائية)');
  // ordinary Arabic is left alone
  assert.equal(repairMixedTitles('تتويجها بلقب بطولة السيدات في عرض'), 'تتويجها بلقب بطولة السيدات في عرض');
  assert.match(autoFix('على لقب (NXT بطولة السيدات North American Championship) الليلة'), /NXT Women's North American Championship/);
});

test('Travis Williams is spelled ترافيس, never ترايفس (INCIDENTS #193)', () => {
  assert.equal(applyCorrections('ثنائي جوداس إيكاروس وترايفس ويليامز'), 'ثنائي جوداس إيكاروس وترافيس ويليامز');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Travis Williams'], 'ترافيس ويليامز');
});

test('a word cut after «الأ» is joined back; Conrad Thompson and two grammar slips are corrected (INCIDENTS #195)', () => {
  assert.equal(autoFix('لعدم مرورها بالأ اتحادات المستقلة'), 'لعدم مرورها بالاتحادات المستقلة');
  assert.equal(autoFix('الأ ألعاب'), 'الأ ألعاب');
  assert.equal(applyCorrections('أشار كونراد طومسون'), 'أشار كونراد تومسون');
  assert.equal(applyCorrections('أدى إلى عدة سقوط وإصابات'), 'أدى إلى عدة سقطات وإصابات');
  assert.equal(applyCorrections('التمهيد لعودة المرتقبة لنايومي'), 'التمهيد للعودة المرتقبة لنايومي');
});

test('EVOLVE names the writer swapped for look-alikes are in the glossary; «Impact» as a plain word is flagged (INCIDENTS #196)', async () => {
  const hint = buildNamesGlossaryHint("Thatcher announced Laynie Luck vs. Vanta The Unknown. Harley Riggins def. It's Gal");
  assert.match(hint, /Laynie Luck = لايني لاك/); assert.match(hint, /Vanta The Unknown = فانتا ذا أنون/); assert.match(hint, /It's Gal = إتس غال/);
  assert.equal(applyCorrections('نزال لايني لوك'), 'نزال لايني لاك');
  const { checkArticle } = await import('../scripts/news-qa');
  const jargon = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b, []).some(i => i.code === 'english_jargon');
  assert.equal(jargon('قطع الشاشة لإخفاء Impact الحقيقي للحظة.'), true);
  assert.equal(jargon('يقام عرض Impact الليلة في تكساس.'), false);
});

test('a result placed in a past month is not held as recent (INCIDENTS #197)', async () => {
  const { settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const now = Date.parse('2026-10-01T13:13:00Z');
  const v = { spoils: true, kind: 'result', age: 'recent', note: '' } as any;
  const lola = 'لولا فايس تتذكر فوزها ببطولة NXT للسيدات عندما انتزعت الحزام من جايسي جاين في عرض Stand & Deliver شهر أبريل الماضي';
  assert.equal(settleSpoilerAge(v, lola, [], now, [], []).spoils, false);
  // yesterday's month still counts: «سبتمبر» on 1 October
  assert.equal(settleSpoilerAge(v, 'فاز في عرض سبتمبر الكبير', [], now, [], []).spoils, true);
  // no month at all: the model's verdict stands
  assert.equal(settleSpoilerAge(v, 'فاز باللقب في العرض', [], now, [], []).spoils, true);
  assert.equal(settleSpoilerAge(v, 'He May Have Won The Title فاز باللقب', [], now, [], []).spoils, true);
  assert.equal(settleSpoilerAge(v, 'Won The Title At Stand & Deliver In April', [], now, [], []).spoils, false);
});

test('Dynamite Kid stays a wrestler; a weekday that is not the date is flagged (INCIDENTS #198)', async () => {
  assert.equal(sanitizeWrestlingTerms('بريتيش بولدوج، ديناميت كيد'), 'بريتيش بولدوج، داينامايت كيد');
  assert.equal(applyCorrections('بريتيش بولدوج وداينامايت كيد'), 'بريتيش بولدوج وداينامايت كيد');
  assert.equal(applyCorrections('عرض داينامايت الليلة'), 'عرض AEW Dynamite الليلة');
  assert.equal(sanitizeWrestlingTerms('في عرض ديناميت الليلة'), 'في عرض AEW Dynamite الليلة');
  const { checkArticle, weekdayNotOnDate } = await import('../scripts/news-qa');
  assert.ok(!checkArticle('عنوان عربي كامل للخبر هنا', 'تضم القائمة بريتيش بولدوج وداينامايت كيد في اللعبة الجديدة.', []).some(i => i.code === 'transliterated_show'));
  assert.equal(weekdayNotOnDate('أقيم يوم الثلاثاء الثلاثين من سبتمبر', 2026), 'الثلاثاء الثلاثين من سبتمبر');
  assert.equal(weekdayNotOnDate('أقيم يوم الأربعاء الثلاثين من سبتمبر', 2026), null);
  assert.equal(weekdayNotOnDate('يوم السبت 26 سبتمبر 2026', 2026), null);
  assert.equal(weekdayNotOnDate('يوم الجمعة 26 سبتمبر 2026', 2026), 'الجمعة 26 سبتمبر 2026');
});

test('reported speech stays in the third person: «شعر بداخلي» (INCIDENTS #199)', () => {
  assert.equal(applyCorrections('وأضاف أنه شعر بداخلي بأن تلك الليلة'), 'وأضاف أنه شعر في داخله بأن تلك الليلة');
});

test('Arabic redirect paths are written percent-encoded, the way Pages matches them (INCIDENTS #200)', () => {
  const out = toPagesRedirects('/news/قديم/ /news/جديد/ 301\n/admin/%E2%80%8E /admin/ 301', '_site');
  assert.match(out, /^\/news\/%D9%82%D8%AF%D9%8A%D9%85\/ \/news\/%D8%AC%D8%AF%D9%8A%D8%AF\/ 301$/m);
  assert.match(out, /^\/admin\/%E2%80%8E \/admin\/ 301$/m);
  assert.ok(!/[\u0600-\u06FF]/.test(out));
  const long = 'ا'.repeat(100); // 200 bytes: a real folder name on Linux, still over 1,000 characters encoded
  const tooLong: [string, string][] = [];
  assert.equal(toPagesRedirects(`/news/${long}/ /news/${long}ب/ 301`, '_site', [], tooLong).trim(), '', 'a rule over 1,000 characters is left out, not sent to Pages');
  assert.deepEqual(tooLong, [[`/news/${long}/`, `/news/${long}ب/`]]);
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
  assert.equal(writeRedirectPages(tooLong, site), 1);
  const page = fs.readFileSync(path.join(site, 'news', long, 'index.html'), 'utf8');
  assert.match(page, /http-equiv="refresh" content="0;url=\/news\//); assert.match(page, /rel="canonical"/);
  assert.equal(writeRedirectPages([[`/news/${'ا'.repeat(200)}/`, '/news/x/']], site), 0, 'a folder name over 255 bytes is skipped, not a build failure');
});

test('«الأربعين عاما» is an age in words too; two broken phrases are corrected (INCIDENTS #201)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const flag = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b, []).some(i => i.code === 'spelled_number');
  assert.equal(flag('رحل عن عالمنا عن عمر يناهز الأربعين عاما.'), true);
  assert.equal(flag('أقيم يوم الثلاثين من سبتمبر.'), false);
  assert.equal(applyCorrections('العرض الذي أقامة اتحاد AEW'), 'العرض الذي أقامه اتحاد AEW');
  assert.equal(applyCorrections('كلمات النجوم الذين متذكرا خصاله'), 'كلمات النجوم الذين تذكروا خصاله');
});

test('ages written out in the body become digits before publishing; titles keep words (INCIDENTS #202)', async () => {
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('المصارع البالغ من العمر سبعين عاما'), 'المصارع البالغ من العمر 70 عاما');
  assert.equal(spelledAgesToDigits('عن عمر يناهز ثلاثة وأربعين عاما'), 'عن عمر يناهز 43 عاما');
  assert.equal(spelledAgesToDigits('عن عمر يناهز الأربعين عاما'), 'عن عمر يناهز 40 عاما');
  assert.equal(spelledAgesToDigits('أقيم يوم الثلاثين من سبتمبر'), 'أقيم يوم الثلاثين من سبتمبر');
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /body: spelledAgesToDigits\(fixText\(draft\.body\)\)/);
});

test('the writer is told «make the show» means taking part, not staging it (INCIDENTS #203)', () => {
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /«make it to \/ make the show \/ make \[event\]» معناها «يلحق بـ \/ يشارك في \/ يحضر»/);
});

test('news about a return still to come is not a return spoiler (INCIDENTS #204)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('آخر التطورات حول عودة نايومي إلى WWE', ''), false);
  assert.equal(isSingleMatchSpoiler('تقارير جديدة بشأن عودة رومان رينز', ''), false);
  assert.equal(isSingleMatchSpoiler('نايومي تعود في عرض WWE RAW', ''), true);
});

test('«fans don\'t often get to see» is «نادرا ما تشاهدها الجماهير», not «لم تهتم» (INCIDENTS #205)', () => {
  assert.equal(applyCorrections('قواعد لم تهتم الجماهير برؤيتها كثيرا'), 'قواعد نادرا ما تشاهدها الجماهير كثيرا');
});

test('Fatal Influence has one spelling; «نزال» takes a masculine verb (INCIDENTS #206)', () => {
  assert.equal(applyCorrections('تدخلت لمساعدة فاتال إنفلونس'), 'تدخلت لمساعدة فايتال إنفلوينس');
  assert.equal(applyCorrections('تصدرت نزال ثلاثي القائمة'), 'تصدر نزال ثلاثي القائمة');
});

test('the writer keeps each roundup line\'s doer and meaning (INCIDENTS #208)', () => {
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /الموجزات \(«Fight Size» وأمثالها/);
});

test('a curly apostrophe in the source still finds the glossary name; Tony D\'Angelo has one spelling (INCIDENTS #209)', () => {
  assert.match(buildNamesGlossaryHint('Tony D’Angelo Addresses Potential WWE Main Roster Call-Up'), /Tony D'Angelo = توني دي أنجيلو/);
  assert.equal(applyCorrections('أكد توني دانجلو أن'), 'أكد توني دي أنجيلو أن');
  assert.equal(applyCorrections('أشار دانجلو إلى'), 'أشار دي أنجيلو إلى');
});

test('«Flash» Morgan Webster is one wrestler, not «مورغان و بستر» (INCIDENTS #210)', () => {
  assert.match(buildNamesGlossaryHint("Subculture ('Flash' Morgan Webster & Mark Andrews) def. The Natural Classics"), /Morgan Webster = (?:فلاش )?مورغان ويبستر/);
  assert.equal(applyCorrections('(«فلاش» مورغان وبستر ومارك أندروز)'), '(«فلاش» مورغان ويبستر ومارك أندروز)');
  assert.equal(applyCorrections('بعد أيام قليلة إبدائه تفاؤله'), 'بعد أيام قليلة من إبدائه تفاؤله');
});

test('Goldberg has the glossary spelling (INCIDENTS #211)', () => {
  assert.equal(applyCorrections('بيل غولدبيرغ وابنه'), 'بيل غولدبيرج وابنه');
});

test('«عند عودته» is a return still to come, not a spoiler (INCIDENTS #212)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('كشف برونسون ريد أن تحوله الجسدي لم يكن لمجرد الظهور بشكل أفضل عند عودته إلى عروض WWE', ''), false);
  assert.equal(isSingleMatchSpoiler('برونسون ريد يعود في عرض WWE RAW', ''), true);
});

test('«يتجادبان» is a typo for «يتجادلان» (INCIDENTS #213)', () => {
  assert.equal(applyCorrections('ظهر الاثنان يتجادبان عند المدخل'), 'ظهر الاثنان يتجادلان عند المدخل');
});

test('«أوسبريب» is Ospreay (INCIDENTS #214)', () => {
  assert.equal(applyCorrections('ضد النجم ويل أوسبريب، في خطوة'), 'ضد النجم ويل أوسبراي، في خطوة');
});

test('betting odds before a card are a preview, not a result (INCIDENTS #216)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('الكشف عن ترشيحات ونسب الفوز لمواجهات UFC 332 بين سيلفا وكونغ بدعم من MyBookie', ''), false);
  assert.equal(isSingleMatchSpoiler('ناتاليا سيلفا تحقق الفوز على وانغ كونغ في UFC 332', ''), true);
});

test('«put him over» is losing to him, written plainly (INCIDENTS #217)', () => {
  assert.equal(applyCorrections('منحه الأفضلية وخسره نزالا نظيفا'), 'منحه الأفضلية وخسر أمامه نزالا نظيفا');
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /«put \[someone\] over» معناها/);
});

test('«AAA Mega Champion» and «Reina de Reinas Champion» have their glossary names (INCIDENTS #218)', () => {
  const hint = buildNamesGlossaryHint('AAA Mega Champion El Grande Americano, Reina de Reinas Champion La Catalina');
  assert.match(hint, /AAA Mega Champion = بطل AAA ميغا/); assert.match(hint, /Reina de Reinas Champion = بطلة ملكة الملكات/);
  assert.equal(applyCorrections('بطل AAA للوزن الثقيل إل غراندي أمريكانو'), 'بطل AAA ميغا إل غراندي أمريكانو');
});

test('«old» without any evidence in the text is not trusted (INCIDENTS #219)', async () => {
  const { settleSpoilerAge, hasOldEvidence } = await import('../scripts/fightful-watcher');
  const now = Date.parse('2026-10-02T02:00:00Z');
  const v = { spoils: false, kind: 'none', age: 'old', note: '' } as any;
  const chantel = 'شانتل مونرو تعود إلى الحلبة شهد عرض WWE Main Event عودة المصارعة شانتل مونرو إلى الحلبة في مواجهة جمعتها مع ماكسين دوبري';
  assert.notEqual(settleSpoilerAge(v, chantel, [], now, [], []).age, 'old');
  assert.equal(hasOldEvidence('فاز باللقب في أبريل الماضي', now), true);
  assert.equal(hasOldEvidence('عاد في عام 2021 إلى الحلبة', now), true);
  assert.equal(hasOldEvidence('عاد إلى الحلبة الليلة', now), false);
  assert.equal(settleSpoilerAge(v, 'عاد في عام 2021 إلى الحلبة', [], now, [], []).age, 'old');
});

test('Agent Zero and Jessie McKay have one spelling (INCIDENTS #220)', () => {
  assert.equal(applyCorrections('أمرت تاشا ستيلز أجينت زيرو و إيغنت زيرو'), 'أمرت تاشا ستيلز إيجنت زيرو و إيجنت زيرو');
  assert.equal(applyCorrections('برفقة جيسي ماكي'), 'برفقة جيسي مكاي');
  assert.match(buildNamesGlossaryHint('Agent Zero and Jessie McKay'), /Agent Zero = إيجنت زيرو/);
});

test('a results report writes every name its source names — no swapped Robbie (INCIDENTS #343)', async () => {
  const { sourceNamesMissing } = await import('../scripts/fightful-watcher');
  const src = 'TMDK (Kosei Fujita, Robbie Eagles & Hartley Jackson) def. Aaron Wolf. IWGP Junior Heavyweight Championship: YOH (c) def. Robbie X to retain the title.';
  assert.equal(sourceNamesMissing(src, 'تغلب روبي إيغلز. دافع يوه عن لقبه ضد روبي إيغلز.').includes('Robbie X'), true);
  assert.equal(sourceNamesMissing(src, 'تغلب روبي إيغلز. دافع يوه عن لقبه ضد روبي إكس.').includes('Robbie X'), false);
  assert.equal(sourceNamesMissing(src, 'تغلب روبي إيغلز.').includes('Robbie Eagles'), false);
});

test('a results report lists every source result; a match heading never carries the outcome (INCIDENTS #221)', async () => {
  const { missingResults } = await import('../scripts/fightful-watcher');
  const src = 'Results below. BDE def. Mr Elegance Leon Slater def. Joe Alonzo Cedric Alexander def. Ricky Sosa';
  assert.equal(missingResults(src, '🏆 **الفائز:** BDE\n🏆 **الفائز:** ليون سلاتر').length, 3);
  assert.equal(missingResults(src, '🏆 **الفائز:** BDE\n🏆 **الفائز:** ليون سلاتر\n🏆 **الفائز:** سيدريك ألكسندر').length, 0);
  assert.equal(autoFix('**المواجهة الأولى: نزال تصفيات على بطولة X Division: BDE ينهزم أمام Mr Elegance**'), '**المواجهة الأولى: نزال تصفيات على بطولة X Division**');
  assert.equal(autoFix('**المواجهة الثانية: نزال فردي**'), '**المواجهة الثانية: نزال فردي**');
  assert.equal(applyCorrections('مصطفى علي وسبشال أجنت زيرو'), 'مصطفى علي وإيجنت زيرو');
});

test('Main Event names and «bittersweet» / «Scramble» are corrected (INCIDENTS #222)', () => {
  assert.equal(applyCorrections('تغلب كيويكي على أكسيوم وتغلب أوتيس على ناروكو'), 'تغلب كيوكي على أكسيوم وتغلب أوتيس على ناراكو');
  assert.equal(applyCorrections('عودته الحلوة والمررة'), 'عودته الحلوة والمرة');
  assert.equal(applyCorrections('شانتيل مونرو'), 'شانتل مونرو');
});

test('a weekly show past the window makes the story old even when the model said «not a spoiler, recent»; old releases a hold (INCIDENTS #223)', async () => {
  const { settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const { stillSpoiler } = await import('../worker/src/index');
  const v = { spoils: false, kind: 'none', age: 'recent', note: '' } as any;
  const text = 'واردلو يتحدث عن عودته الحلوة والمرة إلى الحلبات في عرض AEW Dynamite';
  assert.equal(settleSpoilerAge(v, text, [], Date.parse('2026-10-02T03:00:00Z'), ['aew dynamite'], [], ['aew dynamite']).age, 'old');
  // last week's Dynamite says nothing about a special that just aired on another night (INCIDENTS #317)
  const paris = { spoils: true, kind: 'result', age: 'recent', note: '' } as any;
  const mone = 'مرسيدس موني تحتفظ ببطولة AEW العالمية للسيدات في عرض AEW Dynamite: Grand Slam Paris';
  const out = settleSpoilerAge(paris, mone, [], Date.parse('2026-10-07T01:40:00Z'), ['aew dynamite'], [], []);
  assert.equal(out.spoils, true); assert.notEqual(out.age, 'old');
  assert.equal(stillSpoiler({ why: 'title', title: mone }, { social_spoiler: true, title: mone }), true);
  assert.equal(stillSpoiler({ why: 'title', title: text }, { social_spoiler: false, social_spoiler_age: 'old', title: text }), false);
  assert.equal(stillSpoiler({ why: 'title', title: text }, { social_spoiler: false, social_spoiler_age: 'recent', title: text }), true);
  assert.equal(applyCorrections('لشريكتها في فريق التناوب آلي'), 'لشريكتها في الفريق آلي');
});

test('«تصفيي» is «تأهيلي» (INCIDENTS #224)', () => {
  assert.equal(applyCorrections('في نزال تصفيي ثلاثي'), 'في نزال تأهيلي ثلاثي');
});

test('round hundreds before a unit become digits in the body (INCIDENTS #225)', async () => {
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('بالابتعاد مسافة لا تقل عن خمسمائة قدم عنها'), 'بالابتعاد مسافة لا تقل عن 500 قدم عنها');
  assert.equal(spelledAgesToDigits('خمسمائة مشجع حضروا'), '500 مشجع حضروا');
});

test('a closing «هل تعتقد…?» reader question is dropped; three slips corrected (INCIDENTS #226)', () => {
  assert.equal(autoFix('خبر كامل هنا.\nوهل تعتقد أن كيز وجد مكانه الصحيح في عروض WWE?'), 'خبر كامل هنا.');
  assert.equal(autoFix('هل تعتقد الإدارة أن الوقت مناسب؟ قالها في المقابلة وتابع حديثه.\nسطر آخر.'), 'هل تعتقد الإدارة أن الوقت مناسب؟ قالها في المقابلة وتابع حديثه.\nسطر آخر.');
  assert.equal(applyCorrections('المحارب السكتلندي في برنامج بودست'), 'المحارب الاسكتلندي في برنامج بودكاست');
});

test('a tag «عرض WWE SmackDown» is the tag «WWE SmackDown» (INCIDENTS #227)', async () => {
  const { canonicalTags } = await import('../scripts/fightful-watcher');
  assert.deepEqual(canonicalTags(['WWE', 'عرض WWE SmackDown', 'WWE SmackDown', 'نيكي بيلا'], new Map()), ['WWE', 'WWE SmackDown', 'نيكي بيلا']);
});

test('talking about a past return is not a return spoiler (INCIDENTS #228)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('نيكي بيلا تقول إن التغيرات المستمرة في الشخصية جعلت عودتها إلى WWE أكثر صعوبة', ''), false);
  assert.equal(isSingleMatchSpoiler('ميكي جيمز تكشف تفاصيل عودتها إلى TNA', ''), false);
  assert.equal(isSingleMatchSpoiler('نيكي بيلا تعود إلى WWE في عرض RAW', ''), true);
});

test('«ال» written twice before a noun is undone; real «الال…» words stay (INCIDENTS #229)', () => {
  assert.equal(autoFix('والالثنائي سيخوض مواجهة ثلاثية'), 'والثنائي سيخوض مواجهة ثلاثية');
  assert.equal(autoFix('أكد الالتزام بالقرار'), 'أكد الالتزام بالقرار');
});

test('Stephanie McMahon in a title becomes her full tag, not «ستيفاني» (INCIDENTS #231)', async () => {
  const { titleNamesAsTags, dropPartialNameTags } = await import('../scripts/fightful-watcher');
  assert.deepEqual(dropPartialNameTags(titleNamesAsTags('ستيفاني مكمان تكشف القصة الكاملة لطلب تريبل إتش الزواج منها', ['WWE', 'ستيفاني', 'تريبل إتش'])).filter(t => t.startsWith('ستيفاني')), ['ستيفاني مكمان']);
});

test('The Bloodline and The Shield are written in Arabic like the glossary (INCIDENTS #232)', () => {
  assert.equal(applyCorrections('قصة فريق The Bloodline وذكريات فريق The Shield'), 'قصة فريق ذا بلودلاين وذكريات فريق ذا شيلد');
});

test('a name led into by an English word stays English (show and podcast titles) (INCIDENTS #234)', async () => {
  const { applyNamesGlossary } = await import('../scripts/fightful-watcher');
  assert.equal(applyNamesGlossary('سلسلة Being The Elite كانت مهمة'), 'سلسلة Being The Elite كانت مهمة');
  assert.equal(applyNamesGlossary('بودكاست The Extreme Life of Matt Hardy'), 'بودكاست The Extreme Life of Matt Hardy');
  assert.equal(applyNamesGlossary('أكد Matt Hardy أن'), 'أكد مات هاردي أن');
  assert.equal(applyNamesGlossary('نجم TNA Matt Hardy'), 'نجم TNA مات هاردي');
});

test('Arn Anderson has one spelling (INCIDENTS #236)', () => {
  assert.equal(applyCorrections('تيري تايلور وسترن أندرسون'), 'تيري تايلور وآرن أندرسون');
  assert.equal(applyCorrections('أرن أندرسون'), 'آرن أندرسون');
});

test('the health check finds a renamed story by its file, like the poster does (INCIDENTS #237)', async () => {
  const { stuckOnSocial } = await import('../worker/src/health');
  const now = Date.now();
  const items = [{ url: '/news/new-title/', file: 'f1', title: 'خبر', published_at: new Date(now - 2 * 3600_000).toISOString() }];
  const state = { telegram: { old: now }, facebook: { old: now }, instagram: { old: now }, held: {}, byFile: { f1: 'old' } };
  assert.deepEqual(stuckOnSocial(items, state, (it: any) => it.url.split('/')[2], now, () => true, (it: any) => it.file), []);
  assert.equal(stuckOnSocial(items, state, (it: any) => it.url.split('/')[2], now).length, 1);
});

test('not needing another win is not a result (INCIDENTS #237)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('كريس جيريكو يؤكد أنه لا يحتاج لتحقيق أي انتصار آخر في AEW', ''), false);
  assert.equal(isSingleMatchSpoiler('كريس جيريكو يحقق انتصارا على ريكوشيه في AEW', ''), true);
});

test('round thousands before a unit become digits too (INCIDENTS #238)', async () => {
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('ليصل إلى أكثر من ألفي تذكرة'), 'ليصل إلى أكثر من 2000 تذكرة');
  assert.equal(spelledAgesToDigits('حضر ألف مشجع'), 'حضر 1000 مشجع');
});

test('a nearing return is not a spoiler; an ordinal age becomes digits (INCIDENTS #239)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('تحديثات الكواليس حول عودة درو ماكنتاير المرتقبة إلى WWE', ''), false);
  assert.equal(isSingleMatchSpoiler('تشير التقارير الصحفية الأخيرة إلى قرب عودته إلى شاشات العرض', ''), false);
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('مشيرا إلى أنه سيكون في الثالثة والأربعين من عمره عند انتهاء العقد'), 'مشيرا إلى أنه سيكون في الـ43 من عمره عند انتهاء العقد');
});

test('«إلى متبقي» and «الإلتي كور» are corrected (INCIDENTS #240)', () => {
  assert.equal(applyCorrections('أشار إلى متبقي ثلاثة أعوام'), 'أشار إلى تبقي ثلاثة أعوام');
  assert.equal(applyCorrections('فرقة الإلتي كور'), 'فرقة الميتالكور');
});

test('«free agency» is «سوق المصارعين الأحرار» (INCIDENTS #241)', () => {
  assert.equal(applyCorrections('أكد دخوله عالم المصارع الحر'), 'أكد دخوله سوق المصارعين الأحرار');
});

test('a promotion coming back is not a return spoiler; «بقضاء وقتا» corrected (INCIDENTS #242)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('عودة اتحاد Southern Underground Pro في شهر نوفمبر وأبرز محطات عرض TNA iMPACT', ''), false);
  assert.equal(applyCorrections('سعادتها بقضاء وقتا أطول'), 'سعادتها بقضاء وقت أطول');
});

test('MLW Fusion is a known weekly show, so a day-old Fusion moment is old (INCIDENTS #243)', async () => {
  const { settleSpoilerAge } = await import('../scripts/fightful-watcher');
  const v = { spoils: true, kind: 'show', age: 'recent', note: '' } as any;
  assert.equal(settleSpoilerAge(v, 'عرض MLW Fusion يشهد عرض مقطع تمهيدي للمصارع يوتا تسوجي', [], Date.parse('2026-10-02T20:40:00Z'), ['mlw fusion'], [], ['mlw fusion']).spoils, false);
  assert.equal(applyCorrections('حسمها لصوحه'), 'حسمها لصالحه');
});

test('a spelled thousand after a number is left alone: «899 ألف مشاهد» (INCIDENTS #244)', async () => {
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('استقطب 899 ألف مشاهد'), 'استقطب 899 ألف مشاهد');
  assert.equal(spelledAgesToDigits('بلغت 5 مئة دولار'), 'بلغت 5 مئة دولار');
  assert.equal(spelledAgesToDigits('أكثر من ألفي تذكرة'), 'أكثر من 2000 تذكرة');
});

test('a prediction is not a result (INCIDENTS #246)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('بولي راي يتكهن بتحالف ال ايه نايت مع 946 وهزيمة رومان رينز في عرض WWE موني إن ذا بانك', ''), false);
  assert.equal(isSingleMatchSpoiler('ال ايه نايت يهزم رومان رينز في عرض WWE موني إن ذا بانك', ''), true);
  // INCIDENTS #276
  assert.equal(isSingleMatchSpoiler('جون سينا يناقش إمكانية فوز ال ايه نايت على رومان رينز في عرض WWE موني إن ذا بانك', ''), false);
  assert.equal(isSingleMatchSpoiler('فوز ال ايه نايت على رومان رينز في عرض WWE موني إن ذا بانك', ''), true);
  // INCIDENTS #277
  assert.equal(isSingleMatchSpoiler('شهد أسبوع آخر مليئا بالأحداث في عالم المصارعة الحرة، حيث يستعرض فريق العمل أبرز الرابحين والخاسرين لهذا الأسبوع في ظل الظروف العاطفية التي أعقبت رحيل النجم باك، مع إقامة عروض تكريمية مؤثرة وعودة أسماء بارزة إلى الحلبات.', ''), false);
  assert.equal(isSingleMatchSpoiler('عودة راندي أورتن في عرض WWE RAW', ''), true);
  // INCIDENTS #323
  assert.equal(isSingleMatchSpoiler('جي بي إل يعتقد أن مالاكاي بلاك يحرق جسور العودة إلى WWE', ''), false);
  assert.equal(isSingleMatchSpoiler('مالاكاي بلاك يغلق باب العودة إلى WWE', ''), false);
  assert.equal(isSingleMatchSpoiler('مالاكاي بلاك يعود إلى WWE في عرض RAW', ''), true);
  // INCIDENTS #278
  assert.equal(isSingleMatchSpoiler('جيم روس يخضع لجراحة ثانية في الدماغ لعلاج مشكلة في التحويلة', ''), false);
  assert.equal(isSingleMatchSpoiler('سيث رولينز يخضع لعملية جراحية في الركبة', ''), false);
  assert.equal(isSingleMatchSpoiler('غونتر يخضع كودي رودز في عرض WWE RAW', ''), true);
});

test('«AAA World Cruiserweight Champion» has a glossary name (INCIDENTS #248)', () => {
  assert.match(buildNamesGlossaryHint('Fraxiom and AAA World Cruiserweight Champion Rey Fénix'), /AAA World Cruiserweight Champion = بطل الكروزرويت العالمي في AAA/);
  assert.equal(applyCorrections('وبطل العالم لوزن المتوسط في اتحاد AAA ري فينيكس'), 'وبطل الكروزرويت العالمي في AAA ري فينيكس');
});

test('a results report title takes the show date from the source, not the UTC day (INCIDENTS #249)', async () => {
  const { alignTitleDateToSource } = await import('../scripts/fightful-watcher');
  const t = 'نتائج عرض WWE SmackDown (3 أكتوبر 2026): تيفاني ستراتون تخطف بطاقة التأهل';
  assert.equal(alignTitleDateToSource(t, 'https://www.ringsidenews.com/wwe-smackdown-results-highlights-key-moments-october-2-2026/'), 'نتائج عرض WWE SmackDown (2 أكتوبر 2026): تيفاني ستراتون تخطف بطاقة التأهل');
  assert.equal(alignTitleDateToSource('نتائج عرض TNA iMPACT (2 أكتوبر 2026): X', 'TNA iMPACT! Results (10/1): Syx To Speak'), 'نتائج عرض TNA iMPACT (1 أكتوبر 2026): X');
  assert.equal(alignTitleDateToSource(t, 'no date here'), t);
});

test('an editor note left in parentheses is removed (INCIDENTS #251)', () => {
  assert.equal(autoFix('تحدث فينلي عن قراره (المصدر يشير إلى أنه اختار AEW بدلا من WWE NXT، وليس أنه انتقل فعليا من مكان لآخر)، وذلك خلال ظهوره.'), 'تحدث فينلي عن قراره، وذلك خلال ظهوره.');
  assert.equal(autoFix('فاز فريق ذا دوجز (كلارك كونورز وجيب كيد) بالنزال.'), 'فاز فريق ذا دوجز (كلارك كونورز وجيب كيد) بالنزال.');
});

test('a «(مع تصحيح …)» note left in the text is removed (INCIDENTS #321)', () => {
  assert.equal(autoFix('فاز تايران تاكي على بروكس جينسن (مع تصحيح اسم المصارع إلى تايران تاكي)، حيث تم تقديمه.'), 'فاز تايران تاكي على بروكس جينسن، حيث تم تقديمه.');
  assert.equal(autoFix('حقق الفوز (بعد تعديل الاسم) في النزال.'), 'حقق الفوز في النزال.');
});

test('a return announced for tonight show is a card, not a spoiler (INCIDENTS #253)', async () => {
  const { isSingleMatchSpoiler } = await import('../worker/src/index');
  assert.equal(isSingleMatchSpoiler('كوفي يواجه لي موريارتي وجوليا هارت تعود للحلبة ضمن عرض AEW Collision الليلة', ''), false);
  assert.equal(isSingleMatchSpoiler('جوليا هارت تعود إلى الحلبة في عرض AEW Collision', ''), true);
});

test('an echoed instruction about quote marks is removed and flagged (INCIDENTS #254)', async () => {
  assert.equal(autoFix('خلال إضافة علامات التنصيص وعلامة الاستفهام كما في المصدر، استرجع شيفاني ذكريات النزال.'), 'استرجع شيفاني ذكريات النزال.');
  const { checkArticle } = await import('../scripts/news-qa');
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'نص فيه كما في المصدر بالضبط ويكمل الكلام هنا بشكل عادي وطويل.', []).some(i => i.code === 'echoed_instruction'));
});

test('filler «تخوض خطواتها القادمة» instead of a sourced fact is flagged (INCIDENTS #293)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'يذكر أن الثنائي رحل عن الاتحاد، حيث تخوض داكوتا كاي خطواتها القادمة بينما يعود هو تدريجيا.', []).some(i => i.code === 'vague_filler'));
  assert.ok(!checkArticle('عنوان عربي كامل للخبر هنا', 'خاضت داكوتا كاي آخر نزالاتها في أبريل الماضي وهي تفكر في الخطوة القادمة بهدوء.', []).some(i => i.code === 'vague_filler'));
});

test('scrubbed reporter left as «تقارير صحفية أنه تحرى» is flagged (INCIDENTS #333)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'وخلال جلسة أسئلة وأجوبة، أكدت تقارير صحفية مطلعة أنه تحرى عن وضع هوليداي ليخلص إلى أن الانتقال لن يحدث.', []).some(i => i.code === 'scrubbed_reporter_pronoun'));
  assert.ok(!checkArticle('عنوان عربي كامل للخبر هنا', 'وبحسب تقارير صحفية مطلعة، فإن انتقال هوليداي إلى WWE لن يحدث في الوقت الحالي.', []).some(i => i.code === 'scrubbed_reporter_pronoun'));
});

test('an all-caps English film title is not half-transliterated (INCIDENTS #339)', () => {
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'تسلط الضوء عليها في فيلم وثائقي جديد بعنوان I FOUGHT جون موكسلي والمقرر طرحه قريبا.', []).some(i => i.code === 'mixed_caps_title'));
  assert.ok(!checkArticle('عنوان عربي كامل للخبر هنا', 'فيلم وثائقي جديد بعنوان «I FOUGHT JON MOXLEY» والمقرر طرحه قريبا في عرض WWE RAW الأخير.', []).some(i => i.code === 'mixed_caps_title'));
  assert.equal(applyCorrections('فيلم وثائقي جديد بعنوان I FOUGHT جون موكسلي والمقرر'), 'فيلم وثائقي جديد بعنوان «I FOUGHT JON MOXLEY» والمقرر');
});

test('Buff Bagwell story: «كانت لتمثله» and the Scotty Riggs name (INCIDENTS #340)', () => {
  assert.equal(applyCorrections('مشددا على أن تلك المرحلة كانت لتمثله فرصة مثالية'), 'مشددا على أن تلك المرحلة كانت ستمثل له فرصة مثالية');
  assert.match(buildNamesGlossaryHint('Buff Bagwell and Scotty Riggs faced Rick Steiner'), /Scotty Riggs = سكوتي ريغز/);
});

test('«move through space as a human being» is not outer space (INCIDENTS #341)', () => {
  assert.equal(applyCorrections('كان له تأثير كبير على طريقة تحركي في الفضاء كإنسان'), 'كان له تأثير كبير على طريقة تعاملي مع العالم من حولي كإنسان');
});

test('Madusa story: Lone Pine, Blackwater and the three-time title (INCIDENTS #342)', () => {
  assert.equal(applyCorrections('شركة لونه باين برودكشنز إلى نزل بليكووتر'), 'شركة لون باين برودكشنز إلى نزل بلاك ووتر');
  assert.match(buildNamesGlossaryHint('Madusa, the former Alundra Blayze'), /Madusa = مادوسا/);
});

test('«الوقت الذي تبلغ فيه»: the pronoun follows the masculine «الوقت» (INCIDENTS #344)', () => {
  assert.equal(applyCorrections('بحلول الوقت الذي تبلغ فيها ابنته الحادية عشرة'), 'بحلول الوقت الذي تبلغ فيه ابنته الحادية عشرة');
});

test('PAC tribute stories: hamza, «التعزية», «واسمه الحقيقي» and who feels unhappy (INCIDENTS #346)', () => {
  assert.equal(applyCorrections('تحمست للقاءهم بشدة'), 'تحمست للقائهم بشدة');
  assert.equal(applyCorrections('لتتوالى رسائل التعبئة والوفاء'), 'لتتوالى رسائل التعزية والوفاء');
  assert.equal(applyCorrections('الراحل باك، المسمى حقيقية بنجامين'), 'الراحل باك، واسمه الحقيقي بنجامين');
  assert.equal(applyCorrections('ذكريات جولاته مع باك الراحل برودي لي'), 'ذكريات جولاته مع باك والراحل برودي لي');
  assert.equal(applyCorrections('إذا شعرت الشركة يوما ما بأنها لا تناسبه'), 'إذا شعر يوما ما بأن الشركة لا تناسبه');
});

test('MJF and Reigns stories: «آراءه», puroresu and Daikin Park is a stadium (INCIDENTS #347)', () => {
  assert.equal(applyCorrections('ولم يخف النجم آرائه السابقة'), 'ولم يخف النجم آراءه السابقة');
  assert.equal(applyCorrections('يسعى لإزعاج جماهير مصارعة البورو على الإنترنت'), 'يسعى لإزعاج جماهير مصارعة البوروريسو اليابانية على الإنترنت');
  assert.equal(applyCorrections('يوم 28 نوفمبر في صالة دايكن بارك بمدينة هيوستن'), 'يوم 28 نوفمبر في ملعب دايكن بارك بمدينة هيوستن');
});

test('Serrano and Bischoff stories: quote brackets in «Lethal Lockdown» and «الأربعينيات» (INCIDENTS #348)', () => {
  assert.equal(applyCorrections('خوض نزال مثل (Lethal) Lockdown الشهير'), 'خوض نزال مثل Lethal Lockdown الشهير');
  assert.equal(applyCorrections('توفي العديد من المصارعين في أوائل أربعينيات من أعمارهم'), 'توفي العديد من المصارعين في أوائل الأربعينيات من أعمارهم');
  assert.equal(applyCorrections('وفاة مصارعين اثنين في سن الاربعين أمر غير طبيعي'), 'وفاة مصارعين اثنين في سن الأربعين أمر غير طبيعي');
});

test('Maclin story: quotes need «», «المصارعة» not «المصارعة الحرة», Bobby Roode in the dictionary (INCIDENTS #349)', () => {
  assert.equal(applyCorrections('شعرت بكل معنى كون المصارعة الحرة فنا قائما بذاته'), 'شعرت بكل معنى أن المصارعة فن قائم بذاته');
  assert.equal(applyCorrections('مشيرا إلى أنه أيقن بنهايتها بأنه ينتمي'), 'مشيرا إلى أنه أيقن مع نهايتها أنه ينتمي إلى هذا المجال');
  const pad = ' وهذا نص إضافي طويل لتجاوز الحد الأدنى لطول الخبر في المدقق الآلي.'.repeat(5);
  const bad = checkArticle('ستيف ماكلين يتحدث عن نزاله مع آدم كوبلاند', 'شارك ماكلين انطباعاته، وأضاف: أنا سعيد بأن لدي هذا المقطع.' + pad);
  assert.ok(bad.some(i => i.code === 'unquoted_quote'));
  const good = checkArticle('ستيف ماكلين يتحدث عن نزاله مع آدم كوبلاند', 'شارك ماكلين انطباعاته، وقال: «أنا سعيد بأن لدي هذا المقطع».' + pad);
  assert.ok(!good.some(i => i.code === 'unquoted_quote'));
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Bobby Roode'], 'بوبي رود');
});

test('Cody and WrestleMania 2029 stories: «مشاحنات», «رسمي», «يُبقي» and one star (INCIDENTS #350)', () => {
  assert.equal(applyCorrections('الدخول في نقاشات ومداعبات مع الجماهير'), 'الدخول في نقاشات ومشاحنات مع الجماهير');
  assert.equal(applyCorrections('ولا يوجد إعلان رسم جاهز للنشر'), 'ولا يوجد إعلان رسمي جاهز للنشر');
  assert.equal(applyCorrections('مما يبقى الأبواب مفتوحة'), 'مما يُبقي الأبواب مفتوحة');
  assert.equal(applyCorrections('الضغوط التي يواجهها كنجوم الصف الأول'), 'الضغوط التي يواجهها بصفته أحد نجوم الصف الأول');
});

test('«بنسخة», «اقترحها», ten-bell salute and Io Shirai persona (INCIDENTS #351)', () => {
  assert.equal(applyCorrections('وتريش ستراتوس بننسخة عام 2000'), 'وتريش ستراتوس بنسخة عام 2000');
  assert.equal(applyCorrections('بفكرة اقتراحها المقدمون بتغييره'), 'بفكرة اقترحها المقدمون بتغييره');
  assert.equal(applyCorrections('فقرة تذكارية، وتحية جرسية في عرض AEW Collision'), 'فقرة تذكارية، وتحية الأجراس العشرة في عرض AEW Collision');
  assert.equal(applyCorrections('مسترجعا خلال ظهوره في بودكاست'), 'مستعرضا خلال ظهوره في بودكاست');
  assert.match(buildNamesGlossaryHint('Persona pack featuring Io Shirai'), /Io Shirai = آيو شيراي/);
});

test('«locking the Forbidden Door» is a metaphor, and Sunil Singh is in the names dictionary (INCIDENTS #334)', () => {
  assert.equal(applyCorrections('على بعد خطوة واحدة من إغلاق عرض Forbidden Door وإنهاء اتحاد NJPW'), 'على بعد خطوة واحدة من إقفال «الباب المحرم» وإنهاء اتحاد NJPW');
  assert.equal(applyCorrections('في عرض Forbidden Door المقبل'), 'في عرض Forbidden Door المقبل');
  assert.match(buildNamesGlossaryHint('Sunil Singh gives update after collapsed lung'), /Sunil Singh = سونيل سينغ/);
});

test('MVP\'s WWE group is the Hurt Business, plus «ألمهحه» and «ووزن الثقيل» (INCIDENTS #336)', () => {
  assert.equal(applyCorrections('جون لورينايتس ألمهحه حينها'), 'جون لورينايتس ألمح له حينها');
  assert.equal(applyCorrections('بطولات العالمية ووزن الثقيل'), 'بطولات العالمية والوزن الثقيل');
  assert.match(applyCorrections('وتشكيل فريق ذا هيرت سنديكيت مع بوبي لاشلي وشيلتون بنجامين وسيدريك ألكسندر'), /ذا هيرت بيزنس/);
  assert.match(buildNamesGlossaryHint('MVP formed The Hurt Business with Cedric Alexander'), /The Hurt Business = ذا هيرت بيزنس/);
  assert.match(buildNamesGlossaryHint('Knockout Brothers (OSKAR & Yuto-Ice) & Jeff Cobb'), /Knockout Brothers = نوكآوت براذرز/);
});

test('Dominik story: imperative «ودع» mid-sentence and «الاصطدام به في عمود الحلبة» (INCIDENTS #337)', () => {
  assert.equal(applyCorrections('لم يتلق أي توجيهات سوى الجلوس ودع ليسنر يقوم بالباقي'), 'لم يتلق أي توجيهات سوى أن يجلس ويترك ليسنر يقوم بالباقي');
  assert.equal(applyCorrections('رميه حول الحلبة والاصطدام به في عمود الحلبة'), 'رميه حول الحلبة وضربه بعمود الحلبة');
});

test('«لم يرى», Dani Mo and «top to bottom» in the JCW women story (INCIDENTS #338)', () => {
  assert.equal(applyCorrections('مشددا على أنه لم يرى من قبل'), 'مشددا على أنه لم ير من قبل');
  assert.equal(applyCorrections('وجي رود، ودانيا مو، وهايلي هود'), 'وجي رود، وداني مو، وهايلي هود');
  assert.match(buildNamesGlossaryHint('Big Al teamed with Dani Mo'), /Dani Mo = داني مو/);
  assert.match(buildNamesGlossaryHint('Choppa City praised the roster'), /Choppa City = تشوبا سيتي/);
});

test('Blake Monroe is «بليك مونرو» (INCIDENTS #255)', () => {
  assert.equal(applyCorrections('نجحت بلاك مونرو في تقديم نزال قوي'), 'نجحت بليك مونرو في تقديم نزال قوي');
  assert.match(buildNamesGlossaryHint('Blake Monroe defeats Giulia'), /Blake Monroe = بليك مونرو/);
});

test('every pinned news permalink has a real slug and no two stories share one (INCIDENTS #256)', () => {
  const dir = path.join(process.cwd(), 'content', 'news');
  const seen = new Map<string, string>();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    let link = fs.readFileSync(path.join(dir, f), 'utf-8').match(/^permalink:\s*"?([^"\n]+)"?\s*$/m)?.[1];
    if (!link) continue;
    assert.match(link, /^\/news\/[^/\s]+\/(?:index\.html)?$/, `${f}: ${link}`);
    link = link.replace(/index\.html$/, '');
    assert.ok(!seen.has(link), `${f} and ${seen.get(link)} both write ${link}`);
    seen.set(link, f);
  }
});

test('CMLL names and a stray «نافت» are corrected (INCIDENTS #257)', () => {
  const out = applyCorrections('مواجهات قوية وحماسية نافت بين نجوم الاتحاد، وفاز دي فونتو وإسفينغي على زيوسيس.');
  assert.equal(out, 'مواجهات قوية وحماسية بين نجوم الاتحاد، وفاز ديفونتو وإسفينخي على زيوكسيس.');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Barboza'], 'باربوزا');
  assert.equal(names['Esfinge'], 'إسفينخي');
});

test('a clause written twice in one paragraph keeps only its first copy (INCIDENTS #258)', () => {
  const line = 'وذلك بعد تتويجه باللقب إثر تغلبه على دومينيك ميستيريو في عرض AAA TripleMania 34 الشهر الماضي، وهذا يأتي بعد تغلبه على دومينيك ميستيريو في عرض AAA TripleMania 34 الشهر الماضي حيث يترقب الجميع ما سيقوله.';
  assert.equal(autoFix(line), 'وذلك بعد تتويجه باللقب إثر تغلبه على دومينيك ميستيريو في عرض AAA TripleMania 34 الشهر الماضي، حيث يترقب الجميع ما سيقوله.');
  const ok = 'فاز كودي رودز على درو ماكنتاير، ثم فاز درو ماكنتاير على جي يوسو.';
  assert.equal(autoFix(ok), ok);
  assert.equal(applyCorrections('بطل أول-أريكان مرتين والانجازات'), 'بطل أول أمريكان مرتين والإنجازات');
});

test('«الانظار» gets its hamza (INCIDENTS #290)', () => {
  assert.equal(applyCorrections('واجهة جماهيرية كبرى تجذب الانظار.'), 'واجهة جماهيرية كبرى تجذب الأنظار.');
});

test('«فوريا» for «فورا» and «أسماء كبارة» are corrected, the wrestler Furia Roja is not (INCIDENTS #259)', () => {
  assert.equal(applyCorrections('لترد جوليا فوريا بضربة برأسها، مع أسماء كبارة في هوليوود، قبل أن تتجه كواليس الصالة'), 'لترد جوليا فورا بضربة برأسها، مع أسماء كبيرة في هوليوود، قبل أن تتجه إلى كواليس الصالة');
  assert.equal(applyCorrections('فاز زاندوكان جونيور وفوريا روخا'), 'فاز زاندوكان جونيور وفوريا روخا');
});

test('Dudley Boyz, Road Warriors and the MLP names are in the glossary (INCIDENTS #262)', () => {
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Dudley Boyz'], 'ذا دادلي بويز');
  assert.equal(names['The Road Warriors'], 'ذا رود ووريرز');
  assert.equal(names['Nikki Storm'], 'نيكي ستورم');
  assert.equal(names['Gabriel Fuerza'], 'غابرييل فويرزا');
});

test('a ring announcer is «مذيع الحلبة», not a commentator (INCIDENTS #263)', () => {
  assert.equal(applyCorrections('أعلن الاتحاد أن معلق الحلبة يوجي شيندو سيغيب'), 'أعلن الاتحاد أن مذيع الحلبة يوجي شيندو سيغيب');
  assert.equal(applyCorrections('وكان العرض مجددا في الأصل لينطلق'), 'وكان العرض مقررا في الأصل لينطلق');
});

test('Maple Leaf Gardens is not «ماتايمي غاردنز» (INCIDENTS #264)', () => {
  assert.equal(applyCorrections('في مركز ماتايمي الرياضي، المعروف سابقا باسم ماتايمي غاردنز'), 'في مركز ماتامي الرياضي، المعروف سابقا باسم ميبل ليف غاردنز');
});

test('«أمضي مسيرته» in the past is «أمضى» (INCIDENTS #265)', () => {
  assert.equal(applyCorrections('باعتباره أمضي مسيرته في الخسارة'), 'باعتباره أمضى مسيرته في الخسارة');
});

test('a programme has episodes: «أحدث حلقة من برنامج» (INCIDENTS #266)', () => {
  assert.equal(applyCorrections('خلال ظهوره في أحدث عرض من برنامج The Mick And Kenny Show'), 'خلال ظهوره في أحدث حلقة من برنامج The Mick And Kenny Show');
});

test('a booker is «مسؤول الحجز وصناعة القصص» and «means every word» is not «يعنيهم حرفيا» (INCIDENTS #267)', () => {
  assert.equal(applyCorrections('يستعد مسؤول الحجوزات والنجوم في اتحاد NJPW'), 'يستعد مسؤول الحجز وصناعة القصص في اتحاد NJPW');
  assert.equal(applyCorrections('لأنني أعرف أنه يعنيهم حرفيا'), 'لأنني أعرف أنه يعني كل كلمة فيها');
});

test('a ratings report for a show more than 8 days old is not published, a fresh one is (INCIDENTS #268)', async () => {
  const { staleRatingsReport } = await import('../scripts/fightful-watcher');
  assert.equal(staleRatingsReport('AEW Dynamite Ratings & Viewership Report', 'https://www.wrestlinginc.com/2276852/aew-dynamite-ratings-viewership-report-september-23-2026/', '2026-10-05T02:00:00'), '2026-09-23');
  assert.equal(staleRatingsReport('WWE SmackDown 9/25 Viewership Holds, Demo Drops', 'https://www.fightful.com/wrestling/wwe-smackdown-9-25-viewership-holds-demo-drops/', '2026-10-01T18:00:00'), null);
  assert.equal(staleRatingsReport('Brock Lesnar Inducted Into Hall Of Fame', 'https://x.com/september-1-2026', '2026-10-01'), null);
});

test('a headline drops «/2026» after a show name and quotes with «» (INCIDENTS #268)', async () => {
  const { dropTimezoneFromTitle } = await import('../scripts/news-qa');
  assert.equal(dropTimezoneFromTitle('تقرير نسب مشاهدة وتقييمات عرض WWE NXT/2026'), 'تقرير نسب مشاهدة وتقييمات عرض WWE NXT');
  assert.equal(dropTimezoneFromTitle('بولي راي يشيد بـرومان رينز: "هو يؤدي كل شيء بأعلى درجات الإتقان"'), 'بولي راي يشيد بـرومان رينز: «هو يؤدي كل شيء بأعلى درجات الإتقان»');
  assert.equal(applyCorrections('في عرض الأبطال الخالدون المقرر'), 'في عرض Heroes Inmortales المقرر');
});

test('«escapes the show with the title» is a retention headline, and the Paris show keeps its name (INCIDENTS #319)', async () => {
  const { dropTimezoneFromTitle } = await import('../scripts/news-qa');
  assert.equal(dropTimezoneFromTitle('داربي ألين ينجو من عرض AEW Grand Slam: France ويحتفظ ببطولة TNT'), 'داربي ألين يحتفظ ببطولة TNT في عرض AEW Grand Slam: France');
  assert.equal(dropTimezoneFromTitle('توني ستورم تنجو من عرض AEW Dynamite وتحتفظ باللقب'), 'توني ستورم تحتفظ باللقب في عرض AEW Dynamite');
  assert.equal(dropTimezoneFromTitle('داربي ألين ينجو من إصابة خطيرة'), 'داربي ألين ينجو من إصابة خطيرة');
  assert.equal(applyCorrections('ضمن عرض AEW Dynamite: Grand Slam Paris قدمت'), 'ضمن عرض AEW Grand Slam: France قدمت');
});

test('a results winner that is not in its own match text is flagged (INCIDENTS #269)', async () => {
  const { winnersNotInMatch } = await import('../scripts/news-qa');
  const bad = '**المواجهة الأولى: نزال إقصائي رباعي**\n\nتاركة بصمتها في النزال، تفوق آلان على كل من ميللا مور.\n\n🏆 **الفائزة:** شانتل جوردان\n\n**المواجهة الثانية: نزال فردي**\n\nشهد النزال مواجهة قوية بين الطرفين حسمتها النتيجة لصالح المنتصرة.\n\n🏆 **الفائزة:** جاي جي يو';
  assert.deepEqual(winnersNotInMatch(bad), ['شانتل جوردان', 'جاي جي يو']);
  const good = '**المواجهة الأولى: نزال فرق**\n\nنجح فريق هايبرأكتيف المكون من أنيتا فوهان وسافاير ريد في الفوز على كيلر كوينز.\n\n🏆 **الفائزات:** فريق هايبرأكتيف (أنيتا فوهان وسافاير ريد)';
  assert.deepEqual(winnersNotInMatch(good), []);
  const { spelledAgesToDigits } = await import('../scripts/news-qa');
  assert.equal(spelledAgesToDigits('المصارع البالغ من العمر تسعا وأربعين عاما'), 'المصارع البالغ من العمر 49 عاما');
  assert.equal(applyCorrections('خاضت برينسيسا سوجيهيت نزالا من جلتين، وانضم إلى بولت كلاب للاحتفاظ بطولة'), 'خاضت برينسيسا سوغيهيت نزالا من جولتين، وانضم إلى بوليت كلوب للاحتفاظ ببطولة');
});

test('spelling and agreement slips from the 5 Oct evening stories are fixed (INCIDENTS #276)', () => {
  assert.equal(
    applyCorrections('أقام عرضا تكوينيا خاصا، والصمام يسببه له آلاما، ومرورا بفتره ستاردست، وأنهت مشوارها بشكل رسميا، ولفت انظار الاتحاد في العرض الشهرى، ليحقا اللقب، بينما نشر القناة الفيديو'),
    'أقام عرضا تكريميا خاصا، والصمام يسبب له آلاما، ومرورا بفترة ستاردست، وأنهت مشوارها بشكل رسمي، ولفت أنظار الاتحاد في العرض الشهري، ليحققا اللقب، بينما نشرت القناة الفيديو',
  );
});

test('the site never blocks the right-click menu (owner, INCIDENTS #271)', () => {
  const head = fs.readFileSync('_includes/adsense.njk', 'utf-8');
  assert.doesNotMatch(head, /addEventListener\(\s*['"]contextmenu['"]/);
});

test('the Search Console report turns raw data into problems to fix (INCIDENTS #272)', async () => {
  const { findProblems } = await import('../scripts/search-console-report');
  const p = findProblems({
    sitemaps: [{ path: 'https://arab-wrestling.com/sitemap.xml', errors: '2', warnings: '0' }],
    inspections: [
      { url: 'https://arab-wrestling.com/news/a/', result: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', pageFetchState: 'SUCCESSFUL' } } },
      { url: 'https://arab-wrestling.com/news/b/', result: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed', pageFetchState: 'SUCCESSFUL', userCanonical: 'https://arab-wrestling.com/news/b/', googleCanonical: 'https://arab-wrestling.com/news/c/' } } },
    ],
    pages: [{ keys: ['https://arab-wrestling.com/news/d/'], impressions: 900, clicks: 2, ctr: 0.002, position: 6.2 }],
  });
  assert.equal(p.length, 4);
  assert.match(p[0], /خريطة الموقع/);
  assert.match(p.join('\n'), /مش متفهرس/);
  assert.match(p.join('\n'), /صفحة أساسية تانية/);
  assert.match(p.join('\n'), /ظهور كتير ونقرات قليلة/);
});

test('Search Console problems skip brand sitelinks and stories Google has not met yet (INCIDENTS #273)', async () => {
  const { findProblems } = await import('../scripts/search-console-report');
  const now = Date.parse('2026-10-06T00:00:00Z');
  const p = findProblems({
    generatedAt: '2026-10-06T00:00:00Z',
    inspections: [{ url: 'https://arab-wrestling.com/news/x/', published: now - 3600_000, result: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'لم يتعرّف محرّك بحث Google على عنوان URL.', pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED' } } }],
    pages: [
      { keys: ['https://arab-wrestling.com/shows/3/'], impressions: 5210, clicks: 36, ctr: 0.007, position: 1.1 },
      { keys: ['https://arab-wrestling.com/about/'], impressions: 1480, clicks: 1, ctr: 0.001, position: 1.5 },
    ],
  });
  assert.deepEqual(p, []);
});

test('an article keeps redirect pages at its older addresses (INCIDENTS #274)', async () => {
  const { legacyArticleAddresses } = await import('../lib/redirects.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
  fs.writeFileSync(path.join(dir, '2026-08-06-اقتراب-عودة-درو-ماكنتاير-لـ-wwe.md'), '---\ntitle: "اقتراب عودة درو ماكنتاير لـ WWE"\npermalink: "/news/اقتراب-عودة-درو-ماكنتاير-ل-wwe/index.html"\n---\nنص');
  const pairs = legacyArticleAddresses(dir, path.join(dir, '_site'));
  assert.deepEqual(pairs, [['/news/اقتراب-عودة-درو-ماكنتاير-لـ-wwe/', '/news/اقتراب-عودة-درو-ماكنتاير-ل-wwe/']]);
  const { findProblems } = await import('../scripts/search-console-report');
  assert.match(findProblems({ deadPages: [{ url: 'https://arab-wrestling.com/news/x', impressions: 599 }] })[0], /رابطها واقع/);
});

test('source-folder addresses of shows, recaps and news redirect to their pages (INCIDENTS #284)', async () => {
  const { contentFolderAddresses } = await import('../lib/redirects.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-'));
  const site = path.join(root, '_site');
  for (const s of ['shows', 'recaps', 'news']) fs.mkdirSync(path.join(root, s));
  fs.writeFileSync(path.join(root, 'shows', '2026-08-08-smackdown-07-08-2026.md'), '---\ntitle: "WWE SmackDown 07.08.2026"\n---\n');
  fs.writeFileSync(path.join(root, 'recaps', '2026-08-05-full-raw-highlights-aug-3-2026.md'), '---\ntitle: "ملخص الرو"\n---\n');
  fs.writeFileSync(path.join(root, 'news', '2026-08-06-خبر-قديم.md'), '---\ntitle: "خبر جديد"\n---\n');
  fs.writeFileSync(path.join(root, 'news', 'لا-صفحة.md'), '---\ntitle: "لا صفحة له"\n---\n');
  for (const p of ['shows/wwe-smackdown-07-08-2026', 'recaps/ملخص-الرو', 'news/خبر-جديد']) {
    fs.mkdirSync(path.join(site, p), { recursive: true });
    fs.writeFileSync(path.join(site, p, 'index.html'), '');
  }
  const pairs = contentFolderAddresses(root, site).map(([from]) => from).sort();
  assert.deepEqual(pairs, ['/content/news/2026-08-06-خبر-قديم/', '/content/recaps/2026-08-05-full-raw-highlights-aug-3-2026/', '/content/shows/2026-08-08-smackdown-07-08-2026/', '/shows/smackdown-07-08-2026/']);
  // an annual show's file-name address (with the year) leads to its year-less page (INCIDENTS #325)
  fs.writeFileSync(path.join(root, 'shows', 'revpro-14-year-anniversary-show-2026.md'), '---\ntitle: "RevPro 14 Year Anniversary Show"\nis_annual: true\n---\n');
  fs.mkdirSync(path.join(site, 'shows/revpro-14-year-anniversary-show'), { recursive: true });
  fs.writeFileSync(path.join(site, 'shows/revpro-14-year-anniversary-show/index.html'), '');
  const annual = contentFolderAddresses(root, site).find(([from]) => from === '/shows/revpro-14-year-anniversary-show-2026/');
  assert.equal(annual?.[1], '/shows/revpro-14-year-anniversary-show/');
  // searched words in the head only: «مصارعة wwe», «نتائج عرض الرو الاخير», «wrestling in arabic» (INCIDENTS #325)
  assert.match(fs.readFileSync('pages/federation.njk', 'utf-8'), /<title>مصارعة \{\{ fed\.code \}\}:/);
  assert.match(fs.readFileSync('pages/library-program.njk', 'utf-8'), /pageDesc: "[^"]*مع نتائجه كاملة/);
  assert.match(fs.readFileSync('index.njk', 'utf-8'), /"Wrestling in Arabic"/);
  assert.match(fs.readFileSync('eleventy.config.js', 'utf-8'), /contentFolderAddresses\(\)/);
  // the searched words lead the home and tag pages
  assert.match(fs.readFileSync('index.njk', 'utf-8'), /<title>عرب راسلنج \| مصارعة حرة/);
  const tag = fs.readFileSync('pages/tag.njk', 'utf-8');
  assert.match(tag, /<title>\{\{ tagObj\.name \}\}: آخر الأخبار/);
  assert.match(tag, /<meta name="description" content="آخر أخبار \{\{ tagObj\.name \}\}/);
});

test('program pages are in the sitemap and show pages get search-worded titles (INCIDENTS #275)', () => {
  assert.match(fs.readFileSync('pages/sitemap.njk', 'utf-8'), /for prog in collections\.library/);
  assert.match(layoutSource(), /showSeo\(headline, title, program_name, event_date, page\.url, collections\.library, description\)/);
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.match(cfg, /showSeoText\(\{ headline, title, programName, eventDate, day, isLatest, description \}\)/);
  assert.match(fs.readFileSync('_redirects', 'utf-8'), /^\/raw\/\* \/library\/wwe-raw\/ 301!$/m);
});

test('a show page title carries the dotted date people search with, only in the head (INCIDENTS #296)', async () => {
  const { showSeoText } = (await import('../lib/show-seo.cjs')).default;
  const raw = { headline: 'عرض الرو 05.10.2026 مترجم', title: 'WWE RAW 05.10.2026', programName: 'WWE RAW', eventDate: new Date('2026-10-05'), day: '5 أكتوبر 2026', description: 'عرض الرو مترجم بالكامل مع جميع النزالات والأحداث.' };
  const latest = showSeoText({ ...raw, isLatest: true });
  assert.equal(latest.title, 'عرض الرو الأخير 05.10.2026 مترجم (5 أكتوبر 2026) — WWE RAW');
  assert.equal(latest.description, 'شاهد عرض الرو الأخير 05.10.2026 مترجم بالعربي كامل بتاريخ 5 أكتوبر 2026 (WWE RAW October 5, 2026) بجودة عالية مع كل النزالات، مشاهدة وتحميل على عرب راسلنج.');
  assert.equal(showSeoText({ ...raw, isLatest: false }).title, 'عرض الرو 05.10.2026 مترجم (5 أكتوبر 2026) — WWE RAW');
  // no date in the name: it comes from the show's date
  assert.equal(showSeoText({ ...raw, headline: 'عرض الرو مترجم', isLatest: false }).title, 'عرض الرو 05.10.2026 مترجم (5 أكتوبر 2026) — WWE RAW');
  // a written description is kept
  assert.equal(showSeoText({ ...raw, description: 'وصف خاص', isLatest: true }).description, 'وصف خاص');
  // nothing on the page itself changes: the heading still strips the date
  assert.match(layoutSource(), /\{\{ headline \| arabicShowName \| stripDate \}\}/);
});

test('weekly roundups dated today are not tonight\'s show, and their fixes reach the model (INCIDENTS #277)', () => {
  assert.equal(analyzeShowTiming('Biggest Winners And Losers Of The Week — 10/5/2026', '2026-10-05T22:00:00Z').isTonight, false);
  assert.equal(analyzeShowTiming('WWE Raw Preview (10/5)', '2026-10-05T12:00:00Z').isTonight, true);
  const c = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf-8')).corrections;
  for (const w of ['العددا', 'باويز', 'أحذية ضخمة ليملأها']) assert.ok(c.some((x) => x.wrong === w), w);
  assert.equal(JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'))['Royce Keys'], 'رويس كيز');
});

test('six-man tag wording and Fenix/Usos names reach the model (INCIDENTS #279)', () => {
  const c = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf-8')).corrections;
  assert.ok(c.some((x) => x.wrong === 'مواجهة فرق سداسية' && x.right === 'نزال فرق سداسي'));
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Rey Fenix'], 'ري فينيكس');
  assert.equal(names['The Usos'], 'ذا أوسوز');
});

test('Knight transliteration and The 946 name reach the model (INCIDENTS #283)', () => {
  const c = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf-8')).corrections;
  assert.ok(c.some((x) => x.wrong === 'وكايت هاجمه' && x.right.includes('نايت')));
  assert.ok(c.some((x) => x.wrong === 'فريق 946' && x.right === 'فريق ذا 946'));
  assert.equal(JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'))['The 946'], 'ذا 946');
});

test('NXT preview title typos and tag-classic names reach the model (INCIDENTS #288)', () => {
  const c = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf-8')).corrections;
  assert.ok(c.some((x) => x.wrong === 'الناعلة' && x.right === 'الناقلة'));
  assert.ok(c.some((x) => x.wrong === 'ال الليلة' && x.right === 'الليلة'));
  assert.ok(c.some((x) => x.wrong === 'كتور زانوف' && x.right === 'فيكتور زانوف'));
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Shido Ash'], 'شيدو آش');
  assert.equal(names['Zilla Fatu'], 'زيلا فاتو');
});

test('a recap that takes a URL another file already went out under is posted with its own key (INCIDENTS #280)', async () => {
  const { urlKeyOwners, socialKeyFor } = await import('../worker/src/index');
  const url = 'httpsarab-wrestlingcomrecapswwe-raw-highlights-28-09-2026';
  const owners = urlKeyOwners({
    '20260929130239-wwe-raw-highlights-28-09-2026': url,
    '20261006054610-wwe-raw-highlights-28-09-2026': url, // the wrong backfill the old code wrote
  });
  // the first file keeps its key; the newcomer gets a fresh one, so nothing reads as «already posted»
  assert.equal(socialKeyFor(url, '20260929130239-wwe-raw-highlights-28-09-2026', owners), url);
  const fresh = socialKeyFor(url, '20261006054610-wwe-raw-highlights-28-09-2026', owners);
  assert.notEqual(fresh, url);
  assert.ok(fresh.startsWith(url));
  // a URL nobody owns yet, or a file without a name, keeps the plain URL key
  assert.equal(socialKeyFor('httpsarab-wrestlingcomrecapsnew', 'x', owners), 'httpsarab-wrestlingcomrecapsnew');
  assert.equal(socialKeyFor(url, '', owners), url);
  // recaps are full episodes: the 12h window and Instagram without the news ration
  const src = fs.readFileSync('worker/src/index.ts', 'utf-8');
  assert.match(src, /item\.kind === "show" \|\| item\.kind === "recap" \? 12 \* 60 \* 60 \* 1000/);
  assert.match(src, /item\.kind !== "show" && item\.kind !== "recap" && !instagramAllowedFor/);
});

test('watch servers: dead and non-embeddable hosts are hidden, StreamHG mirrors go through hgcloud, fullscreen works after a redirect (INCIDENTS #276)', async () => {
  const { toEmbedUrl, playableServers } = await import('../lib/embed.cjs');
  assert.equal(toEmbedUrl('https://hanerix.com/eid6vpj41xti'), 'https://hgcloud.to/e/eid6vpj41xti');
  assert.equal(toEmbedUrl('https://hanerix.com/e/eid6vpj41xti'), 'https://hgcloud.to/e/eid6vpj41xti');
  const servers = [{ url: 'https://turbovidhls.com/t/abc' }, { url: 'https://multiup.io/xyz' }, { url: 'https://ok.ru/video/1' }];
  assert.deepEqual(playableServers(servers, { dead: ['turbovidhls.com'], noEmbed: [] }).map((s: any) => s.url), ['https://ok.ru/video/1']);
  // never an empty player
  assert.equal(playableServers([{ url: 'https://turbovidhls.com/t/abc' }], { dead: ['turbovidhls.com'] }).length, 1);
  const { refusesEmbedding } = await import('../scripts/check-video-hosts');
  assert.ok(refusesEmbedding('sameorigin', ''));
  assert.ok(!refusesEmbedding('ALLOWALL, ALLOWALL', ''));
  assert.ok(refusesEmbedding('', "frame-ancestors 'self'"));
  const layout = layoutSource();
  assert.match(layout, /'allow', 'autoplay \*; fullscreen \*;/);
  assert.match(layout, /servers \| playableServers\(videoHosts, videoLinks\)/);
});

test('the player loader stays until the server has loaded and settled, never on a blind timer (INCIDENTS #277)', () => {
  const layout = layoutSource();
  assert.doesNotMatch(layout, /safetyHideTimer/);
  assert.match(layout, /if \(seq !== mountSeq\) return;/);
  assert.match(layout, /var SETTLE_MS = multiStep \? \d+ : \d+;/);
  assert.match(layout, /id="videoLoaderBar"/);
});

test('the host check counts a CDN error page (5xx) as down (INCIDENTS #278)', () => {
  const src = fs.readFileSync('scripts/check-video-hosts.ts', 'utf-8');
  assert.match(src, /if \(res\.status >= 500\) return "dead";/);
  assert.match(src, /\{ \.\.\.\(prev\.strikes \|\| \{\}\) \}/);
});

test('«الأكثر مشاهدة» uses each page\'s small card picture, not the full upload (INCIDENTS #285)', () => {
  assert.match(layoutSource(), /\{% optThumbMeta image %\}/);
  assert.match(fs.readFileSync('worker/src/top10.ts', 'utf-8'), /meta\[name="arw-thumb"\]/);
  const js = fs.readFileSync('assets/top10.js', 'utf-8');
  assert.match(js, /<img class="t10-img" src=/);
  assert.match(js, /localStorage\.setItem\(STORE/);
  new Function(js); // still valid JavaScript
});

test('a show page path ends at its program, and every show has a program (INCIDENTS #286)', () => {
  const layout = layoutSource();
  assert.match(layout, /libraryProgramOf\(page\.url, collections\.library\)/);
  assert.equal((layout.match(/"@type": ?"BreadcrumbList"/g) || []).length, 1, 'one BreadcrumbList');
  const missing = fs.readdirSync('content/shows').filter(f => f.endsWith('.md') && !/^program_name:\s*\S/m.test(fs.readFileSync(`content/shows/${f}`, 'utf-8')));
  assert.deepEqual(missing, []);
});

test('«الأكثر مشاهدة» shows the short Arabic name, not the search title (INCIDENTS #287)', () => {
  assert.match(layoutSource(), /<meta name="arw-card-title" content="\{\{ \(headline or title\) \| escape \}\}">/);
  assert.match(fs.readFileSync('worker/src/top10.ts', 'utf-8'), /if \(cardTitle\) title = decodeEntities\(cardTitle\)\.trim\(\);/);
});

test('OK.ru and StreamHG are marked «متعدد الجودات» on watch tabs and downloads (INCIDENTS #289)', () => {
  const layout = layoutSource();
  assert.match(layout, /\(s\.url \| toEmbedUrl\) \| isMultiQuality/);
  assert.match(layout, /<span class="srv-mq">متعدد الجودات<\/span>/);
  assert.match(layout, /item\.url \| isMultiQuality/);
  assert.match(layout, /<span class="dl-mq-badge"><svg [^>]*>.*?<\/svg>متعدد الجودات<\/span>/);
  assert.match(layout, /\{% if dlMq %\}اختر الجودة المناسبة لك\{% else %\}/);
  assert.match(layout, /html\.arw-dark \.dl-mq-badge\{/);
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  const re = new RegExp(cfg.match(/MULTI_QUALITY_RE = \/(.+)\/i;/)![1], 'i');
  for (const h of ['ok.ru', 'streamhg.com', 'hgcloud.to', 'hanerix.com']) assert.ok(re.test(h), h);
  for (const h of ['vidoza.net', 'dood.to', 'mega.nz']) assert.ok(!re.test(h), h);
});

test('a story about Vince Russo never says «مكمان»; new names and spellings are learned (INCIDENTS #294)', async () => {
  const { vinceIsRusso, applyCorrections } = await import('../scripts/news-qa');
  const src = 'Bruce Wayne said Vince Russo leaving JCW left him shocked. Russo sold his stake.';
  assert.equal(vinceIsRusso('فريق Choppa City يؤكد أن مغادرة فينس مكمان لاتحاد JCW أثارت صدمتهم', src), 'فريق Choppa City يؤكد أن مغادرة فينس روسو لاتحاد JCW أثارت صدمتهم');
  assert.equal(vinceIsRusso('فينس مكمان', src), 'فينس روسو');
  assert.equal(vinceIsRusso('فينس مكمان', 'Vince McMahon and Vince Russo argued.'), 'فينس مكمان');
  assert.equal(vinceIsRusso('فينس مكمان', 'Vince McMahon said.'), 'فينس مكمان');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Vince Russo'], 'فينس روسو');
  assert.equal(names['Zane Jay'], 'زين جاي');
  assert.equal(applyCorrections('جيم روس: ليس متأحرا جدا'), 'جيم روس: ليس متأخرا جدا');
  assert.equal(applyCorrections('جولة في كواليس غرفة الفتيس'), 'جولة في كواليس غرفة الملابس');
  assert.equal(applyCorrections('لمدة مئة واربعة عشر يوما'), 'لمدة مئة وأربعة عشر يوما');
  const { checkArticle } = await import('../scripts/news-qa');
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'فريق يونايتد إمباير المكون من ويل أوسبراي وهيناري وغريت أو خان وغريت أو خان في نزال.', []).some(i => i.code === 'doubled_name'));
  assert.ok(!checkArticle('عنوان عربي كامل للخبر هنا', 'فريق يونايتد إمباير المكون من ويل أوسبراي وهيناري وغريت أو خان في نزال.', []).some(i => i.code === 'doubled_name'));
  const watcher = fs.readFileSync('scripts/fightful-watcher.ts', 'utf-8');
  assert.match(watcher, /vinceIsRusso\(draft\.title, plainText\)/);
});

test('a show named twice, a first-person quip headline and a dateless ratings headline are blocked (INCIDENTS #299)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const has = (title: string, body: string, code: string) => checkArticle(title, body, []).some(i => i.code === code);
  const filler = ' وهذا نص إضافي طويل بما يكفي لتجاوز حد الطول الأدنى للنص.'.repeat(6);
  assert.ok(has('عنوان عربي كامل للخبر هنا', 'فازت بيريز خلال عرض WWE RAW في عرض WWE RAW بتاريخ 21 سبتمبر.' + filler, 'doubled_show_phrase'));
  assert.ok(!has('عنوان عربي كامل للخبر هنا', 'فازت بيريز خلال عرض WWE RAW بتاريخ 21 سبتمبر.' + filler, 'doubled_show_phrase'));
  assert.ok(has('سبيدبول مايك بيلي يوجه تحية لإيغل بلانك الذي يتواجد في دار أيتام بالمكسيك على ما أعتقد', filler, 'title_first_person'));
  assert.ok(!has('سبيدبول مايك بيلي يمازح إيغل بلانك ويتحدث عن ارتباط الجماهير الفرنسية به', filler, 'title_first_person'));
  assert.ok(has('تقرير نسب المشاهدة والتقييمات لعرض WWE NXT 2026', filler, 'ratings_title_no_date'));
  assert.ok(!has('تقرير نسب مشاهدة وتقييمات عرض WWE NXT يوم 22 سبتمبر 2026', filler, 'ratings_title_no_date'));
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['EK Prosper'], 'إي كي بروسبر');
  assert.equal(names['Aigle Blanc'], 'إيغل بلانك');
});

test('«سويا» takes a dual verb: «وتمكنا سويا من» (INCIDENTS #300)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('تحالف مع ميستيكو وتمكن سويا من حصد البطولة'), 'تحالف مع ميستيكو وتمكنا سويا من حصد البطولة');
});

test('«كل من» needs «و» between the names, and the Cazanas read like the dictionary (INCIDENTS #301)', async () => {
  const { checkArticle, applyCorrections } = await import('../scripts/news-qa');
  const has = (body: string) => checkArticle('عنوان عربي كامل للخبر هنا', body, []).some(i => i.code === 'kol_min_no_waw');
  const filler = ' وهذا نص إضافي طويل بما يكفي لتجاوز حد الطول الأدنى للنص.'.repeat(6);
  assert.ok(has('تواجه كل من كراتوس روميو كيفيدو في نزال فردي.' + filler));
  assert.ok(!has('تواجه كل من كراتوس وروميو كيفيدو في نزال فردي.' + filler));
  assert.equal(applyCorrections('ذا كونتري جنتلمن (كي سي كازانا وأجي كازانا)'), 'ذا كونتري جنتلمن (كي سي كازانا وإيه جيه كازانا)');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['AJ Cazana'], 'إيه جيه كازانا');
  assert.equal(names['Romeo Quevedo'], 'روميو كيفيدو');
});

test('long Latin fragments, ى for ي, and the merger-day wording are caught (INCIDENTS #304)', async () => {
  const { checkArticle, applyCorrections } = await import('../scripts/news-qa');
  const codes = (body: string) => checkArticle('عنوان عربي كامل للخبر هنا', body, []).map(i => i.code);
  const filler = ' وهذا نص إضافي طويل بما يكفي لتجاوز حد الطول الأدنى للنص.'.repeat(6);
  assert.ok(codes('تستهدف تحقيق ستة مليارات دولار في الت synergies السنوية.' + filler).includes('broken_word'));
  assert.ok(codes('تحدث جون سينا فى لقاء صحفى عن المخرج الذى دفعه.' + filler).includes('alif_maqsura_ya'));
  assert.ok(!codes('تحدث جون سينا في لقاء صحفي عن المخرج الذي دفعه، والفتى مصطفى.' + filler).includes('alif_maqsura_ya'));
  assert.equal(applyCorrections('في الت synergies السنوية'), 'في الوفورات السنوية');
  assert.equal(applyCorrections('مدعوا القضية المتعلقة ببث WWE'), 'المدعيان في القضية المتعلقة ببث WWE');
  assert.equal(applyCorrections('شركة باراماونت سكايدانس وسكيدانس'), 'شركة باراماونت سكاي دانس وسكاي دانس');
  assert.equal(applyCorrections('أنا قسس قليلا عليه'), 'أنا قاس عليه قليلا');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['Skydance'], 'سكاي دانس');
  assert.equal(names['Sean Mowry'], 'شون موري');
  const { newSubject } = await import('../scripts/editorial');
  const matched = { title: 'باراماونت تستحوذ على وارنر براذرز ديسكفري', body: 'أعلنت شركة سكاي دانس رسميا عن إتمام الاستحواذ.', tags: ['باراماونت'] };
  assert.equal(newSubject({ title: 'اكتمال استحواذ باراماونت وتأسيس شركة سكيدانس رسميا', body: '', tags: ['سكيدانس'] }, matched), null);
  assert.equal(newSubject({ title: 'كيماليتو يرثي باك', body: '', tags: ['كيماليتو'] }, matched), 'كيماليتو');
});

test('the social shield note never carries letters from another script (INCIDENTS #295)', async () => {
  const { cleanSpoilerNote } = await import('../scripts/news-qa');
  assert.equal(cleanSpoilerNote('لا يتضمن نتائج نزالات أو عодات حديثة.'), 'لا يتضمن نتائج نزالات أو عات حديثة.');
  assert.equal(cleanSpoilerNote('ملاحظة سليمة عن WWE.'), 'ملاحظة سليمة عن WWE.');
  const watcher = fs.readFileSync('scripts/fightful-watcher.ts', 'utf-8');
  assert.match(watcher, /JSON\.stringify\(cleanSpoilerNote\(socialVerdict\.note\)\)/);
  for (const f of fs.readdirSync('content/news').filter(n => n.startsWith('20261006'))) {
    const note = fs.readFileSync(`content/news/${f}`, 'utf-8').match(/^social_spoiler_note: (.*)$/m)?.[1] ?? '';
    assert.equal(note, cleanSpoilerNote(note), f);
  }
});

test('JetSpeed is a tag team, never «شركة» (INCIDENTS #297)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('طقمين من ملابس شركة JetSpeed'), 'طقمين من ملابس فريق جيت سبيد');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf-8'));
  assert.equal(names['JetSpeed'], 'جيت سبيد');
  assert.equal(names['Veda Scott'], 'فيدا سكوت');
});

test('a shelved plan is frozen, never cancelled (INCIDENTS #291)', async () => {
  const { shelvedNotCancelled } = await import('../scripts/news-qa');
  const src = 'That match is still shelved and tabled for right now.';
  assert.equal(shelvedNotCancelled('اتحاد AEW يلغي خططه لتنظيم نزال بنمط Elimination Chamber', src), 'اتحاد AEW يجمّد خططه لتنظيم نزال بنمط Elimination Chamber');
  assert.equal(shelvedNotCancelled('وألغى الاتحاد الفكرة بعد قرار الإلغاء', src), 'وجمّد الاتحاد الفكرة بعد قرار التجميد');
  assert.equal(shelvedNotCancelled('اتحاد AEW يلغي خططه', 'The plans were shelved, then scrapped entirely.'), 'اتحاد AEW يلغي خططه');
  assert.equal(shelvedNotCancelled('اتحاد AEW يلغي خططه', 'AEW cancelled the match.'), 'اتحاد AEW يلغي خططه');
  const watcher = fs.readFileSync('scripts/fightful-watcher.ts', 'utf-8');
  assert.match(watcher, /shelvedNotCancelled\(draft\.title, plainText\)/);
});

test('the watch box: servers listed beside the player in one box, notice inside it (INCIDENTS #292)', () => {
  const layout = layoutSource();
  assert.match(layout, /<section class="watch-deck/);
  assert.match(layout, /class="wd-list" id="serverTabs"/);
  assert.match(layout, /class="srv-row\{% if loop\.index0 == 0 %\} active/);
  // the list is exactly as tall as the player, and six rows share it
  assert.match(layout, /\.wd-list\{ position:absolute; inset:0;/);
  assert.match(layout, /\.srv-row\{ position:relative; flex:1 1 0; min-height:44px;/);
  // the owner's notice, word for word, inside the box; the old separate notice is gone
  assert.ok(layout.includes('<b>تنبيه:</b> سيرفرات المشاهدة تُعيد ترميز الفيديو مما يقلل من جودته؛ لمشاهدته بجودته الأصلية'));
  assert.doesNotMatch(layout, /class="quality-notice"/);
  // the player script follows the new rows, not the old tabs
  assert.doesNotMatch(layout, /querySelectorAll\('\.server-tab'\)/);
  assert.match(layout, /var srvRows = Array\.from\(document\.querySelectorAll\('\.srv-row'\)\);/);
  // cinema mode covers the whole screen
  assert.match(layout, /body\.cinema-mode-active \.post-wrap\{ transform:none !important; transition:none !important;/);
  assert.match(layout, /\.reveal\.is-visible\{ opacity:1; transform:none;/);
  // no colloquial words in the box
  const deck = layout.slice(layout.indexOf('<section class="watch-deck'), layout.indexOf('</section>', layout.indexOf('<section class="watch-deck')));
  assert.doesNotMatch(deck, /دلوقتي|اختار |اللي|مش |ماشتغلش/);
  // the show's picture and a play button first; nothing loads from a server before the press
  assert.match(layout, /<section class="watch-deck is-idle/);
  assert.match(layout, /<button type="button" class="wd-poster" id="wdPoster"/);
  assert.match(layout, /<div class="video-loader is-hidden" id="videoLoader">/);
  assert.match(layout, /posterBtn\.addEventListener\('click', startPlayback\)/);
  assert.doesNotMatch(layout, /mountVideo\(embedBox, initialSrc/);
  // one card in the download box's style, at the page's column width; pages with a player get a wider column
  assert.match(layout, /\.watch-deck\{ position:relative; container-type:inline-size; background:var\(--card\); border:1px solid var\(--line\); border-radius:16px;/);
  // the wider column is for show, recap and nostalgia pages only; news and the rest of the site keep their sizes
  assert.match(layout, /\.post-wrap\{ max-width:820px; margin:0 auto; padding:48px 24px 80px; \}/);
  assert.match(layout, /\.post-wrap\.is-watch\{ max-width:1040px; \}/);
  assert.match(layout, /\{% if not isNews and \(page\.url\.startsWith\('\/shows\/'\) or page\.url\.startsWith\('\/recaps\/'\) or isNostalgiaItem\) %\} is-watch\{% endif %\}/);
  for (const f of ['index.njk', ...fs.readdirSync('pages').filter(x => x.endsWith('.njk')).map(x => `pages/${x}`)]) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf-8'), /\.wrap\{ max-width:(?!1180px)/, f);
  }
  assert.match(fs.readFileSync('assets/dark.css', 'utf-8'), /html\.arw-dark \.watch-deck\{/);
  // no shortcut line, no quality numbers under the rows, the notice is plain text
  assert.doesNotMatch(deck, /wd-keys|1080 · 720|href="#downloads"/);
});

test('library pages: plural title from the program\'s own name, no «آخر عرض» line (INCIDENTS #298)', () => {
  const page = fs.readFileSync('pages/library-program.njk', 'utf-8');
  assert.match(page, /\{\{ lp\.prog\.arLibTitle \}\}/);
  assert.doesNotMatch(page, /آخر عرض:/);
  assert.match(page, /شاهد أحدث \{\{ lp\.prog\.arLibTitle \| replace\(" مترجمة", ""\) \}\} مترجمة إلى العربية، وتصفّح أرشيف/);
  assert.doesNotMatch(page, /معروف كمان باسم/);
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.match(cfg, /arName\.replace\(\/\^عرض\\s\/, "عروض "\) \+ " مترجمة"/);
  assert.match(cfg, /"progress-wrestling": "عرض بروجرس ريسلينج"/);
  // a series' season and episode and a yearly event's year never end up in the program's name
  assert.match(cfg, /\.replace\(\/\\s\*\(\?:الموسم\|موسم\)\\s\*\\d\+\/g, " "\)/);
  assert.match(cfg, /arName = arName\.replace\(\/\\s\+\(19\|20\)\\d\{2\}\$\/, ""\);/);
});

test('library counts read «10 عروض مترجمة» up to ten and «11 عرض مترجم» from eleven (INCIDENTS #298)', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  const body = cfg.match(/addFilter\("arCount", (function\(n, one, two, few, many\) \{[\s\S]*?\n  \})\);/)![1];
  const arCount = new Function('return ' + body)();
  const w = ['عرض واحد مترجم', 'عرضان مترجمان', 'عروض مترجمة', 'عرض مترجم'];
  assert.equal(arCount(1, ...w), 'عرض واحد مترجم');
  assert.equal(arCount(2, ...w), 'عرضان مترجمان');
  assert.equal(arCount(3, ...w), '3 عروض مترجمة');
  assert.equal(arCount(10, ...w), '10 عروض مترجمة');
  assert.equal(arCount(11, ...w), '11 عرض مترجم');
  assert.equal(arCount(100, ...w), '100 عرض مترجم');
  assert.equal(arCount(103, ...w), '103 عروض مترجمة');
  for (const f of ['pages/library.njk', 'pages/library-program.njk']) assert.doesNotMatch(fs.readFileSync(f, 'utf-8'), /showsCount|عرضًا/, f);
});

test('new show pages go to the search engines, invisibly (INCIDENTS #302)', async () => {
  const m = await import('../scripts/seo-new-shows.ts');
  const today = new Date().toISOString().slice(0, 10);
  const xml = '<urlset><url><loc>https://arab-wrestling.com/shows/wwe-raw-05-10-2026/</loc><lastmod>' + today + '</lastmod></url>'
    + '<url>\n <loc>https://arab-wrestling.com/shows/old-show/</loc>\n <lastmod>2026-01-01</lastmod></url>'
    + '<url><loc>https://arab-wrestling.com/news/x/</loc></url><url><loc>https://arab-wrestling.com/shows/</loc></url></urlset>';
  const entries = m.parseSitemap(xml);
  assert.equal(entries.length, 4);
  const state: any = { pages: {} };
  // first run: only the last three days are sent, older pages are just remembered; news and section pages never
  assert.deepEqual(m.pagesToSend(entries, state), ['https://arab-wrestling.com/shows/wwe-raw-05-10-2026/']);
  assert.ok(state.pages['https://arab-wrestling.com/shows/old-show/']);
  // a known page goes again only when its lastmod moves
  state.pages['https://arab-wrestling.com/shows/wwe-raw-05-10-2026/'] = { firstSeen: today, lastmod: today };
  assert.deepEqual(m.pagesToSend(entries, state), []);
  // the IndexNow key is served at the site root
  assert.ok(fs.readFileSync('pages/indexnow-key.njk', 'utf-8').includes('permalink: /' + m.INDEXNOW_KEY + '.txt'));
  // search engines get every name of the program, in structured data only
  assert.match(layoutSource(), /"about": \{ "@type": "TVSeries"[^\n]*"alternateName"/);
  assert.match(fs.readFileSync('pages/library-program.njk', 'utf-8'), /\{% for item in lp\.items %\}/);
});

test('every watch server is played for real; one that fails twice is hidden until it plays (INCIDENTS #304)', async () => {
  const m = await import('../scripts/check-playback.ts');
  const ev = (o: any) => ({ mediaOk: [], mediaFail: [], playerErrors: [], frameText: '', progressed: false, ...o });
  // the Raw 05.10.2026 vidtube file: its stream server sent no CORS header
  assert.equal(m.classify(ev({ mediaFail: ['MissingAllowOriginHeader https://serv-stream-cdn44.cdn-video.xyz/hls2/x/master.m3u8'], frameText: 'This video file cannot be played.\n(Error Code: 232011)' })).status, 'broken');
  assert.equal(m.classify(ev({ playerErrors: ['JW Player Error 232011'] })).status, 'broken');
  assert.equal(m.classify(ev({ mediaOk: ['200 https://strm6.uqload.vc/hls2/x/master.m3u8'] })).status, 'ok');
  assert.equal(m.classify(ev({ progressed: true })).status, 'ok');
  // a bot check or no evidence never hides a server
  assert.equal(m.classify(ev({ frameText: 'Just a moment...', mediaFail: ['403 x.m3u8'] })).status, 'unknown');
  assert.equal(m.classify(ev({})).status, 'unknown');
  assert.ok(m.isMedia('https://ok6-8.vkuser.net/expires/1791389390015/clientType/0/x'));
  assert.ok(!m.isMedia('https://vidtube.one/dl?op=get_slides&url=https://img.cdn-video.xyz/a0000.jpg'));
  // two broken checks in a row hide it, one good check brings it back
  const u = 'https://vidtube.one/embed-dttpachdr7z2.html', page = 'https://arab-wrestling.com/shows/wwe-raw-05-10-2026/';
  const ok = (url: string) => ({ url, page, status: 'ok', reason: '' });
  const others = ['a', 'b', 'c', 'd'].map(x => ok(`https://h/${x}`));
  let s = m.nextState({ links: {}, broken: [] }, [{ url: u, page, status: 'broken', reason: 'x' }, ...others]);
  assert.deepEqual(s.broken, []);
  s = m.nextState(s, [{ url: u, page, status: 'broken', reason: 'x' }, ...others]);
  assert.deepEqual(s.broken, [u]);
  s = m.nextState(s, [ok(u)]);
  assert.deepEqual(s.broken, []);
  // a run where most links fail is the checker's own trouble: nothing changes
  const bad = ['a', 'b', 'c', 'd', 'e'].map(x => ({ url: `https://h/${x}`, page, status: 'broken', reason: '' }));
  assert.deepEqual(m.nextState(m.nextState({ links: {}, broken: [] }, bad), bad).broken, []);
  // the page hides only that one link, never every server
  const { playableServers } = (await import('../lib/embed.cjs')).default;
  const servers = [{ url: 'https://ok.ru/video/1' }, { url: 'https://vidtube.one/dttpachdr7z2.html' }];
  assert.deepEqual(playableServers(servers, {}, { broken: [u] }).map((x: any) => x.url), ['https://ok.ru/video/1']);
  assert.equal(playableServers([servers[1]], {}, { broken: [u] }).length, 1);
  assert.match(layoutSource(), /playableServers\(videoHosts, videoLinks\)/);
});

test('every scheduled workflow the round depends on has the Worker backstop trigger (INCIDENTS #305)', () => {
  const src = fs.readFileSync('worker/src/index.ts', 'utf-8');
  const block = src.slice(src.indexOf('async function runScheduleBackstopCron'), src.indexOf('async function runScheduleBackstopCron') + 3000);
  for (const wf of ['show-reel-monitor.yml', 'wrestlinginc-watcher.yml', 'ringsidenews-watcher.yml', 'seo-new-shows.yml', 'video-hosts.yml', 'search-console.yml']) {
    assert.ok(block.includes(`workflow: "${wf}"`), wf);
    assert.ok(fs.readFileSync(`.github/workflows/${wf}`, 'utf-8').includes('workflow_dispatch'), wf);
  }
});

test('the daily Search Console report is triggered once a UTC day after 05:40 (INCIDENTS #324)', async () => {
  const { dailyBackstopDue } = await import('../worker/src/index');
  const at = (s: string) => Date.parse(s);
  const after = 5 * 60 + 40;
  assert.equal(dailyBackstopDue(at('2026-10-07T05:30:00Z'), 0, after), false);
  assert.equal(dailyBackstopDue(at('2026-10-07T06:20:00Z'), at('2026-10-06T06:20:00Z'), after), true);
  assert.equal(dailyBackstopDue(at('2026-10-07T06:21:00Z'), at('2026-10-07T06:20:00Z'), after), false);
  assert.equal(dailyBackstopDue(at('2026-10-07T23:59:00Z'), at('2026-10-07T05:40:00Z'), after), false);
  assert.equal(dailyBackstopDue(at('2026-10-08T05:41:00Z'), at('2026-10-07T23:00:00Z'), after), true);
});

test('«تعلقت على» and broken «authority figure» / «WWE Manager» translations are fixed (INCIDENTS #308)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('تعلقت المصارعة تيفاني ستراتون على المقطع'), 'علّقت المصارعة تيفاني ستراتون على المقطع');
  assert.equal(applyCorrections('انضمت مسؤولة السلطة داريا ري'), 'انضمت إحدى شخصيات السلطة على الشاشة داريا ري');
  assert.equal(applyCorrections('مع تارا ريد وأل سابيينزا'), 'مع تارا ريد وآل سابينزا');
});

test('the show reels are linked into the build, not copied byte for byte (INCIDENTS #317)', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.doesNotMatch(cfg, /addPassthroughCopy\(\{\s*"dist\/videos"/);
  assert.match(cfg, /linkTree\("dist\/videos", "_site\/videos"\)/);
});

test('article pages load their styles and scripts from shared cached files (INCIDENTS #311)', () => {
  const tpl = fs.readFileSync('_includes/post-layout.njk', 'utf-8');
  assert.match(tpl, /<link rel="stylesheet" href="\{\{ asset\('\/assets\/post-layout\.css'\) \}\}">/);
  for (const f of ['post-player.js', 'post-theme.js']) assert.ok(tpl.includes(`<script src="{{ asset('/assets/${f}') }}"></script>`), f);
  // nothing big left inline: every article page used to repeat ~97 KB of the same CSS and JS
  const inlineCss = [...tpl.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
  assert.ok(inlineCss < 8000, String(inlineCss));
  // a changed file gets a new URL (/assets/* is cached for a year)
  assert.match(fs.readFileSync('eleventy.config.js', 'utf-8'), /addNunjucksGlobal\("asset", function\(url\)/);
});

test('the site builds from a «site» branch without the original pictures and reels, served by arw-media (INCIDENTS #312)', async () => {
  // the worker maps only the two folders, nothing else of the repo
  const { repoPathOf } = await import('../media-worker/src/index.ts');
  assert.equal(repoPathOf('/content/images/a%20b.jpg'), 'content/images/a b.jpg');
  assert.equal(repoPathOf('/videos/reel-x.mp4'), 'dist/videos/reel-x.mp4');
  assert.equal(repoPathOf('/content/images/../../package.json'), null);
  assert.equal(repoPathOf('/package.json'), null);
  assert.equal(repoPathOf('/content/images/'), null);
  // routes at the top of wrangler.toml (under [vars] they were read as a variable and never routed)
  const toml = fs.readFileSync('media-worker/wrangler.toml', 'utf-8');
  // routes before the first [table] (after one, TOML reads them as part of that table and nothing is routed)
  const firstTable = toml.search(/^\[/m);
  assert.ok(toml.indexOf('routes = [') > -1 && toml.indexOf('routes = [') < firstTable);
  // the bots upload through the workers.dev address, which wrangler turns off when routes are set (INCIDENTS #313)
  assert.ok(/^workers_dev = true$/m.test(toml) && toml.search(/^workers_dev/m) < firstTable);
  assert.match(fs.readFileSync('scripts/media-store.ts', 'utf-8'), /workers\.dev/);
  assert.match(toml, /^\[triggers\]\ncrons = \["17 \* \* \* \*"\]/m); // hourly: big pictures made small; 03:17 UTC: reel cleanup (INCIDENTS #372)
  const src = fs.readFileSync('media-worker/src/index.ts', 'utf-8');
  // the repo fallback is never cached at the edge: a cached copy refilled R2 with every deleted reel (INCIDENTS #313)
  assert.ok(!/cacheTtl: 86400/.test(src) && /fetch\(src, \{ cache: "no-store" \}\)/.test(src));
  // uploads only with a GitHub token that can write to the repo; reels leave R2 after 30 days (free tier for good)
  assert.match(src, /collaborators\?per_page=1/);
  assert.match(src, /\nconst REEL_DAYS = 30;/); // not exported: the Workers runtime refuses non-handler exports (INCIDENTS #369)
  // the build reuses resized pictures without their originals, and fetches an original only for a new picture
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.match(cfg, /const known = mapped\(decoded, "800jpeg"\);/);
  assert.match(cfg, /resolvedSource = await fetchOriginal\(decoded\)/);
  assert.match(cfg, /fs\.writeFileSync\("_site\/img-map\.json"/);
  // build.json names the main commit a «site» build was made from, so the panel's «ظهر على الموقع» still works
  assert.match(cfg, /match\(\/\^site-of: \(\[0-9a-f\]\{40\}\) \(\\d\+\)\$\/m\)/);
  // and how long each part of the build took, to find what still slows a save down (INCIDENTS #315)
  assert.match(cfg, /timing = \{ queueAndInstall: .*, restore: .*, eleventy: .*, node: .* \}/);
  // the build doesn't merge the bots' bookkeeping into every page, and compiles each Nunjucks template once
  assert.match(cfg, /BOOKKEEPING = \/\(\^\|\\\/\)_data\\\/\(deliveries\\\/\|publish-state/);
  assert.match(cfg, /addDataExtension\("json", \{ parser: \(text, file\) => \(BOOKKEEPING\.test/);
  assert.match(cfg, /eleventyConfig\.on\("eleventy\.engine\.njk"/);
  // …and no page reads that bookkeeping: if one ever needs it, it must come out of BOOKKEEPING first
  const tpl = ['pages', '_includes'].flatMap(d => fs.readdirSync(d).map(f => fs.readFileSync(`${d}/${f}`, 'utf-8'))).join('\n') + fs.readFileSync('index.njk', 'utf-8');
  assert.ok(!/\bdeliveries\b|publish-state|duplicate-skips|show-reel-state/.test(tpl));
  // «site» follows main after the bots too: their pushes (GITHUB_TOKEN) start no push-triggered workflow
  const wf = fs.readFileSync('.github/workflows/site-branch.yml', 'utf-8');
  for (const name of ['Fightful News Auto Watcher', 'Ringside News Auto Watcher', 'Wrestling Inc Auto Watcher']) assert.ok(wf.includes(`- ${name}`), name);
  // the bots' news is gathered (at most one Cloudflare build every 4 minutes); a push or a panel save never waits (INCIDENTS #315)
  const gather = wf.slice(wf.indexOf("- name: Gather what was saved while Cloudflare builds"), wf.indexOf('- name: Point «site» at the latest main'));
  assert.ok(gather.length > 200, 'the gathering step is there');
  assert.match(gather, /if: github\.event_name != 'workflow_dispatch'/);
  assert.match(gather, /grep -qE 'لوحة التحكم\|\^\(Create\|Update\|Delete\) '/);
  assert.match(gather, /BATCH: '240'/);
  // panel saves too: «site» never moves while Cloudflare still builds the last version, so it never queues builds
  // (INCIDENTS #343) — and a save goes out the moment that build is done, not a fixed 2.5 minutes later (INCIDENTS #352)
  assert.match(wf, /checks: read/);
  assert.match(gather, /GAP=0 /);
  assert.match(gather, /commits\/\$SITE\/check-runs\?check_name=Cloudflare%20Pages/);
  assert.match(gather, /BUSY_MAX: '300'/);
  assert.ok(!/MIN_GAP/.test(wf));
  assert.match(gather, /\[ "\$EVENT" = "push" \]/);
  assert.match(wf, /cancel-in-progress: true/);
  assert.match(wf, /cron: '\*\/10 \* \* \* \*'/);
  assert.match(wf, /MAIN=\$\(api "\$BASE\/ref\/heads\/main"/);
  for (const f of ['fightful-watcher.yml', 'ringsidenews-watcher.yml', 'wrestlinginc-watcher.yml']) {
    const name = fs.readFileSync(`.github/workflows/${f}`, 'utf-8').match(/^name: (.+)$/m)![1].trim();
    assert.ok(wf.includes(`- ${name}`), `site-branch.yml must list «${name}»`);
  }
});

test('pictures and reels go to R2, not the repo; a reel leaves R2 once posted everywhere (INCIDENTS #313)', async () => {
  const m = await import('../scripts/media-store.ts');
  assert.equal(m.publicPath('content/images/a b.jpg'), '/content/images/a b.jpg');
  assert.equal(m.publicPath('dist/videos/reel-x.mp4'), '/videos/reel-x.mp4');
  assert.equal(m.publicPath('dist/videos/manifest.json'), null);
  assert.equal(m.publicPath('content/news/x.md'), null);
  // the repo holds no picture or reel: one deleted from R2 can't come back from GitHub, and the repo stops growing
  const ignore = fs.readFileSync('.gitignore', 'utf-8').split('\n').map(l => l.trim());
  assert.ok(ignore.lastIndexOf('content/images/') > -1 && ignore.lastIndexOf('dist/videos/*.mp4') > ignore.lastIndexOf('!dist/videos/**'));
  // «site» drops only the folders main still has (GitHub refuses to drop a missing one)
  assert.match(fs.readFileSync('.github/workflows/site-branch.yml', 'utf-8'), /if \[ "\$DROP" = "\[\]" \]; then TREE=\$ROOT/);
  // every bot that writes pictures stores them before it commits; the reel bots commit only the JSON
  for (const f of ['fightful-watcher', 'ringsidenews-watcher', 'wrestlinginc-watcher', 'editorial-maintenance', 'auto-show-reel', 'generate-reel']) {
    const wf = fs.readFileSync(`.github/workflows/${f}.yml`, 'utf-8');
    const step = wf.slice(wf.indexOf('npx tsx scripts/media-store.ts sync'));
    assert.ok(wf.includes('npx tsx scripts/media-store.ts sync'), f);
    assert.ok(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/.test(wf), `${f} gives the token`);
    if (f.includes('reel')) assert.match(step, /git add -f dist\/videos\/\*\.json/, f);
    else assert.ok(step.indexOf('npx tsx scripts/media-store.ts sync') < step.indexOf('git add -A'), f);
  }
  // reels are posted from the site's /videos/ (R2) and removed two hours after the last platform
  const mon = await import('../scripts/show-reel-monitor.ts');
  const done = { facebook_reel: true, facebook_story: true, instagram_reel: true, instagram_story: true, tiktok: false, publishedAt: Date.now() - 3 * 3600_000 } as any;
  assert.equal(mon.reelDone(done, Date.now(), false), true);
  assert.equal(mon.reelDone({ ...done, publishedAt: Date.now() - 600_000 }, Date.now(), false), false);
  assert.equal(mon.reelDone({ ...done, instagram_story: false }, Date.now(), false), false);
  assert.equal(mon.reelDone({ ...done, mediaDeleted: true }, Date.now(), false), false);
  assert.doesNotMatch(fs.readFileSync('scripts/show-reel-monitor.ts', 'utf-8'), /raw\.githubusercontent\.com/);
  assert.doesNotMatch(fs.readFileSync('scripts/auto-publish-reel.ts', 'utf-8'), /raw\.githubusercontent\.com/);
  // the manifest remembers every rendered reel, so none is rendered twice once the files are gone
  assert.match(fs.readFileSync('scripts/generate-news-video.ts', 'utf-8'), /JSON\.parse\(fs\.readFileSync\(path\.join\(OUT_DIR, 'manifest\.json'\)/);
  // the panel puts a picture straight into R2
  assert.match(fs.readFileSync('worker/src/studio.ts', 'utf-8'), /await env\.MEDIA\.put\(img\.path, bytes/);
  assert.match(fs.readFileSync('worker/wrangler.toml', 'utf-8'), /binding = "MEDIA"\nbucket_name = "arw-media"/);
});

test('a reel posted on Facebook and Instagram leaves R2; one still being posted stays (INCIDENTS #313)', async () => {
  const { reelsToRemove } = await import('../scripts/media-store.ts');
  const posted = { facebook_reel: true, facebook_story: true, instagram_reel: true, instagram_story: true };
  const now = Date.parse('2026-10-07T12:00:00Z');
  const manifest = [
    { filename: 'reel-20261005-raw.mp4', mtime: now - 86400_000 },
    { filename: 'reel-20261006-nxt.mp4', mtime: now - 600_000 },
    { filename: 'reel-news-old.mp4', mtime: now - 7 * 3600_000 },
    { filename: 'reel-news-new.mp4', mtime: now - 3600_000 },
    { filename: 'reel-20260918-stuck.mp4', mtime: now - 19 * 86400_000 },
  ];
  const state = { '20261005-raw': posted, '20261006-nxt': { ...posted, instagram_story: false }, '20260918-stuck': { facebook_reel: true } };
  assert.deepEqual(reelsToRemove(manifest, state, now).sort(), ['reel-20260918-stuck.mp4', 'reel-20261005-raw.mp4', 'reel-news-old.mp4']);
  assert.match(fs.readFileSync('.github/workflows/media-cleanup.yml', 'utf-8'), /npx tsx scripts\/media-store\.ts prune-reels/);
  // arw-media deletes only for a key that can write the repo: a read-only cleanup removed nothing (INCIDENTS #313)
  for (const f of ['media-cleanup', 'show-reel-monitor']) assert.match(fs.readFileSync(`.github/workflows/${f}.yml`, 'utf-8'), /^  contents: write/m, f);
});

test('a stray tatweel inside a word is removed, joined prefixes keep it; «وون» and «اسطوانات» fixed (INCIDENTS #330)', async () => {
  const { autoFix, applyCorrections } = await import('../scripts/news-qa');
  assert.equal(autoFix('أبعده مؤقـتا عن الشاشة ولم يعلن رسميـا عن عودته'), 'أبعده مؤقتا عن الشاشة ولم يعلن رسميا عن عودته');
  assert.equal(autoFix('أشاد بـرومان رينز ولـسامي زين وبـكودي'), 'أشاد بـرومان رينز ولـسامي زين وبـكودي');
  assert.equal(applyCorrections('لمواجهة الثنائي ذا ميز وون جون موريسون'), 'لمواجهة الثنائي ذا ميز وجون موريسون');
  assert.equal(applyCorrections('الحاصل على عدة اسطوانات بلاتينية'), 'الحاصل على عدة أسطوانات بلاتينية');
});

test('«basic legends deal» is a plain legends contract, not «عقدا أساسيا» (INCIDENTS #320)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('كشف عن توقيعه عقدا أساسيا مع WWE ضمن فئة الأساطير، وذلك'), 'كشف عن توقيعه عقد أساطير عاديا مع WWE، وذلك');
  assert.equal(applyCorrections('وقع عقدا أساسيا ضمن فئة الأساطير'), 'وقع عقد أساطير عاديا');
});

test('«Trios title battle» is a fight over the trios titles, not «عداوة الثلاثي» (INCIDENTS #322)', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('استمرار عداوة الثلاثي بين سويرف ستريكلاند وآدم بيدج'), 'استمرار صراع ألقاب الثلاثي بين سويرف ستريكلاند وآدم بيدج');
});

test('a show page lists its program as cards (a show with its own name by that name); «ذات صلة» is news only, picked by shared names and the days around the page (INCIDENTS #330, #332)', async () => {
  // the config's own helpers, read through a stand-in eleventyConfig that records them
  const got: Record<string, any> = {};
  const stub: any = new Proxy({}, { get: (_t, k: string) => (k === 'addFilter' || k === 'addNunjucksFilter' || k === 'addNunjucksGlobal') ? (name: string, fn: any) => { got[name] = fn; } : () => stub });
  const { createRequire } = await import('module');
  createRequire(import.meta.url)('../eleventy.config.js')(stub);
  const related = got.getRelatedPosts, nav = got.getEpisodeNav;
  const d = (s: string) => new Date(s + 'T03:00:00Z');
  const item = (url: string, tags: string[], date: string, extra = {}) => ({ url, date: d(date), data: { tags, federation: 'WWE', date: d(date), ...extra } });
  const all = [
    item('/shows/raw-21/', ['WWE', 'RAW'], '2026-09-22'),
    item('/news/old-roman/', ['WWE', 'رومان رينز'], '2026-06-01'),
    item('/news/week-roman/', ['WWE', 'رومان رينز'], '2026-09-23'),
    item('/news/week-other/', ['WWE'], '2026-09-22'),
    item('/news/aew/', ['AEW'], '2026-09-22', { federation: 'AEW' }),
  ];
  const urls = related('/shows/raw-28/', ['WWE', 'RAW', 'رومان رينز'], 'WWE', all, 4, 'WWE RAW', '2026-09-22').map((x: any) => x.url);
  assert.deepEqual(urls, ['/news/week-roman/', '/news/week-other/', '/news/old-roman/']); // no show, nothing from another federation; that week first
  // the cards: the show being watched first, then the ones before it, at most 8; the next one on its own
  const eps = Array.from({ length: 10 }, (_, i) => ({ url: `/shows/raw-${i}/`, day: i + 1, month: 9, year: 2026, headline: `عرض الرو ${String(i + 1).padStart(2, '0')}.09.2026 مترجم` }));
  const programs = [{ slug: 'wwe-raw', name: 'WWE RAW', episodes: eps, seasons: [{ number: 2026, type: 'year', episodes: eps }] }];
  const n = nav('WWE RAW', '/shows/raw-8/', programs);
  // the program's latest eight, the same on every one of its pages
  assert.deepEqual(n.recent.map((e: any) => e.url), ['/shows/raw-9/', '/shows/raw-8/', '/shows/raw-7/', '/shows/raw-6/', '/shows/raw-5/', '/shows/raw-4/', '/shows/raw-3/', '/shows/raw-2/']);
  const first = nav('WWE RAW', '/shows/raw-0/', programs);
  assert.deepEqual(first.recent.map((e: any) => e.url), n.recent.map((e: any) => e.url));
  assert.equal(first.nextCard, undefined);
  assert.equal(n.recent[1].weekday, 'الأربعاء'); // 9 September 2026, under the date instead of the program's name again
  assert.equal(n.recent[1].dayLabel, '9 سبتمبر');
  assert.equal(n.recent[0].kindLabel, 'عرض الرو');
  assert.equal(n.libraryHref, '/library/wwe-raw/');
  assert.equal(n.recent[0].named, false); // a weekly show: its date
  // the owner picks it per show in the panel («طريقة ظهوره في قائمة العروض»): by its English title, or by its date
  const tour = [
    { url: '/shows/n1/', day: 9, month: 9, year: 2026, headline: 'عرض ان جيه بي دبليو 09.09.2026 مترجم' },
    { url: '/shows/n2/', day: 13, month: 9, year: 2026, headline: 'عرض ان جيه بي دبليو 13.09.2026 مترجم' },
    { url: '/shows/kobe/', day: 27, month: 9, year: 2026, cardTitle: 'name', title: 'NJPW Destruction in Kobe (2026)', headline: 'عرض ان جيه بي دبليو ديستروكشن ان كوبي 27.09.2026 مترجم' },
  ];
  const k = nav('NJPW', '/shows/kobe/', [{ slug: 'njpw', name: 'NJPW', episodes: tour, seasons: [{ number: 2026, type: 'year', episodes: tour }] }]);
  assert.deepEqual(k.recent.map((e: any) => e.named), [true, false, false]);
  assert.equal(k.recent[0].fullName, 'NJPW Destruction in Kobe (2026)'); // its English title, in full (the owner went back to it)
  assert.equal(k.recent[0].hasDateInName, false);
  // a programme's episodes: «الحلقة الأولى»… by number, the English title under it
  const eps2 = [1, 2, 11, 21, 30].map(e => ({ url: `/shows/p${e}/`, episodeLabel: String(e), groupKey: 2, title: `Dark Side Of The Cage S02E${e}` }));
  const pn = nav('Dark Side Of The Cage', '/shows/p1/', [{ slug: 'dsotc', name: 'Dark Side Of The Cage', episodes: eps2, seasons: [{ number: 2, type: 'season', episodes: eps2 }] }]);
  assert.deepEqual(pn.recent.map((e: any) => e.episodeWords), ['الحلقة الثلاثون', 'الحلقة الحادية والعشرون', 'الحلقة الحادية عشرة', 'الحلقة الثانية', 'الحلقة الأولى']);
  assert.equal(k.programKind, 'عرض ان جيه بي دبليو'); // the heading and the button name the program, not Kobe
  assert.equal(n.programKind, 'عرض الرو');
  const tpl = fs.readFileSync('_includes/post-layout.njk', 'utf-8');
  assert.match(tpl, /\{% if isSeries and not isNostalgiaItem %\}\s*<span class="sx-date">\{\{ ep\.episodeWords \}\}<\/span>/);
  assert.ok(!/episodes-search|ep-pill|آخر 8/.test(tpl), 'the date buttons, the search and the «آخر 8» label are gone');
  assert.ok(!tpl.includes('أخبار وعروض ذات صلة'));
  // under a date, the show's English title in full; the choice is in the panel
  assert.match(tpl, /<span class="sx-meta sx-meta-en"><bdi>\{\{ ep\.title or ep\.year \}\}<\/bdi><\/span>/);
  const editor = fs.readFileSync('studio/js/views/editor.js', 'utf-8');
  assert.match(editor, /data-seg="card_title"/);
  assert.match(editor, /\['date', 'بالتاريخ'\], \['name', 'بالاسم الإنجليزي'\]/);
  assert.match(fs.readFileSync('content/shows/20260928043800-njpw-destruction-in-kobe-2026.md', 'utf-8'), /^card_title: name$/m);
  assert.ok(/جميع \{\{ "ملخصات" if isRecap else nounPlural \}\} \{\{ nav\.program\.name \}\}/.test(tpl) && !/[>}]كل \{\{/.test(tpl), '«جميع عروض WWE RAW»: Fusha, and the library\'s name');
  // small 480px pictures on the cards, not the 800px ones
  assert.ok(!/optImg (nx\.image|ep\.image|rThumb)/.test(tpl) && /optCard ep\.image/.test(tpl) && /optCard rThumb/.test(tpl));
});

test('Kevin Owens on PAC: one speaker, two genders — «مشيرا … موضحة أنه» (INCIDENTS #345)', () => {
  assert.ok(checkArticle('كيفن أوينز يؤكد أن باك هو أفضل مصارع عمل معه', 'استرجع أوينز ذكرياته، مشيرا إلى أن نزالهما كشف له قدرات فريدة، موضحة أنه كان يتقن الأداء الهوائي.', []).some(i => i.code === 'mixed_haal_gender'));
  assert.ok(!checkArticle('كيفن أوينز يؤكد أن باك هو أفضل مصارع عمل معه', 'قال ناش ذلك، موضحا أنه لا يملك معلومات مؤكدة حول الأمر.', []).some(i => i.code === 'mixed_haal_gender'));
  assert.equal(applyCorrections('ووصفها بأنها قطعة تنظيمية مميزة.'), 'ووصفها بأنها نموذج مميز في كتابة القصص.');
  assert.equal(applyCorrections('مدى إعجاب حب زملائه له'), 'مدى حب زملائه له وإعجابهم به');
});

test('the source\'s own pictures in its text: not the cover again, not a logo, avatar, ad, icon or a post\'s preview (INCIDENTS #359)', () => {
  const u = 'https://www.ringsidenews.com/wp-content/uploads/2026/10/fishman';
  const ringside = `<img width="800" height="500" src="${u}-01.jpg?x71178" class="attachment-post-thumbnail">`
    + `<p>Text</p><img decoding="async" width="600" height="449" src="${u}-37.jpg?x71178" alt="An iconic moment">`
    + `<img width="518" height="1024" src="${u}-55-518x1024.jpg?x71178" srcset="${u}-55-518x1024.jpg 518w, ${u}-55.jpg 1036w">`
    + `<img src="https://secure.gravatar.com/avatar/x.jpg"><img width="40" height="40" src="${u}-tiny.jpg">`
    + `<img src="https://example.com/ads/banner.jpg"><img src="https://i.ytimg.com/vi/abc/hqdefault.jpg">`
    + `<blockquote class="twitter-tweet"><img src="https://pbs.twimg.com/media/x.jpg"></blockquote>`;
  assert.deepEqual(extractBodyImages(ringside, `${u}-01.jpg?x71178`), [`${u}-37.jpg?x71178`, `${u}-55.jpg`]);
  // the same picture in another size is the same picture
  assert.deepEqual(extractBodyImages(`<img src="${u}-01-300x200.jpg">`, `${u}-01.jpg`), []);
  assert.equal(extractBodyImages(Array.from({ length: 9 }, (_, i) => `<img src="${u}-${i}.jpg">`).join('')).length, 4);
});

test('posts and videos are found the way each source writes them', () => {
  const html = '<blockquote class="twitter-tweet"><a href="https://twitter.com/WWE/status/111?ref_src=twsrc%5Etfw">x</a></blockquote>'
    + '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>'
    + '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/AbC_1/?utm=1"></blockquote>'
    + '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@wwe/video/999"></blockquote>'
    + '<a href="https://x.com/wwe/status/111">same tweet again</a>';
  assert.deepEqual(extractEmbeds(html), ['https://www.youtube.com/watch?v=abcdefghijk', 'https://x.com/WWE/status/111', 'https://www.instagram.com/p/AbC_1/', 'https://www.tiktok.com/@wwe/video/999']);
  // Facebook: the embed frame's encoded address, the SDK's data-href, a plain post link — never a page link
  const fb = '<iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2FWWE%2Fposts%2Fpfbid0abc123&amp;show_text=true"></iframe>'
    + '<div class="fb-video" data-href="https://www.facebook.com/AEW/videos/123456/"></div>'
    + '<p>Follow <a href="https://www.facebook.com/WWE">WWE on Facebook</a></p>'
    + '<a href="https://m.facebook.com/reel/987654">reel</a>';
  assert.deepEqual(extractEmbeds(fb), ['https://www.facebook.com/WWE/posts/pfbid0abc123', 'https://www.facebook.com/AEW/videos/123456', 'https://www.facebook.com/reel/987654']);
});

test('the Worker sees a new Ringside News / Wrestling Inc story from the newest item of the feed (INCIDENTS #361)', () => {
  const feed = (guid: string) => `<rss><channel><title>x</title><link>https://site/</link><item><title>A</title><link>https://site/a/</link><guid isPermaLink="false">${guid}</guid></item><item><guid>old</guid></item></channel></rss>`;
  assert.equal(newestFeedItem(feed('https://www.ringsidenews.com/?p=802252254')), 'https://www.ringsidenews.com/?p=802252254');
  assert.equal(newestFeedItem(feed('<![CDATA[ abc-123 ]]>')), 'abc-123');
  assert.equal(newestFeedItem('<rss><item><title>B</title><link>https://site/b/</link></item></rss>'), 'https://site/b/'); // no guid: the link
  assert.equal(newestFeedItem('<html>blocked</html>'), '');
});

test('each new show page: every query people use, and the ones where it is not in the first 3 (INCIDENTS #365)', async () => {
  const m = await import('../scripts/seo-new-shows.ts');
  const page = 'https://arab-wrestling.com/shows/raw-06-10-2026/';
  const rows = [
    { keys: [page, 'عرض الرو 06.10.2026 مترجم'], clicks: 4, impressions: 40, position: 1.4 },
    { keys: [page, 'raw 6/10/2026'], clicks: 0, impressions: 12, position: 7.26 },
    { keys: [page, 'رو مترجم'], clicks: 0, impressions: 2, position: 9 },
    { keys: ['https://arab-wrestling.com/shows/old/', 'x'], clicks: 1, impressions: 99, position: 1 },
  ];
  const by = m.queriesByPage(rows, [page]);
  assert.deepEqual(Object.keys(by), [page]); // only the tracked pages
  assert.deepEqual(by[page].map((x: any) => x.q), ['عرض الرو 06.10.2026 مترجم', 'raw 6/10/2026', 'رو مترجم']); // most seen first
  assert.equal(by[page][1].position, 7.3);
  // a query used 3 times or more, below the first 3, is work for the round; one seen twice is noise
  assert.deepEqual(m.weakQueries(by[page]).map((x: any) => x.q), ['raw 6/10/2026']);
});

test('ageNotInSource: an age the source never states is flagged (Dawn Marie 66 vs 56)', async () => {
  const { ageNotInSource, spelledAgesToDigits } = await import('../scripts/news-qa');
  const body = spelledAgesToDigits('بينما تقترب من عامها السادس والستين');
  assert.equal(body, 'بينما تقترب من عامها الـ66');
  assert.deepEqual(ageNotInSource(body, 'as she approaches 56 years old'), ['66']);
  assert.deepEqual(ageNotInSource(body, 'she turns 66'), []);
});

test('checkArticle blocks the misspellings «مبنا» and «التمرينا» (INCIDENTS #342)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const issues = checkArticle('تشاد غيبل يكشف عن صداقة غير متوقعة مع سي ام بانك', 'قال مبنا أن العلاقة قوية. غير طريقته في التمرينا اليومية.');
  assert.ok(issues.filter(i => i.code === 'known_wrong').length >= 2);
});

test('a picture at the size a page asks for: a few fixed widths, made on request from the one original (INCIDENTS #369)', async () => {
  const { widthFor } = await import('../media-worker/src/sizes.ts');
  assert.equal(widthFor('480'), 480);
  assert.equal(widthFor('500'), 640); // the next size up
  assert.equal(widthFor('99999'), 1200); // never larger than the largest
  assert.equal(widthFor(''), null);
  assert.equal(widthFor('abc'), null);
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  // the site's own pictures are asked at a size, never resized into files of the deployment
  assert.match(cfg, /if \(SIZED_RE\.test\(decoded\)\) return sizedUrl\(decoded, 800\);/);
  assert.match(cfg, /if \(SIZED_RE\.test\(rel\)\) return sizedUrl\(rel, 480\);/);
  const toml = fs.readFileSync('media-worker/wrangler.toml', 'utf-8');
  assert.match(toml, /pattern = "arab-wrestling\.com\/img\/\*"/); // the old resized copies' addresses keep working
});

test('a medical outcome is new news, never a copy of the surgery story (INCIDENTS #371)', async () => {
  const { newMedicalOutcome } = await import('../scripts/editorial.ts');
  const surgery = { title: 'جيم روس يخضع لجراحة ثانية', body: 'خضع جيم روس لعملية جراحية ثانية في المستشفى.' };
  assert.ok(newMedicalOutcome({ title: 'جيم روس يتعافى بعد نجاح جراحته الثانية' }, surgery));
  assert.ok(newMedicalOutcome({ title: 'جيم روس يغادر المستشفى' }, surgery));
  assert.equal(newMedicalOutcome({ title: 'جيم روس يخضع لجراحة ثانية في الورك' }, surgery), null); // no outcome: same story
  assert.equal(newMedicalOutcome({ title: 'جيم روس يتعافى' }, { title: 'جيم روس يتعافى بعد الجراحة', body: '' }), null); // the outcome was already out
  assert.equal(newMedicalOutcome({ title: 'كودي رودز يتعافى من خسارته' }, { title: 'كودي رودز يخسر اللقب', body: 'خسر في النزال.' }), null); // not medical
});

test('pictures are shrunk by exact area averaging, never enlarged (INCIDENTS #372)', async () => {
  const { downscale } = await import('../media-worker/src/downscale.ts');
  // 4×2 picture: left half black, right half white → 2×1: one black pixel, one white
  const data = new Uint8ClampedArray(4 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) { const p = (y * 4 + x) * 4, v = x < 2 ? 0 : 255; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255; }
  const out = downscale({ width: 4, height: 2, data }, 2, 1);
  assert.deepEqual([out.width, out.height], [2, 1]);
  assert.deepEqual([...out.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  // 3 → 2 columns: the middle pixel is shared half and half
  const d3 = new Uint8ClampedArray([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255]);
  const o3 = downscale({ width: 3, height: 1, data: d3 }, 2, 1);
  assert.deepEqual([...o3.data], [30, 30, 30, 255, 150, 150, 150, 255]);
  const same = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  assert.equal(downscale(same, 4, 4), same); // never enlarged
});

test('Shorty G is never translated as «القصير»', async () => {
  const { applyCorrections } = await import('../scripts/news-qa');
  assert.equal(applyCorrections('فترة أدائه بشخصية القصير'), 'فترة أدائه بشخصية شورتي جي');
  assert.equal(applyCorrections('تلك شخصية القصير'), 'تلك شخصية شورتي جي');
});

test('pages stay light: small site icons, lazy homepage thumbnails, slider pictures on demand, fonts not render-blocking', () => {
  // the icons every page asks for were the full 1024px logo (~1.8 MB per visit)
  assert.ok(fs.statSync('favicon.png').size < 40_000);
  assert.ok(fs.statSync('favicon.svg').size < 20_000);
  const home = fs.readFileSync('index.njk', 'utf8');
  // background-image thumbnails never lazy-load: every card picture downloaded on page open
  assert.doesNotMatch(home, /class="(?:show|news)-thumb[^"]*" style="background-image/);
  assert.match(home, /<img class="thumb-img" src="\{% optImg item\.data\.image, '\/favicon\.png\?v=3' %\}"[^>]*loading="lazy"/);
  assert.match(home, /\{% if loop\.index0 < 2 %\}src\{% else %\}data-src\{% endif %\}/);
  assert.match(home, /function loadSlideImg\(i\)/);
  assert.doesNotMatch(home, /url\('https:\/\/i\.ibb\.co/);
  for (const f of ['index.njk', '_includes/post-layout.njk', 'pages/news.njk']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /<link href="https:\/\/fonts\.googleapis\.com[^"]+" rel="stylesheet">/, f);
  }
});

test('an English quote block inside an Arabic story is blocked, translated ones and short names pass', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const codes = (body: string) => checkArticle('عنوان واضح', body, []).map((i: any) => i.code);
  assert.ok(codes('خبر عادي.\n\n> Tonight was my final match on WWE EVOLVE. I am grateful it was against you').includes('english_quote'));
  assert.ok(codes('خبر عادي.\n\n> "Sure. I\'ve had coaches my whole life, with أندرتيكر in AAA and more"').includes('english_quote'));
  assert.ok(!codes('خبر عادي.\n\n> "كانت الليلة آخر نزال لي في WWE EVOLVE على Tubi"').includes('english_quote'));
  assert.ok(!codes('خبر عادي عن WWE Money In The Bank Ladder Match هذا الأسبوع.').includes('english_quote'));
});

test('watcher gives the slot back when a story is not readable yet, so it cannot starve newer ones (#378)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'worker/src/index.ts'), 'utf8');
  assert.match(src, /if \(!verify\.ok\) \{ platformAttempts = Math\.max\(0, platformAttempts - 1\); continue; \}/);
});

test('style guide tells Gemini to keep venue names as in the source and not repeat the city', () => {
  const g = fs.readFileSync(path.join(process.cwd(), 'editorial/style-guide.md'), 'utf8');
  assert.match(g, /اسم المكان كما في المصدر ومرة واحدة/);
});

test('dual forms are banned in the style guide and Kiera Hogan has one spelling (#382)', () => {
  const g = fs.readFileSync(path.join(process.cwd(), 'editorial/style-guide.md'), 'utf8');
  assert.match(g, /لا مثنى أبدا/);
  const names = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/wrestler-names.json'), 'utf8'));
  assert.equal(names['Kiera Hogan'], 'كيرا هوجان');
});

test('Allie has one spelling «آلي» and «ألي وكيرا هوجان» is auto-corrected (#383)', () => {
  const names = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/wrestler-names.json'), 'utf8'));
  assert.equal(names['Allie'], 'آلي');
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  const r = c.find((x: any) => x.right === 'آلي');
  assert.ok(r && new RegExp(r.wrong).test('ألي وكيرا هوجان') && !new RegExp(r.wrong).test('ألي كاتش'));
});

test('Trey Miguel and Elayna Black have one spelling each and variants are auto-corrected (#384)', () => {
  const names = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/wrestler-names.json'), 'utf8'));
  assert.equal(names['Trey Miguel'], 'تراي ميجيل');
  assert.equal(names['Elayna Black'], 'إيلينا بلاك');
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  const t = c.find((x: any) => x.right === 'تراي ميجيل');
  assert.ok(t && new RegExp(t.wrong).test('تري ميغيل') && new RegExp(t.wrong).test('تري ميجيل'));
  assert.ok(c.some((x: any) => x.wrong === 'إلينا بلاك' && x.right === 'إيلينا بلاك'));
});

test('English names are fixed before an English story is saved (#385)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('M By Elegance beat Elayna Black'), 'Ash By Elegance beat Elayna Black');
});

test('a server\'s own fullscreen never goes black: no page-to-page view transition, no layer effects under a fullscreen player (INCIDENTS #386)', () => {
  const motion = fs.readFileSync('assets/motion.css', 'utf8');
  assert.match(motion, /^@view-transition \{ navigation: none; \}/m);
  assert.doesNotMatch(motion, /navigation: auto|view-transition-name/);
  assert.match(fs.readFileSync('_includes/theme-init.njk', 'utf8'), /motion\.css\?v=20261009/);
  const player = fs.readFileSync('assets/post-player.js', 'utf8');
  assert.match(player, /document\.addEventListener\('fullscreenchange', sync\)/);
  assert.match(player, /root\.classList\.toggle\('arw-fs', !!fs\)/);
  assert.match(fs.readFileSync('assets/post-layout.css', 'utf8'), /html\.arw-fs body \*:not\(iframe\):not\(video\)\{ transform:none !important; filter:none !important; backdrop-filter:none !important/);
});

test('Louisiana, «وقتها» and the wine company have fixed spellings and no story keeps the wrong ones (#387)', () => {
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  for (const [wrong, right] of [['لزيانا', 'لويزيانا'], ['وقتتها', 'وقتها'], ['شركة المضارب', 'شركة النبيذ']]) {
    assert.ok(c.find((x: any) => x.wrong === wrong && x.right === right), wrong);
  }
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/لزيانا|وقتتها|شركة المضارب/.test(t), f);
  }
});

test('«تأكيد ولاءه» is corrected to «تأكيد ولائه» and the Bagwell story names Randy Savage (#388)', () => {
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  assert.ok(c.find((x: any) => x.wrong === 'تأكيد ولاءه' && x.right === 'تأكيد ولائه'));
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/تأكيد ولاءه/.test(t), f);
    if (f.startsWith('20261009120512-')) assert.ok(!/راندي أورتن/.test(t), f);
  }
});

test('«اختارث» is corrected to «اختارت» and no story has it (#389)', () => {
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  assert.ok(c.find((x: any) => x.wrong === 'اختارث' && x.right === 'اختارت'));
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/اختارث/.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});

test('«بخن حماس» is corrected to «بكل حماس» and no story has it (#390)', () => {
  const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8')).corrections;
  assert.ok(c.find((x: any) => x.wrong === 'بخن حماس' && x.right === 'بكل حماس'));
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/بخن حماس/.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});

test('«التأثير المؤثر» and dual verbs after «الثنائي» are auto-corrected (#391)', () => {
  assert.equal(applyCorrections('لمشاهدة فيديو التأثير المؤثر'), 'لمشاهدة فيديو التكريم المؤثر');
  assert.equal(applyCorrections('أن الثنائي سيشاركان في عرض'), 'أن الثنائي سيشارك في عرض');
});

test('«حركة إثبات تحت الذراع» is corrected to «حركة بايل درايفر» and no story has it (#392)', () => {
  assert.equal(applyCorrections('تلقيه حركة إثبات تحت الذراع خلال نزالهما'), 'تلقيه حركة بايل درايفر خلال نزالهما');
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/حركة إثبات تحت الذراع/.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});

test('dual forms (مثنى) are blocked (INCIDENTS #393)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const codes = (title: string, body: string) => checkArticle(title, body, []).map(i => i.code);
  const filler = ' وهذا نص إضافي طويل بما يكفي لتجاوز حد الطول الأدنى للنص.'.repeat(6);
  assert.ok(codes('دان ريد: توني خان واتحاد AEW قدما دعما رائعا لاتحاد EVE', filler).includes('dual_form'));
  assert.ok(codes('عنوان عربي كامل للخبر هنا', 'الثنائي، اللذان اشتهرا بالشخصية واصلا العمل.' + filler).includes('dual_form'));
  assert.ok(!codes('عنوان عربي كامل للخبر هنا', 'يجب المضي قدما في الخطة والثنائي واصل العمل.' + filler).includes('dual_form'));
  // more dual forms found later (INCIDENTS #396)
  assert.ok(codes('أليكسا بليس وتايتوم باكسلي تفوزان ببطولة WWE للفرق للسيدات', filler).includes('dual_form'));
  assert.ok(codes('عنوان عربي كامل للخبر هنا', 'هزمتا حاملتي اللقب لتتوجا بطلتين جديدتين.' + filler).includes('dual_form'));
  assert.ok(codes('نيك وراين يحتفظان بألقاب الفرق في عرض TNA', filler).includes('dual_form'));
  assert.ok(!codes('عنوان عربي كامل للخبر هنا', 'الفريق يحتفظ بالحزام وتحتفظ بطلة العالم بلقبها.' + filler).includes('dual_form'));
});

test('doubled quote marks around «» are blocked (INCIDENTS #394)', () => {
  const pad = ' وهذا نص إضافي طويل لتجاوز الحد الأدنى لطول الخبر في المدقق الآلي.'.repeat(5);
  const bad = checkArticle('داربي ألين يشارك صورة من مون بلان', 'نشر الصورة معلقا عليها بقوله: "«من الجيد العودة إلى الجبال مجددا»".' + pad);
  assert.ok(bad.some(i => i.code === 'doubled_quote_marks'));
  const good = checkArticle('داربي ألين يشارك صورة من مون بلان', 'نشر الصورة معلقا عليها بقوله: «من الجيد العودة إلى الجبال مجددا».' + pad);
  assert.ok(!good.some(i => i.code === 'doubled_quote_marks'));
});

test('podcast name Flagrant is never transliterated (INCIDENTS #395)', () => {
  assert.equal(applyCorrections('خلال استضافته في بودكاست فاغرانانت بأنه'), 'خلال استضافته في بودكاست Flagrant بأنه');
  assert.equal(applyCorrections('بودكاست Flagrant'), 'بودكاست Flagrant');
});

test('«سيعود أرباح» is corrected to «ستعود أرباح» (INCIDENTS #397)', () => {
  assert.equal(applyCorrections('وسيعود أرباح العرض لصالح الصندوق'), 'وستعود أرباح العرض لصالح الصندوق');
});

test('a new story whose title another story already uses is detected before it is written (INCIDENTS #398)', async () => {
  const { newsSlugTakenByOther } = await import('../scripts/fightful-watcher.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-'));
  fs.writeFileSync(path.join(dir, '1-a.md'), '---\ntitle: "عرض WWE SmackDown: ثلاثة أمور"\nsource_id: 111\n---\nx');
  fs.writeFileSync(path.join(dir, '2-b.md'), '---\ntitle: "خبر تاني"\npermalink: "/news/رابط-قديم/index.html"\nsource_id: 222\n---\nx');
  assert.equal(newsSlugTakenByOther('عرض-wwe-smackdown-ثلاثة-أمور', '999', dir), true);
  assert.equal(newsSlugTakenByOther('عرض-wwe-smackdown-ثلاثة-أمور', '111', dir), false, 'the same story rewritten is not a clash');
  assert.equal(newsSlugTakenByOther('رابط-قديم', '999', dir), true, 'a pinned permalink counts');
  assert.equal(newsSlugTakenByOther('عنوان-جديد', '999', dir), false);
});

test('site-branch.yml builds again when Cloudflare failed the last site commit (INCIDENTS #398)', () => {
  const wf = fs.readFileSync('.github/workflows/site-branch.yml', 'utf-8');
  assert.match(wf, /site-retry/);
  assert.match(wf, /conclusion == "failure"/);
});

test('«ب» glued to a number is corrected to «بـ» and no story has it (#399)', () => {
  assert.equal(applyCorrections('مقارنة ب339 ألف مشاهد'), 'مقارنة بـ339 ألف مشاهد');
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/(?<=\s)ب\d/.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});

test('tag «مصارعة الحرة» is corrected and kept out of stories (#399)', () => {
  assert.equal(applyCorrections('مصارعة الحرة'), 'المصارعة');
  assert.equal(applyCorrections('أخبار المصارعة الحرة'), applyCorrections('أخبار المصارعة الحرة'));
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/^ {2}- مصارعة الحرة$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});

test('«ريك ويليامز» is corrected and a repeated bullet is blocked (#400)', () => {
  assert.equal(applyCorrections('مواجهة بين برون بريكر وريك ويليامز'), 'مواجهة بين برون بريكر وتريك ويليامز');
  assert.equal(applyCorrections('تريك ويليامز'), 'تريك ويليامز');
  const line = '- مواجهة الكلام بين سي ام بانك وكيفن أوينز: افتتح الثنائي العرض باعتلاء السلالم وتبادل الكلمات الساخنة حول فرصهما في الفوز بالحقيبة.';
  const issues = checkArticle('عرض WWE SmackDown ثلاثة أمور كرهناها وثلاثة أحببناها', `${line}\n\n${line.replace('وتبادل', 'تبادل')}\n\nنص آخر.`, []);
  assert.ok(issues.some(i => i.code === 'duplicate_paragraph'));
  const dir = path.join(process.cwd(), 'content/news');
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/ريك ويليامز/.test(fs.readFileSync(path.join(dir, f), 'utf8').replace(/تريك ويليامز/g, '')), f);
  }
});

test('a fullscreen player has nothing around it that can black it out: frame, deck and every box up to the page are cleared (INCIDENTS #386, again 2026-10-10)', () => {
  const player = fs.readFileSync('assets/post-player.js', 'utf8');
  assert.match(player, /for \(var el = fs\.parentElement; el && el !== document\.documentElement; el = el\.parentElement\) el\.classList\.add\('arw-fs-path'\);/);
  assert.match(player, /fs\.classList\.add\('arw-fs-el', 'arw-fs-nudge'\)/);
  // the rest of the page is hidden while a player is fullscreen (still black in Chrome on a Mac)
  assert.match(fs.readFileSync('assets/post-layout.css', 'utf8'), /html\.arw-fs body \*:not\(\.arw-fs-path\):not\(\.arw-fs-el\)\{ visibility:hidden !important; \}/);
  const css = fs.readFileSync('assets/post-layout.css', 'utf8');
  assert.match(css, /html\.arw-fs \.arw-fs-path\{ overflow:visible !important; border-radius:0 !important; box-shadow:none !important; contain:none !important; container-type:normal !important;/);
  assert.match(css, /iframe:fullscreen, video:fullscreen\{ border-radius:0 !important; transform:none !important;/);
});

test('dual noun «اتحادي X وY» is corrected and blocked (INCIDENTS #402)', () => {
  assert.equal(applyCorrections('بين اتحادي WCW وWWE وفي اتحاد AEW'), 'بين اتحاد WCW وWWE وفي اتحاد AEW');
  assert.equal(applyCorrections('مع واتحادي AAA'), 'مع واتحاد AAA');
  assert.ok(checkArticle('بوكر تي يتذكر بدايته بين اتحادي WCW وWWE', 'x'.repeat(300)).some(i => i.code === 'dual_form'));
});

test('«حركة الحركات» (meaningless doubling) is corrected automatically', () => {
  // INCIDENTS #403: Booker T story said «تقليد حركة الحركات».
  const { corrections } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'editorial/corrections.json'), 'utf8'));
  assert.ok(corrections.some((c: any) => c.wrong === 'حركة الحركات' && c.right === 'الحركات'));
});

test('a match heading or a quote glued to the end of a paragraph starts its own paragraph (INCIDENTS #404)', async () => {
  const { splitGluedBlocks } = await import('../scripts/news-qa');
  assert.equal(splitGluedBlocks('يفوز على فريق (9:18). **المواجهة الثالثة: نزال**'), 'يفوز على فريق (9:18).\n\n**المواجهة الثالثة: نزال**');
  assert.equal(splitGluedBlocks('He said: > "I remember it"'), 'He said:\n\n> "I remember it"');
  assert.equal(splitGluedBlocks('- **الحدث الرئيسي المثير:** نص'), '- **الحدث الرئيسي المثير:** نص');
  assert.equal(autoFix('فاز. **المواجهة الأولى: أ**'), 'فاز.\n\n**المواجهة الأولى: أ**');
  const once = splitGluedBlocks('a. **المواجهة الأولى: x**');
  assert.equal(splitGluedBlocks(once), once);
});

test('«فريدريك» alone is corrected to «فريدريكس» (#405)', () => {
  assert.equal(applyCorrections('عبر فريدريك عن أسفه'), 'عبر فريدريكس عن أسفه');
  assert.equal(applyCorrections('كارل فريدريكس'), 'كارل فريدريكس');
});

test('«ذا WWE Main Event» (فريق The Mane Event) is corrected (#405)', () => {
  assert.equal(applyCorrections('تغلب فريق ذا WWE Main Event على فريق آخر'), 'تغلب فريق ذا مين إيفنت على فريق آخر');
});

test('dual «أجريتا» and «…تيهما» are blocked as dual forms (INCIDENTS #406)', async () => {
  const { checkArticle } = await import('../scripts/news-qa');
  const codes = (title: string, body: string) => checkArticle(title, body, []).map(i => i.code);
  const filler = ' وقال المصارع إن الحدث كان رائعا للجميع وإن الجمهور استمتع كثيرا بكل ما شاهده في تلك الليلة الطويلة.'.repeat(4);
  assert.ok(codes('عنوان عربي كامل للخبر هنا', 'التغييرات التي أجريتاها على شخصيتيهما.' + filler).includes('dual_form'));
  assert.ok(!codes('عنوان عربي كامل للخبر هنا', 'التغييرات التي أجرتها كل واحدة منهما على شخصيتها.' + filler).includes('dual_form'));
});

test('«بـال ايه نايت» (glued prefix before an «ال» name) is corrected', () => {
  // 2026-10-10: «التي تجمعه بـال ايه نايت» reached the site.
  assert.equal(applyCorrections('المواجهة التي تجمعه بـال ايه نايت'), 'المواجهة التي تجمعه مع ال ايه نايت');
});
