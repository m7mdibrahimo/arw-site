// Bot pushes that change nothing a visitor sees must not rebuild the whole site on Cloudflare
// (they kept the build queue full, so real articles and panel edits waited behind them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve('scripts/cf-pages-skip.sh');

function decide(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfskip-'));
  const sh = (c: string) => execSync(c, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base && git branch -q remote-base');
  for (const f of files) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x'); }
  sh('git add -A && git -c user.email=t@t -c user.name=t commit -q -m c');
  const out = sh(`bash ${JSON.stringify(SCRIPT)} remote-base`);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test('bookkeeping-only bot pushes skip the Cloudflare build', () => {
  assert.equal(decide(['watcher-state.json']), ' [CF-Pages-Skip]');
  assert.equal(decide(['ringsidenews-state.json', 'watcher-feed-ringsidenews.json', 'content/images/abc.jpg']), ' [CF-Pages-Skip]');
  assert.equal(decide(['wrestlinginc-state.json', 'watcher-feed-wrestlinginc.json', 'editorial/proofread-log.jsonl', '_data/duplicate-skips.json']), ' [CF-Pages-Skip]');
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
