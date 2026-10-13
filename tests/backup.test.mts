// A second copy of the site's pictures, never deleted from (owner 2026-10-13, INCIDENTS #483)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { backupMedia, toCopy } from '../media-worker/src/backup';

function bucket(init: Record<string, string> = {}) {
  const m = new Map<string, { body: string; etag: string }>(Object.entries(init).map(([k, v]) => [k, { body: v, etag: `e-${v}` }]));
  return {
    m,
    async list({ prefix, cursor }: any) {
      const keys = [...m.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0, page = keys.slice(start, start + 2);
      return { objects: page.map(k => ({ key: k, etag: m.get(k)!.etag })), truncated: start + 2 < keys.length, cursor: String(start + 2) };
    },
    async get(k: string) { const o = m.get(k); return o ? { body: o.body, httpMetadata: {}, customMetadata: {} } : null; },
    async put(k: string, body: string) { m.set(k, { body, etag: `e-${body}` }); },
  };
}

test('new and changed pictures are copied, a few at a time, and the backup never deletes', async () => {
  const main = bucket({ 'content/images/a.jpg': '1', 'content/images/b.jpg': '2', 'content/images/c.jpg': '3', 'videos/r.mp4': 'v' });
  const backup = bucket({ 'content/images/a.jpg': '1', 'content/images/old.jpg': 'gone from the site' });
  const r1 = await backupMedia({ MEDIA: main as any, MEDIA_BACKUP: backup as any }, 1);
  assert.deepEqual(r1, { copied: 1, waiting: 1, total: 3 });
  const r2 = await backupMedia({ MEDIA: main as any, MEDIA_BACKUP: backup as any }, 10);
  assert.equal(r2.copied, 1);
  main.m.set('content/images/a.jpg', { body: 'new', etag: 'e-new' });
  await backupMedia({ MEDIA: main as any, MEDIA_BACKUP: backup as any }, 10);
  assert.equal(backup.m.get('content/images/a.jpg')!.body, 'new');
  assert.ok(backup.m.has('content/images/old.jpg'), 'a picture removed from the site stays in the backup');
  assert.ok(!backup.m.has('videos/r.mp4'), 'reels are made again, not backed up');
  assert.deepEqual(toCopy(new Map([['x', '1']]), new Map([['x', '1']])), []);
  const toml = fs.readFileSync('media-worker/wrangler.toml', 'utf8');
  assert.match(toml, /binding = "MEDIA_BACKUP"\nbucket_name = "arw-media-backup"/);
});
