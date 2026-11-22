// INCIDENTS #1477: the owner stays on the 5-dollar plan and never pays one cent more. arw-media resized every picture
// again in every Cloudflare data centre (only the edge cache kept the copy): ~67 million CPU-milliseconds a month against
// the 30 million the plan includes. A resized copy is made once and kept in R2; a brake stops new resizing near the limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const media = fs.readFileSync('media-worker/src/index.ts', 'utf8');

test('INCIDENTS #1477: a resized picture is read from R2 (sized/<width>/<name>.webp) before any resizing', () => {
  assert.match(media, /return `sized\/\$\{width\}\/\$\{key\.replace\(\/\^content\\\/images\\\/\/, ""\)\}\.webp`;/);
  const serve = media.slice(media.indexOf('async function serveSized'));
  assert.ok(serve.indexOf('env.MEDIA.get(sizedKeyOf(key, width))') < serve.indexOf('resizedWebp('), 'R2 first, resize second');
  assert.match(serve, /env\.MEDIA\.put\(sizedKeyOf\(key, width\), webp/);
});

test('INCIDENTS #1477: the stored sizes are not backed up (made again from the original) and go with a replaced picture', () => {
  assert.match(fs.readFileSync('media-worker/src/backup.ts', 'utf8'), /BACKUP_PREFIXES = \["content\/", "backups\/"\]/);
  assert.match(media, /if \(url\.searchParams\.get\("replace"\) === "1"\) await dropSized\(\);/);
  assert.match(media, /await env\.MEDIA\.delete\(key\); await dropSized\(\);/);
});

test('INCIDENTS #1477: near the plan\'s CPU limit a picture with no stored size is sent as the original, never resized', () => {
  assert.match(media, /if \(await resizeBraked\(env\)\) return new Response\(null, \{ status: 302/);
  assert.match(media, /status\/budget\.json/);
  assert.match(media, /brakeCpu/);
});
