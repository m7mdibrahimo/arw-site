// Bot pushes that change nothing a visitor sees must not rebuild the whole site on Cloudflare
// (they kept the build queue full, so real articles and panel edits waited behind them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve('scripts/cf-pages-skip.sh');

// liveAt: commitTime in the live /build.json — 'latest' = everything visible is deployed,
// 'behind' = an earlier visible commit isn't live yet, 'down' = the site can't be reached.
function decide(files: string[], liveAt: 'latest' | 'behind' | 'down' = 'latest'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfskip-'));
  const sh = (c: string, env: Record<string, string> = {}) => execSync(c, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const commit = (msg: string, when: number) => sh(`git add -A && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m ${JSON.stringify(msg)}`, { GIT_COMMITTER_DATE: `${when} +0000`, GIT_AUTHOR_DATE: `${when} +0000` });
  sh('git init -q');
  fs.mkdirSync(path.join(dir, 'content/news'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content/news/old.md'), 'x');
  commit('an article', 1700001000);
  fs.writeFileSync(path.join(dir, 'watcher-state.json'), '1');
  commit('bot bookkeeping', 1700002000);
  sh('git branch -q remote-base');
  for (const f of files) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x'); }
  commit('c', 1700003000);
  const buildJson = path.join(dir, 'build.json');
  fs.writeFileSync(buildJson, JSON.stringify({ commitTime: liveAt === 'latest' ? 1700001000 : 1700000900 }));
  const url = liveAt === 'down' ? 'file:///nonexistent/build.json' : `file://${buildJson}`;
  const out = sh(`bash ${JSON.stringify(SCRIPT)} remote-base`, { CF_LIVE_BUILD_URL: url });
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test('bookkeeping-only bot pushes skip the Cloudflare build', () => {
  assert.equal(decide(['watcher-state.json']), ' [CF-Pages-Skip]');
  assert.equal(decide(['ringsidenews-state.json', 'watcher-feed-ringsidenews.json', 'content/images/abc.jpg']), ' [CF-Pages-Skip]');
  assert.equal(decide(['wrestlinginc-state.json', 'watcher-feed-wrestlinginc.json', 'editorial/proofread-log.jsonl', '_data/duplicate-skips.json']), ' [CF-Pages-Skip]');
});

test('never skips while an earlier visible change is not live yet (or the site cannot be checked)', () => {
  assert.equal(decide(['watcher-state.json'], 'behind'), '');
  assert.equal(decide(['watcher-state.json'], 'down'), '');
});

test('anything a visitor can see still builds', () => {
  assert.equal(decide(['content/images/abc.jpg', 'content/news/2026-خبر-جديد.md', 'watcher-state.json']), '');
  assert.equal(decide(['content/shows/x.md', 'live-results-state.json']), '');
  assert.equal(decide(['_data/pinned.json']), '');
  assert.equal(decide(['content/images/sub/deep.jpg']), '');
});

test('every news bot uses the check right before pushing', () => {
  for (const wf of ['fightful-watcher', 'ringsidenews-watcher', 'wrestlinginc-watcher']) {
    const y = fs.readFileSync(`.github/workflows/${wf}.yml`, 'utf8');
    assert.match(y, /cf-pages-skip\.sh origin\/main\)"\n\s+\[ "\$\(git log -1 --format=%s\)" = "\$MSG" \] \|\| git commit --amend -q -m "\$MSG" \|\| true\n\s+if git push origin main/, wf);
  }
});

test('the site install stays small: the video renderer is only installed by the reel jobs', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.ok(!pkg.dependencies?.hyperframes && !pkg.devDependencies?.hyperframes);
  for (const wf of ['auto-show-reel', 'generate-reel']) assert.match(fs.readFileSync(`.github/workflows/${wf}.yml`, 'utf8'), /npm install --no-save --no-audit --no-fund hyperframes@/);
});

test('the panel can tell when a save is live: build.json lists the deployed commits and is never cached', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  assert.match(cfg, /_site\/build\.json/);
  assert.match(cfg, /git log -60 --format=%H/);
  assert.match(fs.readFileSync('_headers', 'utf8'), /\/build\.json\n\s+Cache-Control: no-store/);
  const worker = fs.readFileSync('worker/src/studio.ts', 'utf8');
  assert.match(worker, /commit: sha, committedAt, sha:/);
  assert.match(worker, /commit: sha, committedAt \}/);
});
