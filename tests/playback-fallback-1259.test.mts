// INCIDENTS #1259: StreamHG (hgcloud.to) players try a first stream server with no CORS header, log
// «JW Player Error 232011», then fall back to a second server and play. The checker read the error first and hid
// working servers for good. A video that moves forward, or real pieces of video arriving, beats the logged error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../scripts/check-playback.ts';

const base = { mediaOk: [] as string[], mediaFail: [] as string[], playerErrors: [] as string[], frameText: '', progressed: false };
const err = '[helpers/jwplayer/api/core-shim]: JW Player Error 232011';

test('error on the first source, then the video plays = ok', () => {
  const ev = { ...base, playerErrors: [err], mediaFail: ['MissingAllowOriginHeader https://x.riskanalytics.cfd/hls3/master.txt'],
    mediaOk: ['200 https://y.premilkyway.com/hls2/master.m3u8', '200 https://y.premilkyway.com/hls2/seg-1-v1-a1.ts'], progressed: true };
  assert.equal(classify(ev).status, 'ok');
});

test('error, no progress, but several video pieces arrived = ok', () => {
  const ev = { ...base, playerErrors: [err], mediaOk: ['200 https://y/hls2/master.m3u8', '200 https://y/hls2/seg-1-v1-a1.ts', '200 https://y/hls2/seg-2-v1-a1.ts'] };
  assert.equal(classify(ev).status, 'ok');
});

test('error with only the manifest (no video) stays broken, like the vidtube CORS case', () => {
  const ev = { ...base, playerErrors: [err], mediaOk: ['200 https://y/master.m3u8'], mediaFail: ['MissingAllowOriginHeader https://y/index.m3u8'] };
  assert.equal(classify(ev).status, 'broken');
});

test('a dead file stays broken even if something moved', () => {
  assert.equal(classify({ ...base, frameText: 'File was deleted', progressed: true }).status, 'broken');
});
