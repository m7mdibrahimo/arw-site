import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliverOnce, authorizeAdmin } from '../worker/src/delivery';
import { finishPublication, publishFacebookVideo, publishInstagramVideo, mustRetainVideo } from '../worker/src/video-publishing';
import worker, { runWatcherPoll } from '../worker/src/index';
import { showUrl, findReelVideo, applyResults, isShowEligible, hasRealFailure } from '../scripts/show-reel-monitor';
import { sanitizeWrestlingTerms, findLikelyDuplicateStory, findLikelyDuplicateStoryByTagsAndBody } from '../scripts/fightful-watcher';

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
  assert.equal(Object.keys(first.deferrals).length, 2);
  assert.ok(first.deferrals['instagram:httpssitetestnewsone']);
  await runWatcherPoll(config);
  const second = JSON.parse(Buffer.from(database.records.get(file)!.content, 'base64').toString());
  assert.ok(second.deferrals['instagram:httpssitetestnewstwo']);
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
