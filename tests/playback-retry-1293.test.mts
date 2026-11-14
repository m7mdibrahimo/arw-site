// INCIDENTS #1293: a working hgcloud server hit the checker's window twice on the GitHub runner with only
// «JW Player Error 232011» logged and stayed hidden (SmackDown 13.11.2026). Such a «broken» gets a second try;
// a player that says the file is gone does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, worthRetry } from '../scripts/check-playback.ts';

const base = { mediaOk: [] as string[], mediaFail: [] as string[], playerErrors: [] as string[], frameText: '', progressed: false };

test('only a logged player error = try again', () => {
  const ev = { ...base, playerErrors: ['[helpers/jwplayer/api/core-shim]: JW Player Error 232011'] };
  assert.equal(worthRetry(ev, classify(ev)), true);
});

test('the player says the file was deleted = no retry', () => {
  const ev = { ...base, playerErrors: ['JW Player Error 232011'], frameText: 'File was deleted' };
  assert.equal(worthRetry(ev, classify(ev)), false);
});

test('a playing video is never retried', () => {
  const ev = { ...base, progressed: true };
  assert.equal(worthRetry(ev, classify(ev)), false);
});
