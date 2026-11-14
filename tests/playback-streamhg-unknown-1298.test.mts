// INCIDENTS #1298: on the GitHub runner StreamHG's fallback to its second stream server often hadn't come inside the
// window, so working hgcloud servers kept collecting «JW Player Error 232011» strikes and were hidden (SmackDown
// 13.11.2026 four times, Rey del Inframundo, Fantastica Mania UK 1+2, Dynamite 11.08.2021) while they played on the
// owner's Mac. On StreamHG only what the player shows may say broken; a logged error alone is «still trying».
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, worthRetry } from '../scripts/check-playback.ts';

const base = { mediaOk: [] as string[], mediaFail: [] as string[], playerErrors: [] as string[], frameText: ' 0 seconds of 0 seconds', progressed: false };
const err = '[helpers/jwplayer/api/core-shim]: JW Player Error 232011';
const failFirst = ['MissingAllowOriginHeader https://a.tradeexecution.cfd/x/hls3/01/1/id_o/master.txt'];
const hg = 'https://hgcloud.to/e/8akxbmvbsnig';

test('StreamHG: logged 232011 + refused first source, nothing on screen = unknown, never a strike', () => {
  const ev = { ...base, playerErrors: [err], mediaFail: failFirst };
  assert.equal(classify(ev, hg).status, 'unknown');
  assert.equal(worthRetry(ev, classify(ev, hg)), true);
});

test('StreamHG: a mirror domain is StreamHG too', () => {
  assert.equal(classify({ ...base, playerErrors: [err] }, 'https://streamhg.com/e/abc').status, 'unknown');
});

test('StreamHG: «cannot be played» or «file deleted» on screen is still broken', () => {
  assert.equal(classify({ ...base, playerErrors: [err], frameText: 'This video file cannot be played (Error Code: 232011)' }, hg).status, 'broken');
  assert.equal(classify({ ...base, frameText: 'File was deleted' }, hg).status, 'broken');
});

test('other hosts keep the old rule: a logged error or a refused stream is broken', () => {
  assert.equal(classify({ ...base, playerErrors: [err] }, 'https://vidtube.one/embed-x.html').status, 'broken');
  assert.equal(classify({ ...base, mediaFail: failFirst }, 'https://vidtube.one/embed-x.html').status, 'broken');
  assert.equal(classify({ ...base, playerErrors: [err] }).status, 'broken');
});
