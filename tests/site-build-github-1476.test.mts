// INCIDENTS #1476: Cloudflare built every «site» version (Workers Builds, ~8 minutes each, ~100 a day) and charged for
// every build minute over 6,000 a month: November 2026 reached 11,610 minutes and a 38.88-dollar bill. The owner pays
// nothing more for the site, so GitHub (free for this public repo) builds «site» and deploys it to arw-site-static.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATIC_BUILD } from '../worker/src/health.ts';

const build = fs.readFileSync('.github/workflows/site-build.yml', 'utf8');
const branch = fs.readFileSync('.github/workflows/site-branch.yml', 'utf8');
const health = fs.readFileSync('worker/src/health.ts', 'utf8');

test('INCIDENTS #1476: GitHub builds «site» and deploys it to arw-site-static, one at a time, never cancelling a running build', () => {
  assert.match(build, /name: 'Site Build: arw-site-static'/);
  assert.match(build, /npx @11ty\/eleventy/);
  assert.match(build, /wrangler@4\.34\.0 deploy --config wrangler\.static\.jsonc/);
  assert.match(build, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(build, /group: site-build\n\s+cancel-in-progress: false/);
  assert.match(build, /fetch-depth: 60/);
});

test('INCIDENTS #1476: a build that steps aside for a newer version (exit 75) ends green without deploying', () => {
  assert.match(build, /"\$CODE" = "75"/);
  assert.match(build, /if: steps\.build\.outputs\.skip != '1'/);
});

test('INCIDENTS #1476: site-branch.yml starts the GitHub build after moving «site», behind the switch', () => {
  assert.match(branch, /actions: write/);
  assert.match(branch, /id: point/);
  assert.match(branch, /echo "moved=1" >> "\$GITHUB_OUTPUT"/);
  assert.match(branch, /if: steps\.point\.outputs\.moved == '1' && vars\.SITE_BUILD_ON_GITHUB == '1'/);
  assert.match(branch, /gh workflow run site-build\.yml -R "\$REPO" --ref site/);
  assert.match(branch, /\.name == "Site Build: arw-site-static"/);
});

test('INCIDENTS #1476: /health reads the check run of either build', () => {
  assert.ok(STATIC_BUILD.test('Workers Builds: arw-site-static'));
  assert.ok(STATIC_BUILD.test('Site Build: arw-site-static'));
  assert.ok(!STATIC_BUILD.test('Workers Builds: arw-site-bot'));
  assert.ok(!health.includes('c?.name === "Workers Builds: arw-site-static"'));
});
