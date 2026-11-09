// Send.now, VikingFile, PixelDrain and GoFile share links as watch servers (owner 2026-11-09: «هحط بس اللينك … ويتحط
// iframe تلقائي»). What each host allows was checked in a real browser inside a page of the site — lib/embed.cjs says it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nunjucks from 'nunjucks';
import embed from '../lib/embed.cjs';

const { toEmbedUrl, playerKind, hostPage, fileHostEmbed, playableServers } = embed as any;

const CASES: [string, string][] = [
  // Send.now (and its old name send.cm): the player is /embed-ID.html
  ['https://send.now/dl8ddqvzb74h', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['http://www.send.now/dl8ddqvzb74h/', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['https://send.now/dl8ddqvzb74h/AEW.Collision.2026.11.07_720p.mp4.html', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['https://send.now/dl8ddqvzb74h?ref=x', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['https://send.now/embed-dl8ddqvzb74h.html', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['https://send.cm/DL8DDQVZB74H', 'https://send.now/embed-dl8ddqvzb74h.html'],
  ['  https://send.now/dl8ddqvzb74h  ', 'https://send.now/embed-dl8ddqvzb74h.html'],
  // VikingFile: its own embed code is the file page on vikingfile.com (which sends on to the current mirror)
  ['https://vik1ngfile.site/f/jqMxBrYZ5K', 'https://vikingfile.com/f/jqMxBrYZ5K'],
  ['http://www.vikingfile.com/f/jqMxBrYZ5K/', 'https://vikingfile.com/f/jqMxBrYZ5K'],
  ['https://vikingfile.com/e/jqMxBrYZ5K', 'https://vikingfile.com/f/jqMxBrYZ5K'],
  ['https://vik1ngfile.site/embed/jqMxBrYZ5K?x=1', 'https://vikingfile.com/f/jqMxBrYZ5K'],
  ['https://vikingfile.com/f/jqMxBrYZ5K', 'https://vikingfile.com/f/jqMxBrYZ5K'],
  // PixelDrain: the file itself (its embed page refuses other sites)
  ['https://pixeldrain.com/u/zqRAGC51', 'https://pixeldrain.com/api/file/zqRAGC51'],
  ['http://www.pixeldrain.com/u/zqRAGC51/', 'https://pixeldrain.com/api/file/zqRAGC51'],
  ['https://pixeldrain.com/u/zqRAGC51?embed', 'https://pixeldrain.com/api/file/zqRAGC51'],
  ['https://pixeldrain.net/u/zqRAGC51', 'https://pixeldrain.com/api/file/zqRAGC51'],
  ['https://pixeldrain.com/api/file/zqRAGC51', 'https://pixeldrain.com/api/file/zqRAGC51'],
  // GoFile: the page stays (no player outside GoFile without Premium)
  ['https://gofile.io/d/hiKTSCdD', 'https://gofile.io/d/hiKTSCdD'],
  ['http://www.gofile.io/d/hiKTSCdD/', 'https://gofile.io/d/hiKTSCdD'],
  ['https://gofile.io/d/hiKTSCdD?page=1#top', 'https://gofile.io/d/hiKTSCdD'],
];

// links that are not a file's share link stay as they are
const UNTOUCHED = [
  'https://send.now/premium', 'https://send.now/', 'https://pixeldrain.com/l/abcd1234', 'https://pixeldrain.com/api/file/zqRAGC51/info',
  'https://gofile.io/', 'https://vikingfile.com/', 'https://example.com/send.now/dl8ddqvzb74h', 'https://notpixeldrain.com/u/zqRAGC51',
];

test('file hosts: each share link becomes its player link, with www, http, slashes, queries and other domains', () => {
  for (const [from, want] of CASES) assert.equal(toEmbedUrl(from), want, from);
  for (const u of UNTOUCHED) assert.equal(toEmbedUrl(u), u, u);
});

test('file hosts: how the player shows each one, and the host page for those that may not play here', () => {
  assert.equal(playerKind('https://send.now/embed-dl8ddqvzb74h.html'), 'iframe');
  assert.equal(playerKind('https://vikingfile.com/f/jqMxBrYZ5K'), 'iframe');
  assert.equal(playerKind('https://pixeldrain.com/api/file/zqRAGC51'), 'video');
  assert.equal(playerKind('https://gofile.io/d/hiKTSCdD'), 'page');
  assert.equal(playerKind('https://store-eu-par-3.gofile.io/download/direct/abc/AEW.mp4'), 'video'); // a Premium direct link
  assert.equal(playerKind('https://ok.ru/videoembed/123'), 'iframe');
  assert.equal(playerKind('https://pixeldrain.com/api/file/zqRAGC51/info'), 'iframe');
  assert.deepEqual(hostPage('https://pixeldrain.com/api/file/zqRAGC51'), { name: 'PixelDrain', href: 'https://pixeldrain.com/u/zqRAGC51' });
  assert.deepEqual(hostPage('https://gofile.io/d/hiKTSCdD'), { name: 'GoFile', href: 'https://gofile.io/d/hiKTSCdD' });
  assert.equal(hostPage('https://send.now/embed-dl8ddqvzb74h.html'), null);
  assert.equal(hostPage('https://vikingfile.com/f/jqMxBrYZ5K'), null);
});

test('the panel saves the four hosts as player links and every other link exactly as typed', () => {
  for (const [from, want] of CASES) assert.equal(fileHostEmbed(from), want, from);
  for (const u of ['https://ok.ru/video/123', 'https://vidmoly.org/w/abc', 'https://youtu.be/xyz', 'https://hanerix.com/eid6vpj41xti', 'https://drive.google.com/file/d/1M18MIZ5Yc0uDL1G3V9eVXfE81Y_zduXA/view']) {
    assert.equal(fileHostEmbed(u), u, u);
  }
  const editor = fs.readFileSync('studio/js/views/editor.js', 'utf-8');
  assert.match(editor, /extractUrls\(paste\.value\)\.map\(fileHostEmbed\)/);
  assert.match(editor, /S\.data\.servers\.filter\(s => s && s\.url\)\.map\(s => \(\{ \.\.\.s, url: fileHostEmbed\(s\.url\) \}\)\)/);
  assert.match(editor, /premLines\(S\.premium\.servers\)\.map\(fileHostEmbed\)/);
});

/** A function's source in a plain script, by its braces. */
function fnSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} in assets/post-player.js`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

test('the page\'s player turns every link into the same player link as the build (no drift between the two copies)', () => {
  const player = fs.readFileSync('assets/post-player.js', 'utf-8');
  const client = new Function(`${fnSource(player, 'toEmbedUrl')}\n${fnSource(player, 'playerKind')}\n${fnSource(player, 'hostPage')}\nreturn { toEmbedUrl, playerKind, hostPage };`)();
  const corpus = new Set<string>([...CASES.map(c => c[0]), ...UNTOUCHED, 'https://hanerix.com/eid6vpj41xti', 'https://ok.ru/video/123', 'https://www.youtube.com/watch?v=abc']);
  for (const dir of ['content/shows', 'content/recaps', 'content/nostalgia']) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
      for (const m of fs.readFileSync(`${dir}/${f}`, 'utf-8').matchAll(/^\s*-\s*url:\s*['"]?(https?:\/\/[^'"\s]+)/gm)) corpus.add(m[1]);
    }
  }
  for (const u of corpus) {
    const want = toEmbedUrl(u);
    assert.equal(client.toEmbedUrl(u), want, u);
    assert.equal(client.playerKind(want), playerKind(want), u);
    assert.deepEqual(client.hostPage(want), hostPage(want), u);
  }
});

test('a server that only opens on its host comes after the ones that play here; the others keep their order', () => {
  const list = [{ url: 'https://gofile.io/d/hiKTSCdD' }, { url: 'https://ok.ru/videoembed/1' }, { url: 'https://pixeldrain.com/u/zqRAGC51' }, { url: 'https://send.now/dl8ddqvzb74h' }, { url: 'https://vik1ngfile.site/f/jqMxBrYZ5K' }];
  assert.deepEqual(playableServers(list, {}, {}).map((s: any) => s.url), [
    'https://ok.ru/videoembed/1', 'https://send.now/dl8ddqvzb74h', 'https://vik1ngfile.site/f/jqMxBrYZ5K', 'https://gofile.io/d/hiKTSCdD', 'https://pixeldrain.com/u/zqRAGC51',
  ]);
  const old = [{ url: 'https://ok.ru/videoembed/1' }, { url: 'https://vidmoly.org/embed-a.html' }];
  assert.deepEqual(playableServers(old, {}, {}), old);
});

test('render: the show page\'s server list puts the pasted links in as players, numbered like the others', () => {
  const layout = fs.readFileSync('_includes/post-layout.njk', 'utf-8');
  const block = layout.match(/\{% for s in servers %\}[\s\S]*?\{% endfor %\}/);
  assert.ok(block, 'the server rows in _includes/post-layout.njk');
  const env = new nunjucks.Environment(null, { autoescape: true });
  const obfuscate = (s: string) => Buffer.from(String(s), 'utf-8').toString('base64').split('').reverse().join('');
  env.addFilter('toEmbedUrl', toEmbedUrl);
  env.addFilter('isMultiQuality', () => false);
  env.addFilter('obfuscateUrl', obfuscate);
  env.addFilter('playableServers', playableServers);
  const servers = [{ url: 'https://send.now/dl8ddqvzb74h' }, { url: 'https://gofile.io/d/hiKTSCdD' }, { url: 'https://vik1ngfile.site/f/jqMxBrYZ5K' }, { url: 'https://pixeldrain.com/u/zqRAGC51' }];
  const html = env.renderString(`{% set servers = servers | playableServers({}, {}) %}${block![0]}`, { servers });
  const rows = [...html.matchAll(/data-srv="([^"]+)" data-srv-name="([^"]+)"/g)].map(m => [Buffer.from(m[1].split('').reverse().join(''), 'base64').toString('utf-8'), m[2]]);
  assert.deepEqual(rows, [
    ['https://send.now/embed-dl8ddqvzb74h.html', 'سيرفر 1'],
    ['https://vikingfile.com/f/jqMxBrYZ5K', 'سيرفر 2'],
    ['https://gofile.io/d/hiKTSCdD', 'سيرفر 3'],
    ['https://pixeldrain.com/api/file/zqRAGC51', 'سيرفر 4'],
  ]);
  // the player: the host's own page in a new tab when it can't play here, the same player frame otherwise
  const player = fs.readFileSync('assets/post-player.js', 'utf-8');
  assert.match(player, /if \(kind === 'page'\) \{[\s\S]*?showHostPage\(box, page\);/);
  assert.match(player, /if \(page\) \{ setLoader\(false\); v\.remove\(\); showHostPage\(box, page\); return; \}/);
  assert.match(player, /a\.target = '_blank'; a\.rel = 'noopener noreferrer nofollow';/);
  assert.match(fs.readFileSync('assets/post-layout.css', 'utf-8'), /\.wd-ext\{/);
  // the daily host check never marks GoFile as «can't be framed»: its pages are linked, not framed
  assert.match(fs.readFileSync('scripts/check-video-hosts.ts', 'utf-8'), /playerKind\(embed\) === "page"\) continue;/);
});
