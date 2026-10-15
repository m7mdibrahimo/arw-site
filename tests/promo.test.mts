// The site's promo video to its social accounts (worker/src/promo.ts, .github/workflows/promo-publish.yml)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROMO_FILE, promoCaption, promoFacebook, facebookPostOf, pinFacebook, promoTelegram, pinTelegram } from '../worker/src/promo';

type Call = { url: string; init?: any };
function fakeFetch(handler: (url: string, init?: any) => any) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, init });
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out.http ? out.body : out), { status: out.http ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
// the waits between Facebook's processing checks, made instant
const realTimeout = globalThis.setTimeout;
test.beforeEach(() => { (globalThis as any).setTimeout = (fn: any) => realTimeout(fn, 0); });
test.afterEach(() => { (globalThis as any).setTimeout = realTimeout; });

test('promo file names and captions are kept plain', () => {
  assert.ok(PROMO_FILE.test('arab-wrestling-promo.mp4'));
  for (const bad of ['../x.mp4', 'A.mp4', 'promo.mov', 'x.mp4', 'a b.mp4']) assert.ok(!PROMO_FILE.test(bad), bad);
  assert.equal(promoCaption('  سطر\r\nوسطر\u0007  '), 'سطر\nوسطر');
  assert.equal(promoCaption('x'.repeat(3000)).length, 1024);
  assert.equal(promoCaption(undefined), '');
});

test('Facebook: a page video with its caption, then its post is found and pinned', async () => {
  let checks = 0;
  const f = fakeFetch((url, init) => {
    if (url.includes('/1229/videos')) return { id: 'v77' };
    if (url.includes('/v77?fields=status,post_id')) return ++checks < 2 ? { status: { video_status: 'processing' } } : { status: { video_status: 'ready' }, post_id: '555', permalink_url: '/x' };
    if (url.endsWith('/1229_555')) return { success: true };
    return { http: 404, body: {} };
  });
  try {
    const r = await promoFacebook({ pageId: '1229', token: 't', videoUrl: 'https://arab-wrestling.com/videos/p.mp4', title: 'عرب راسلنج', caption: 'اشترك الآن' });
    assert.deepEqual([r.ok, r.id, r.postId], [true, '1229_555', '1229_555']);
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(f.calls[0].url, 'https://graph-video.facebook.com/v21.0/1229/videos');
    assert.deepEqual([body.file_url, body.description, body.published], ['https://arab-wrestling.com/videos/p.mp4', 'اشترك الآن', true]);
    const pin = await pinFacebook({ postId: r.postId!, token: 't' });
    assert.equal(pin.ok, true);
    assert.equal(JSON.parse(f.calls.at(-1)!.init.body).is_pinned, true);
  } finally { f.restore(); }
});

test('Facebook: a refused video is a failure; a video still processing counts as sent and its post is looked up later', async () => {
  let f = fakeFetch(() => ({ http: 400, body: { error: { message: 'bad video' } } }));
  try {
    const r = await promoFacebook({ pageId: '1229', token: 't', videoUrl: 'u', title: '', caption: 'c' });
    assert.deepEqual([r.ok, r.error, r.ambiguous], [false, 'bad video', false]);
  } finally { f.restore(); }
  f = fakeFetch((url) => url.includes('/videos') ? { id: 'v9' } : url.includes('fields=status') ? { status: { video_status: 'processing' } } : { post_id: '1229_9' });
  try {
    const r = await promoFacebook({ pageId: '1229', token: 't', videoUrl: 'u', title: '', caption: 'c' });
    assert.deepEqual([r.ok, r.id], [true, 'v9']);
    assert.equal(await facebookPostOf('v9', '1229', 't'), '1229_9');
    assert.equal(await facebookPostOf('1229_9', '1229', 't'), '1229_9');
  } finally { f.restore(); }
});

test('Telegram: the video is uploaded with its caption and size, then pinned; over 50 MB is refused', async () => {
  const f = fakeFetch((url, init) => {
    if (url.startsWith('https://arab-wrestling.com/videos/')) return new Response(new Uint8Array(2048), { status: 200 });
    if (url.endsWith('/sendVideo')) return { ok: true, result: { message_id: 42 } };
    if (url.endsWith('/pinChatMessage')) return { ok: true, result: true };
    return { http: 404, body: {} };
  });
  try {
    const r = await promoTelegram({ botToken: 'b', chatId: '@arab_wrestling', videoUrl: 'https://arab-wrestling.com/videos/p.mp4', caption: 'اشترك', width: 1920, height: 1080, duration: 112.9 });
    assert.deepEqual([r.ok, r.id], [true, '42']);
    const form: FormData = f.calls[1].init.body;
    assert.deepEqual([form.get('chat_id'), form.get('caption'), form.get('width'), form.get('duration')], ['@arab_wrestling', 'اشترك', '1920', '113']);
    assert.ok(form.get('video') instanceof Blob);
    const pin = await pinTelegram({ botToken: 'b', chatId: '@arab_wrestling', messageId: '42' });
    assert.equal(pin.ok, true);
    assert.equal(JSON.parse(f.calls.at(-1)!.init.body).message_id, 42);
  } finally { f.restore(); }
  const big = fakeFetch(() => new Response(new Uint8Array(51 * 1024 * 1024), { status: 200 }));
  try {
    const r = await promoTelegram({ botToken: 'b', chatId: 'c', videoUrl: 'https://arab-wrestling.com/videos/p.mp4', caption: 'x' });
    assert.equal(r.ok, false);
    assert.equal(big.calls.length, 1);
  } finally { big.restore(); }
});

test('the promo route is behind the admin check and posts once a platform; the workflow is run by hand only', () => {
  const src = fs.readFileSync('worker/src/index.ts', 'utf8');
  const gate = src.indexOf('if (!(await authorizeAdmin(request, env)) && !(await studioAuthorized(request, env, "tools")))');
  const route = src.indexOf('path === "/api/videos/publish-promo"');
  assert.ok(gate > 0 && route > gate, 'the route sits after the admin gate');
  assert.match(src, /deliverOnce\(env, `promo:\$\{platform\}:\$\{file\}`/);
  const wf = fs.readFileSync('.github/workflows/promo-publish.yml', 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(wf, /^\s+(push|schedule|pull_request):/m);
  assert.doesNotMatch(wf, /\$\{\{ inputs\.[a-z]+ \}\}"?\s*\|/, 'inputs reach the shell only through env');
});
