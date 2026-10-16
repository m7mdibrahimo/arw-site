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
// laterOnBase: commits pushed after the live build, as [file, message].
function decide(files: string[], liveAt: 'latest' | 'behind' | 'down' = 'latest', laterOnBase: [string, string][] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfskip-'));
  const sh = (c: string, env: Record<string, string> = {}) => execSync(c, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const commit = (msg: string, when: number) => sh(`git add -A && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m ${JSON.stringify(msg)}`, { GIT_COMMITTER_DATE: `${when} +0000`, GIT_AUTHOR_DATE: `${when} +0000` });
  sh('git init -q');
  fs.mkdirSync(path.join(dir, 'content/news'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content/news/old.md'), 'x');
  commit('an article', 1700001000);
  fs.writeFileSync(path.join(dir, 'watcher-state.json'), '1');
  commit('bot bookkeeping', 1700002000);
  laterOnBase.forEach(([f, msg], i) => {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), String(i));
    commit(msg, 1700002100 + i);
  });
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
  assert.equal(decide(['watcher-outcomes.json', 'watcher-state.json']), ' [CF-Pages-Skip]', 'the «why» notes for the panel are bookkeeping too');
  assert.equal(decide(['ringsidenews-state.json', 'watcher-feed-ringsidenews.json', 'content/images/abc.jpg']), ' [CF-Pages-Skip]');
  assert.equal(decide(['wrestlinginc-state.json', 'watcher-feed-wrestlinginc.json', 'editorial/proofread-log.jsonl', '_data/duplicate-skips.json']), ' [CF-Pages-Skip]');
});

test('never skips while an earlier visible change is not live yet (or the site cannot be checked)', () => {
  assert.equal(decide(['watcher-state.json'], 'behind'), '');
  assert.equal(decide(['watcher-state.json'], 'down'), '');
  // a panel edit pushed after the live build still has to wait for its own build
  assert.equal(decide(['watcher-state.json'], 'latest', [['content/shows/x.md', 'Update عرض “x” (لوحة التحكم — محمد)']]), '');
});

test('commits that never build ([skip ci] receipts, search reports) do not keep the site "behind" (INCIDENTS #307)', () => {
  assert.equal(decide(['watcher-state.json'], 'latest', [
    ['_data/deliveries/abc.json', 'chore(publish): delivery sent [skip ci]'],
    ['seo/new-shows.md', 'chore(seo): new pages sent to search engines [skip ci]'],
    ['content/news/fixed.md', 'chore(publish): mark telegram sent [Skip CI]'],
  ]), ' [CF-Pages-Skip]');
  // [no ci] is GitHub's word only: Cloudflare builds that commit, so it still counts
  assert.equal(decide(['watcher-state.json'], 'latest', [['content/news/n.md', 'x [no ci]']]), '');
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

test('the 4400+ original images are hard-linked into the site, not copied byte by byte (INCIDENTS #307)', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  assert.doesNotMatch(cfg, /addPassthroughCopy\("content\/images"\)/);
  assert.match(cfg, /linkTree\("content\/images", "_site\/content\/images"\)/);
  assert.match(cfg, /fs\.linkSync\(src, dest\)/);
});

test('host builds reuse already-resized images from the live site (only new ones are resized)', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  assert.match(cfg, /_site\/img-cache\.json/);
  // (minus the copies arw-media makes on request now, INCIDENTS #369)
  assert.match(cfg, /process\.env\.CF_PAGES \? await fetchLiveImages\(skip\)/);
  // Never keep a half-downloaded or non-image response: eleventy-img would skip it forever.
  assert.match(cfg, /startsWith\("image\/"\)/);
  assert.match(cfg, /fs\.renameSync\(tmp/);
  assert.match(fs.readFileSync('_headers', 'utf8'), /\/img-cache\.json\n\s+Cache-Control: no-cache/);
});

test('the home slider shows each picture as it was uploaded, with no size', () => {
  // owner 2026-10-11: «شيل منها الابعاد خالص» (INCIDENTS #419)
  const home = fs.readFileSync('index.njk', 'utf8');
  const img = home.match(/<img [^>]*class="spotlight-bg-img"[^>]*>/)![0];
  assert.match(img, /\| fullImg\(/);
  assert.doesNotMatch(img, /optImg|optThumb|\?w=/);
  const config = fs.readFileSync('eleventy.config.js', 'utf8');
  const code = config.slice(config.indexOf('addFilter("fullImg", ') + 'addFilter("fullImg", '.length, config.indexOf('});', config.indexOf('addFilter("fullImg"')) + 1);
  const fullImg = new Function(`return ${code}`)();
  assert.equal(fullImg('/content/images/q9ns2lelhx8t3w00.jpg?w=800'), '/content/images/q9ns2lelhx8t3w00.jpg');
  assert.equal(fullImg('', '/content/images/jtct9rkqmcshcyh6.jpg'), '/content/images/jtct9rkqmcshcyh6.jpg');
  assert.equal(fullImg('https://i.ibb.co/x.jpg'), 'https://i.ibb.co/x.jpg');
});

test('show and recap cards show the date the item was added, not the date it aired', () => {
  // owner 2026-10-11: «التاريخ ال يتكتب تاريخ اضافة الموضوع وليس تاريخ الفديو نفسه» (INCIDENTS #420)
  for (const f of ['index.njk', 'pages/shows.njk', 'pages/recaps.njk', 'pages/library-program.njk']) {
    const src = fs.readFileSync(f, 'utf8');
    for (const foot of src.match(/<div class="foot"><span>\{\{[^}]*\}\}<\/span>/g) || []) assert.doesNotMatch(foot, /event_?[dD]ate \||event_date or/, `${f}: ${foot}`);
  }
  assert.match(fs.readFileSync('_includes/post-layout.njk', 'utf8'), /\{\{ \(rItem\.date or rItem\.data\.date\) \| date\("YYYY\/MM\/DD"\) \}\}/);
});

test('show pages carry VideoObject structured data in the head, with duration and dates (INCIDENTS #427)', () => {
  const layout = fs.readFileSync(path.join(process.cwd(), '_includes/post-layout.njk'), 'utf8');
  assert.ok(/"@type": "VideoObject"/.test(layout));
  assert.ok(/"duration": "\{\{ duration \| isoDuration \}\}"/.test(layout));
  // duration is optional: recaps without one still get the VideoObject (INCIDENTS #471)
  assert.ok(layout.includes("{% if ldEmbed and (page.url.startsWith('/shows/')"));
  assert.ok(!layout.includes("{% if ldEmbed and duration and"));
  assert.ok(layout.includes("{% if duration and (duration | isoDuration) %}\"duration\""));
});

test('library program pages that Google knows and that no longer exist redirect to where their content lives (INCIDENTS #426)', () => {
  const red = fs.readFileSync(path.join(process.cwd(), '_redirects'), 'utf8');
  for (const [from, to] of [['/library/njpw/', '/federation/njpw/'], ['/library/roh/', '/federation/roh/'], ['/library/cmll/', '/federation/indie/']]) {
    assert.ok(red.split('\n').some(l => l.trim().startsWith(`${from} ${to} 301`)), from);
  }
});

test('a page with a player is never prepared in the background, and nothing around the player moves or fades', () => {
  // Full screen showed a black picture with sound on the first open from a link, fine after a reload (owner 2026-10-13, INCIDENTS #467)
  const exp = fs.readFileSync('assets/experience.js', 'utf8');
  assert.match(exp, /\{ not: \{ or: WATCH \} \}/);
  assert.match(exp, /prefetch: \[\{ where: \{ or: WATCH \}/);
  for (const p of ['/shows/:slug/', '/recaps/:slug/', '/nostalgia/:slug/']) assert.ok(exp.includes(`href_matches: '${p}'`), p);
  const layout = fs.readFileSync('_includes/post-layout.njk', 'utf8');
  assert.match(layout, /<div class="post-wrap\{% if isWatchPage %\} is-watch\{% else %\} reveal\{% endif %\}">/);
  assert.match(fs.readFileSync('_includes/theme-init.njk', 'utf8'), /experience\.js\?v=20261016a/);
});

test('the home slider is one piece: the picture melts into a blurred copy of itself, mirrored on the English pages', () => {
  // owner 2026-10-13 — «الصورة والخلفية قطعة واحدة», option 3 (INCIDENTS #484)
  const home = fs.readFileSync('index.njk', 'utf8');
  assert.match(home, /<div class="spotlight-amb" style="background-image:url\('\{\{ ambSrc \}\}'\)"><\/div>/);
  assert.match(home, /--melt: 55%;/);
  assert.match(home, /\.spotlight-slide\[data-fed="wwe"\] \{ --fed-glow:/);
  const en = path.join(process.cwd(), '_site/en/index.html');
  if (fs.existsSync(en)) assert.match(fs.readFileSync(en, 'utf8'), /mask-image: linear-gradient\(to left, #000 calc\(100% - var\(--melt\)\)/);
});

test('every slide gets the slow zoom for as long as it is shown, not only the first', () => {
  // owner 2026-10-13: the RAW slide's slow zoom on every picture (INCIDENTS #488)
  const home = fs.readFileSync('index.njk', 'utf8');
  // owner 2026-10-13 again: the zoom lasts the slide's time, freezes as it fades, and takes turns in and out (INCIDENTS #489)
  assert.match(home, /@keyframes spotlight-zoom-in \{ from \{ transform: scale\(1\); \} to \{ transform: scale\(1\.08\); \} \}/);
  assert.match(home, /@keyframes spotlight-zoom-out \{ from \{ transform: scale\(1\.08\); \} to \{ transform: scale\(1\); \} \}/);
  assert.match(home, /animation: spotlight-zoom-in 6\.5s/);
  assert.match(home, /const DURATION = 6500;/);
  assert.match(home, /data-zoom="\{\{ 'out' if loop\.index0 % 2 else 'in' \}\}"/);
  assert.match(home, /\.spotlight-slide\.leaving \.spotlight-bg-img,\n#spotlightHero\.is-paused \.spotlight-slide\.active \.spotlight-bg-img \{ animation-play-state: paused; \}/);
  assert.match(home, /hero\.addEventListener\('mouseenter', pauseAuto\);/);
  assert.doesNotMatch(home, /transition: transform 7s cubic-bezier\(0\.1, 0\.9, 0\.2, 1\)/);
});

// Scripts and styles linked by names of their own content (lib/asset-names.cjs, INCIDENTS #617)
test('every page links its scripts and styles by their content, so a changed file is always a new address', async () => {
  const { nameAssetsByContent } = await import('../lib/asset-names.cjs');
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'arw-site-'));
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(site, 'en', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(site, 'news', 'x'), { recursive: true });
  fs.writeFileSync(path.join(site, 'assets', 'features.css'), 'a{color:red}');
  fs.writeFileSync(path.join(site, 'assets', 'features.js'), 'var a=1;');
  fs.writeFileSync(path.join(site, 'en', 'assets', 'features.js'), 'var a=2;');
  const page = '<link rel="stylesheet" href="/assets/features.css?v=20261015m"><script src="/assets/features.js?v=abc" defer></script>'
    + '<script src="/en/assets/features.js?v=1"></script><script src="/assets/missing.js?v=2"></script><img src="/assets/logo.png"><script>var u="/assets/features.js";</script>'
    + '<a href="/assets/../../etc/passwd.js">x</a>';
  fs.writeFileSync(path.join(site, 'index.html'), page);
  fs.writeFileSync(path.join(site, 'news', 'x', 'index.html'), page);
  const r = nameAssetsByContent(site);
  assert.deepEqual(r, { pages: 2, files: 3 });
  const out = fs.readFileSync(path.join(site, 'news', 'x', 'index.html'), 'utf8');
  const css = out.match(/href="(\/assets\/features\.[0-9a-f]{10}\.css)"/)![1];
  const js = out.match(/src="(\/assets\/features\.[0-9a-f]{10}\.js)"/)![1];
  const en = out.match(/src="(\/en\/assets\/features\.[0-9a-f]{10}\.js)"/)![1];
  assert.equal(fs.readFileSync(path.join(site, css), 'utf8'), 'a{color:red}');
  assert.equal(fs.readFileSync(path.join(site, en), 'utf8'), 'var a=2;');
  assert.notEqual(js.replace('/assets/', ''), en.replace('/en/assets/', ''), 'two contents, two names');
  assert.match(out, /src="\/assets\/missing\.js\?v=2"/, 'a link to no file stays as it was');
  assert.match(out, /var u="\/assets\/features\.js";/, 'what a script loads by itself is left alone');
  assert.match(out, /href="\/assets\/\.\.\/\.\.\/etc\/passwd\.js"/, 'nothing outside the site is read');
  assert.ok(fs.existsSync(path.join(site, 'assets', 'features.css')), 'the plain file stays');
  // a changed file: a new name, on the next build
  fs.writeFileSync(path.join(site, 'assets', 'features.css'), 'a{color:blue}');
  fs.writeFileSync(path.join(site, 'index.html'), page);
  nameAssetsByContent(site);
  assert.notEqual(fs.readFileSync(path.join(site, 'index.html'), 'utf8').match(/href="([^"]+\.css)"/)![1], css);
  fs.rmSync(site, { recursive: true, force: true });
});

test('the content naming runs after the minifying, in the same step', () => {
  const cfg = fs.readFileSync('eleventy.config.js', 'utf8');
  const minify = cfg.indexOf('console.log(`[minify]');
  const naming = cfg.indexOf('nameAssetsByContent("_site")');
  assert.ok(minify > 0 && naming > minify && naming - minify < 600);
});
