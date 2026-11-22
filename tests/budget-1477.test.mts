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

import { periodOf, judge, r2Class, budgetProblems, readUsage, INCLUDED } from '../worker/src/budget.ts';

test('INCIDENTS #1477: the billing period runs from the 22nd to the 22nd (UTC)', () => {
  assert.deepEqual(periodOf(Date.UTC(2026, 10, 22, 12)), { start: Date.UTC(2026, 10, 22), end: Date.UTC(2026, 11, 22) });
  assert.deepEqual(periodOf(Date.UTC(2026, 11, 5)), { start: Date.UTC(2026, 10, 22), end: Date.UTC(2026, 11, 22) });
  assert.deepEqual(periodOf(Date.UTC(2027, 0, 10)), { start: Date.UTC(2026, 11, 22), end: Date.UTC(2027, 0, 22) });
});

test('INCIDENTS #1477: last period (85 million CPU-ms, 11,611 build minutes) would have braked and warned', () => {
  const now = Date.UTC(2026, 10, 21, 23);
  const s = judge({ cpuMs: 85_440_150, buildMinutes: 11_611, requests: 4_411_010 }, now);
  assert.equal(s.brakeCpu, true);
  assert.deepEqual(s.warn.sort(), ['buildMinutes', 'cpuMs']);
  const p = budgetProblems(s, now);
  assert.equal(p[0].code, 'budget_high');
  assert.match(p[0].title, /واقفين لحد يوم ٢٢/); // 285% of the CPU allowance: the hard stop of INCIDENTS #1478
  assert.match(budgetProblems(judge({ cpuMs: 23_000_000 }, now), now)[0].title, /تصغير الصور الجديدة واقف/);
});

test('INCIDENTS #1477: a quiet period neither brakes nor warns, and the first hours never alarm on projection alone', () => {
  const start = Date.UTC(2026, 10, 22);
  assert.deepEqual(judge({ cpuMs: 1_000_000, requests: 100_000 }, start + 10 * 86_400_000).warn, []);
  const early = judge({ cpuMs: 600_000, buildMinutes: 133 }, start + 12 * 3600_000);
  assert.equal(early.brakeCpu, false);
  assert.deepEqual(early.warn, []);
  // a day in, on course to pass 90%: warn
  assert.deepEqual(judge({ cpuMs: 1_000_000 * 1.2 }, start + 86_400_000).warn, ['cpuMs']);
  assert.equal(budgetProblems({ ...judge({ cpuMs: 25_000_000 }, start + 5 * 86_400_000) }, start + 9 * 86_400_000).length, 0, 'a verdict over 3 hours old says nothing');
});

test('INCIDENTS #1477: R2 operations are counted in their class, deletes free', () => {
  assert.equal(r2Class('GetObject'), 'B');
  assert.equal(r2Class('HeadObject'), 'B');
  assert.equal(r2Class('PutObject'), 'A');
  assert.equal(r2Class('ListObjects'), 'A');
  assert.equal(r2Class('DeleteObject'), null);
  assert.equal(INCLUDED.cpuMs, 30_000_000);
});

test('INCIDENTS #1477: one GraphQL call reads every metric', async () => {
  const calls: any[] = [];
  const fake = (async (_u: string, init: any) => {
    calls.push(JSON.parse(init.body).query);
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{
      w: [{ sum: { requests: 10, cpuTimeUs: 5000 } }, { sum: { requests: 5, cpuTimeUs: 1000 } }],
      b: [{ sum: { buildMinutes: 3 } }],
      k: [{ sum: { requests: 7 }, dimensions: { actionType: 'read' } }, { sum: { requests: 2 }, dimensions: { actionType: 'write' } }],
      d: [{ sum: { rowsRead: 100, rowsWritten: 4 } }],
      o: [{ sum: { requests: 1 } }],
      r: [{ sum: { requests: 9 }, dimensions: { actionType: 'GetObject' } }, { sum: { requests: 2 }, dimensions: { actionType: 'PutObject' } }, { sum: { requests: 50 }, dimensions: { actionType: 'DeleteObject' } }],
      s: [{ max: { payloadSize: 100, metadataSize: 1 }, dimensions: { bucketName: 'a', date: '2026-11-22' } }, { max: { payloadSize: 90, metadataSize: 1 }, dimensions: { bucketName: 'a', date: '2026-11-21' } }, { max: { payloadSize: 50, metadataSize: 0 }, dimensions: { bucketName: 'b', date: '2026-11-22' } }],
    }] } } }));
  }) as typeof fetch;
  const u = await readUsage('t', 'acc', Date.UTC(2026, 10, 22), Date.UTC(2026, 10, 23), fake);
  assert.equal(calls.length, 1);
  assert.deepEqual(u, { requests: 15, cpuMs: 6, buildMinutes: 3, kvReads: 7, kvWrites: 2, kvDeletes: 0, kvLists: 0, d1RowsRead: 100, d1RowsWritten: 4, doRequests: 1, r2ClassA: 2, r2ClassB: 9, r2StorageBytes: 151 });
});

test('INCIDENTS #1477: the bot checks hourly and /health raises the alert', () => {
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /CHECK_MINUTES\.includes\(minute\) \? runBudgetCheck\(env as any, _controller\.scheduledTime\)/);
  assert.match(fs.readFileSync('worker/src/health.ts', 'utf8'), /mergeProblems\(problems, budgetProblems\(budget, now\), \["budget_high"\], now\)/);
});
