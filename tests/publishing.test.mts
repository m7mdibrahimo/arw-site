import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverOnce, authorizeAdmin } from '../worker/src/delivery';
import { finishPublication, publishFacebookVideo, publishInstagramVideo, mustRetainVideo } from '../worker/src/video-publishing';
import worker, { runWatcherPoll } from '../worker/src/index';
import { showUrl, findReelVideo, applyResults, isShowEligible } from '../scripts/show-reel-monitor';

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
  t.mock.method(globalThis, 'fetch', async () => Response.json({ permissions: { pull: true, push: false } }));
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
    calls++; assert.equal(String(url), 'https://api.github.com/repos/owner/repo');
    return Response.json({ permissions: { push: true } });
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
  assert.equal(Object.keys(first.deferrals).length, 2);
  assert.ok(first.deferrals['instagram:httpssitetestnewsone']);
  await runWatcherPoll(config);
  const second = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(second.deferrals['instagram:httpssitetestnewstwo']);
});


test('old, undated and unknown articles cannot reach video publishing even with force', async t => {
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/owner/repo') return Response.json({permissions: {push: true}});
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
