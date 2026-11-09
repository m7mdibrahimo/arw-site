// A Cloudflare build of «site» that a newer «site» commit replaced stops itself, so a panel save never waits for the
// bots' build (INCIDENTS #1183).
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

test('the build watches from the start and checks once more at its very end', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  const start = cfg.indexOf('module.exports = function(eleventyConfig) {');
  assert.ok(cfg.indexOf('require("./lib/superseded-build.cjs").watch();') - start < 400, 'watching starts with the config');
  const last = cfg.lastIndexOf('eleventyConfig.on("eleventy.after"');
  assert.ok(cfg.indexOf('require("./lib/superseded-build.cjs").finalCheck();', last) > last, 'the last after-build step checks');
  // a stopped build must fail, or Cloudflare would deploy a half-made site
  assert.match(fs.readFileSync('lib/superseded-build.cjs', 'utf8'), /process\.exit\(75\)/);
});
