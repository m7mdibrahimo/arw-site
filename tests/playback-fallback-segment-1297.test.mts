// INCIDENTS #1297: StreamHG's fallback server sent its manifest and the first segment (200) about 20 s after the first
// source's CORS error, but the video hadn't moved yet and only one segment had come, so a working hgcloud server
// (SmackDown 13.11.2026) was hidden three times. A manifest + a segment from a server with no failures = the stream arrives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, fallbackArrived } from '../scripts/check-playback.ts';

const base = { mediaOk: [] as string[], mediaFail: [] as string[], playerErrors: [] as string[], frameText: ' 0 seconds of 0 seconds', progressed: false };
const err = '[helpers/jwplayer/api/core-shim]: JW Player Error 232011';
const failFirst = ['MissingAllowOriginHeader https://a.tradeexecution.cfd/x/hls3/01/1/id_o/master.txt'];

test('first source refused, fallback manifest + one segment arrived = ok', () => {
  const ev = { ...base, playerErrors: [err], mediaFail: failFirst, mediaOk: ['200 https://a.cdn-centaurus.com/hls2/01/1/id_o/master.m3u8', '200 https://a.cdn-centaurus.com/hls2/01/1/id_o/index-v1-a1.m3u8', '200 https://a.cdn-centaurus.com/hls2/01/1/id_o/seg-1-v1-a1.ts'] };
  assert.equal(fallbackArrived(ev), true);
  assert.equal(classify(ev).status, 'ok');
});

test('a segment from the server whose requests also failed proves nothing', () => {
  const ev = { ...base, playerErrors: [err], mediaFail: ['MissingAllowOriginHeader https://s.cdn/index.m3u8'], mediaOk: ['200 https://s.cdn/master.m3u8', '200 https://s.cdn/seg-1.ts'] };
  assert.equal(classify(ev).status, 'broken');
});

test('a segment with no manifest from its server proves nothing', () => {
  const ev = { ...base, playerErrors: [err], mediaFail: failFirst, mediaOk: ['200 https://b.cdn/seg-1-v1-a1.ts'] };
  assert.equal(classify(ev).status, 'broken');
});

test('only the first source refused and nothing else = still broken', () => {
  assert.equal(classify({ ...base, playerErrors: [err], mediaFail: failFirst }).status, 'broken');
});
