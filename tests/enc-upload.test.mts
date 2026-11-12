// «ارفع ملف من جهازك» (owner 2026-11-12: «انا مش شايف خيار ارفع من جهازك خالص»): the panel sends a file to the site's
// storage in pieces, the machine fetches it from the worker — no tunnel to the machine needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encUpName, encUpKeyOk, encUploadStudio, encUploadMachine, encUploadSweep, ENC_UP_PART } from '../worker/src/enc-upload';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE enc_cmds (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, data TEXT, created INTEGER, taken INTEGER DEFAULT 0)');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { db.prepare(sql).run(...(args as any[])); return {}; },
  });
  return { prepare: (sql: string) => stmt(sql), raw: db } as any;
}
const kv = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as any; };

/** just enough of R2: multipart uploads, get with a range, delete, list */
function r2() {
  const objs = new Map<string, { data: Uint8Array; at: number }>();
  const ups = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  let id = 0;
  const handle = (key: string, uploadId: string) => ({
    uploadPart: async (n: number, buf: ArrayBuffer) => { ups.get(uploadId)!.parts.set(n, new Uint8Array(buf)); return { partNumber: n, etag: `e${n}` }; },
    complete: async (parts: { partNumber: number; etag: string }[]) => {
      const u = ups.get(uploadId)!;
      const chunks = parts.map(p => u.parts.get(p.partNumber)!);
      const data = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
      objs.set(key, { data, at: Date.now() }); ups.delete(uploadId);
      return { key, size: data.length };
    },
    abort: async () => { ups.delete(uploadId); },
  });
  return {
    objs, ups,
    createMultipartUpload: async (key: string) => { const uploadId = `u${++id}`; ups.set(uploadId, { key, parts: new Map() }); return { key, uploadId }; },
    resumeMultipartUpload: (key: string, uploadId: string) => handle(key, uploadId),
    get: async (key: string, opts: any = {}) => {
      const o = objs.get(key); if (!o) return null;
      let start = 0, end = o.data.length;
      const r = opts.range && opts.range.get ? /bytes=(\d+)-(\d*)/.exec(opts.range.get('Range')) : null;
      if (r) { start = Number(r[1]); end = r[2] ? Number(r[2]) + 1 : o.data.length; }
      return { size: o.data.length, body: new Blob([o.data.slice(start, end)]).stream(), range: r ? { offset: start, length: end - start } : undefined };
    },
    delete: async (k: string | string[]) => { for (const x of [k].flat()) objs.delete(x); },
    list: async () => ({ objects: [...objs.entries()].map(([key, o]) => ({ key, uploaded: new Date(o.at), customMetadata: { at: String(o.at) } })), truncated: false }),
  } as any;
}
const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const post = (path: string, body: any) => new Request(`https://w.dev${path}`, { method: 'POST', body: body instanceof Uint8Array ? body : JSON.stringify(body) });
const call = async (env: any, path: string, body: any) => {
  const req = post(path, body);
  const r = await encUploadStudio(req, env, new URL(req.url).pathname, new URL(req.url), json);
  return { status: r!.status, body: await r!.json() as any };
};

test('only a video or sound file, by its own name, nothing that reaches out of the folder', () => {
  assert.equal(encUpName('WWE.RAW.2026.11.09.mka'), 'WWE.RAW.2026.11.09.mka');
  assert.equal(encUpName('C:\\shows\\audio\\WWE.RAW.2026.11.09.mka'), 'WWE.RAW.2026.11.09.mka');
  assert.equal(encUpName('../../etc/x.mp4'), 'x.mp4');
  assert.equal(encUpName('show$(rm -rf).mkv'), 'show(rm -rf).mkv');
  assert.equal(encUpName('notes.txt'), null);
  assert.equal(encUpName('.hidden.mkv'), null);
  assert.equal(encUpName(''), null);
  assert.ok(encUpKeyOk('enc-up/0123456789abcdef0123456789abcdef/WWE.RAW.mka'));
  assert.ok(!encUpKeyOk('enc-up/../secrets/x.mka'));
  assert.ok(!encUpKeyOk('shows/pic.jpg'));
});

test('a file goes up in pieces, the machine is told to stay on, then gets a «fetch» with the language', async () => {
  const env = { MEDIA: r2(), ANALYTICS: d1(), PUSH_KV: kv() };
  const s = await call(env, '/api/studio/tools/server/upload/start', { name: 'WWE.RAW.2026.11.09.mka', size: 30 });
  assert.equal(s.status, 200); assert.equal(s.body.partSize, ENC_UP_PART);
  assert.equal(env.PUSH_KV.m.get('tools:upload-hold'), '1');
  const q = `key=${encodeURIComponent(s.body.key)}&uploadId=${s.body.uploadId}`;
  const p1 = await call(env, `/api/studio/tools/server/upload/part?${q}&n=1`, new Uint8Array(20).fill(1));
  const p2 = await call(env, `/api/studio/tools/server/upload/part?${q}&n=2`, new Uint8Array(10).fill(2));
  const d = await call(env, '/api/studio/tools/server/upload/done', { key: s.body.key, uploadId: s.body.uploadId, lang: 'en',
    parts: [{ partNumber: 2, etag: p2.body.etag }, { partNumber: 1, etag: p1.body.etag }] });
  assert.equal(d.body.size, 30);
  assert.equal(env.PUSH_KV.m.get('tools:upload-hold'), undefined);
  const cmd = env.ANALYTICS.raw.prepare('SELECT kind, data FROM enc_cmds').get();
  assert.equal(cmd.kind, 'fetch');
  assert.deepEqual(JSON.parse(cmd.data), { file: 'WWE.RAW.2026.11.09.mka', key: s.body.key, size: 30, lang: 'en' });

  // the machine fetches it whole, or a piece of it (aria2 asks for ranges), then says it has it
  const get = async (range?: string) => {
    const req = new Request(`https://w.dev/tools/arw-fetch?key=${encodeURIComponent(s.body.key)}`, { headers: range ? { Range: range } : {} });
    return encUploadMachine(req, env as any, '/tools/arw-fetch', new URL(req.url), json);
  };
  const whole = await get();
  assert.equal(whole!.status, 200); assert.equal((await whole!.arrayBuffer()).byteLength, 30);
  const piece = await get('bytes=18-21');
  assert.equal(piece!.status, 206); assert.equal(piece!.headers.get('Content-Range'), 'bytes 18-21/30');
  assert.deepEqual([...new Uint8Array(await piece!.arrayBuffer())], [1, 1, 2, 2]);
  const gotReq = new Request(`https://w.dev/tools/arw-fetched?key=${encodeURIComponent(s.body.key)}`, { method: 'POST' });
  await encUploadMachine(gotReq, env as any, '/tools/arw-fetched', new URL(gotReq.url), json);
  assert.equal(env.MEDIA.objs.size, 0);
});

test('wrong files, pieces and keys are refused', async () => {
  const env = { MEDIA: r2(), ANALYTICS: d1(), PUSH_KV: kv() };
  assert.equal((await call(env, '/api/studio/tools/server/upload/start', { name: 'virus.exe', size: 5 })).status, 400);
  assert.equal((await call(env, '/api/studio/tools/server/upload/start', { name: 'a.mkv', size: 0 })).status, 400);
  assert.equal((await call(env, '/api/studio/tools/server/upload/part?key=shows/x.jpg&uploadId=u1&n=1', new Uint8Array(3))).status, 400);
  const req = new Request('https://w.dev/tools/arw-fetch?key=shows/logo.png');
  assert.equal((await encUploadMachine(req, env as any, '/tools/arw-fetch', new URL(req.url), json))!.status, 404);
});

test('a file the machine never took is gone after 3 days', async () => {
  const env = { MEDIA: r2(), ANALYTICS: d1(), PUSH_KV: kv() };
  env.MEDIA.objs.set('enc-up/0123456789abcdef0123456789abcdef/old.mka', { data: new Uint8Array(1), at: Date.now() - 4 * 86400_000 });
  env.MEDIA.objs.set('enc-up/0123456789abcdef0123456789abcdee/new.mka', { data: new Uint8Array(1), at: Date.now() });
  await encUploadSweep(env as any);
  assert.deepEqual([...env.MEDIA.objs.keys()], ['enc-up/0123456789abcdef0123456789abcdee/new.mka']);
});
