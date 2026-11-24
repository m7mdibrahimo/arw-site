// INCIDENTS #1516: a numbered list page or a tag that no longer exists redirects instead of a 404
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goneTarget } from '../site-worker/fast.js';

test('a gone numbered page goes to its list', () => {
  assert.equal(goneTarget('/federation/wwe/128/'), '/federation/wwe/');
  assert.equal(goneTarget('/federations/277/'), '/federations/');
  assert.equal(goneTarget('/tag/مصارعة-حرة/7/'), '/tag/مصارعة-حرة/');
  assert.equal(goneTarget('/news/3'), '/news/');
});

test('a gone tag goes to the tags index', () => {
  assert.equal(goneTarget('/tag/مصارعة/'), '/tags/');
  assert.equal(goneTarget('/tag/summerslam-2026/'), '/tags/');
});

test('other addresses are left alone', () => {
  assert.equal(goneTarget('/shows/wwe-raw-16-11-2026/'), null);
  assert.equal(goneTarget('/assets/app.123/'), null);
  assert.equal(goneTarget('/12/'), null);
});
