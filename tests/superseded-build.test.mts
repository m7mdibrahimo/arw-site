// A Cloudflare build of «site» skips itself only when that can never leave the site behind (INCIDENTS #1183, #1285).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../lib/superseded-build.cjs');

const A = 'a'.repeat(40), B = 'b'.repeat(40);

test('only a build of a «site» commit is watched', () => {
  const read = (msg: string) => (args: string[]) => (args[0] === 'log' ? msg : A);
  assert.equal(S.ownSiteCommit(read(`feat(news): x\n\nsite-of: ${B} 1794257340`)), A);
  assert.equal(S.ownSiteCommit(read('feat(news): a commit on main')), '');
  assert.equal(S.ownSiteCommit(read('')), '', 'no git: never stops anything');
});

test('it stops only when «site» is really another commit', () => {
  assert.equal(S.parseLsRemote(`${B}\trefs/heads/site\n`), B);
  assert.equal(S.parseLsRemote(''), '');
  assert.equal(S.parseLsRemote('fatal: unable to access'), '');
  assert.equal(S.superseded(A, B), true);
  assert.equal(S.superseded(A, A), false, 'still the newest');
  assert.equal(S.superseded(A, ''), false, 'GitHub could not be asked: the build goes on');
  assert.equal(S.superseded('', B), false, 'not a «site» build');
});

test('a busy night never starves the site: a running build is never stopped just because «site» moved (#1285)', () => {
  const T = 1794600000;
  const mine = { sha: A, time: T };
  // the owner saves five shows while the bots publish news: «site» keeps moving, the live site is 20 minutes old
  assert.equal(S.decide('run', mine, B, T - 1200), '', 'mid-build: «site» moving never stops it');
  assert.equal(S.decide('end', mine, B, T - 1200), '', 'its end: it goes out, the site is behind');
  assert.equal(S.decide('start', mine, B, T - 1200), '', 'its start: the live site is far behind, so it builds');
  // it steps aside only at its start, when a newer version is waiting and the site is barely behind
  assert.ok(S.decide('start', mine, B, T - 60));
  assert.equal(S.decide('start', mine, A, T - 60), '', 'still the newest: it builds');
  // an older version never goes out over a newer one
  assert.ok(S.decide('end', mine, '', T + 30));
  assert.ok(S.decide('run', mine, '', T + 30));
  assert.equal(S.decide('end', mine, '', T), '', 'the same version live (a rerun): it goes out');
  // what can't be read never stops a build
  assert.equal(S.decide('start', mine, B, 0), '');
  assert.equal(S.decide('end', { sha: A, time: 0 }, '', T + 30), '');
  assert.equal(S.decide('end', null, '', T + 30), '');
  assert.equal(S.parseLive('{"commit":"x","commitTime":1794609249}'), 1794609249);
  assert.equal(S.parseLive('<html>'), 0);
  assert.equal(S.parseLive(''), 0);
  const read = (args: string[]) => (args[0] === 'log' ? `x\n\nsite-of: ${B} 1794257340` : A);
  assert.deepEqual(S.ownSite(read), { sha: A, time: 1794257340 });
});

test('the build watches from the start and checks once more at its very end', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  const start = cfg.indexOf('module.exports = function(eleventyConfig) {');
  assert.ok(cfg.indexOf('require("./lib/superseded-build.cjs").watch();') - start < 400, 'watching starts with the config');
  const last = cfg.lastIndexOf('eleventyConfig.on("eleventy.after"');
  assert.ok(cfg.indexOf('require("./lib/superseded-build.cjs").finalCheck();', last) > last, 'the last after-build step checks');
  // a stopped build must fail, or Cloudflare would deploy a half-made site
  assert.match(fs.readFileSync('lib/superseded-build.cjs', 'utf8'), /process\.exit\(75\)/);
});
