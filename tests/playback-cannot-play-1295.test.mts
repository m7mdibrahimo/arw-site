// INCIDENTS #1295: vidmoly showed JW Player's «This video file cannot be played» on three new shows at once and played
// 15 minutes later. That message is a stream that didn't load, not a deleted file: it gets the second try.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, worthRetry } from '../scripts/check-playback.ts';

const base = { mediaOk: [] as string[], mediaFail: [] as string[], playerErrors: [] as string[], frameText: '', progressed: false };

test('«cannot be played» alone = broken, but tried again', () => {
  const ev = { ...base, frameText: 'This video file cannot be played.\n(Error Code: 232011)' };
  assert.equal(classify(ev).status, 'broken');
  assert.equal(worthRetry(ev, classify(ev)), true);
});

test('«cannot be played» while the video moves = ok', () => {
  const ev = { ...base, frameText: 'This video file cannot be played.', progressed: true };
  assert.equal(classify(ev).status, 'ok');
});

test('a deleted file is still not retried', () => {
  const ev = { ...base, frameText: 'File was deleted' };
  assert.equal(worthRetry(ev, classify(ev)), false);
});
