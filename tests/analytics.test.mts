// The site's own statistics, people only (owner 2026-10-12 — INCIDENTS #457)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordView, pagePath, BOT_UA, fromSite, cairo, siteAnalytics } from '../worker/src/analytics';

function fakeDb() {
  const runs: { sql: string; args: unknown[] }[] = [];
  const stmt = (sql: string) => ({ sql, args: [] as unknown[], bind(...a: unknown[]) { this.args = a; return this; }, all: async () => ({ results: [] }) });
  return { runs, prepare: stmt, batch: async (list: any[]) => { for (const s of list) runs.push({ sql: s.sql, args: s.args }); return list.map(() => ({ results: [] })); } };
}
const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; };
const req = (body: unknown, headers: Record<string, string>) => new Request('https://arw-site-bot.example/v', { method: 'POST', body: JSON.stringify(body), headers });

test('a view from a person on the site is counted once in every table; bots and other sites are not', async () => {
  const db = fakeDb();
  const env: any = { ANALYTICS: db, PUSH_KV: kv() };
  const person = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', Origin: 'https://arab-wrestling.com', 'CF-Connecting-IP': '41.1.2.3' };
  const r = await recordView(req({ p: '/shows/wwe-money-in-the-bank-2026/' }, person), env, Date.parse('2026-10-12T20:30:00Z'));
  assert.equal(r.status, 204);
  assert.equal(db.runs.length, 8);
  assert.deepEqual(db.runs[0].args, ['2026-10-12', '/shows/wwe-money-in-the-bank-2026/']);
  assert.equal(db.runs[2].args[0], '2026-10-12T23', 'Cairo time');
  // the visitor is a hash, never the address
  assert.ok(!JSON.stringify(db.runs).includes('41.1.2.3'));
  for (const ua of ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)', 'node', 'curl/8.5.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36', 'Mozilla/5.0 (compatible)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'facebookexternalhit/1.1']) {
    const before = db.runs.length;
    await recordView(req({ p: '/' }, { ...person, 'User-Agent': ua }), env);
    assert.equal(db.runs.length, before, ua);
    assert.ok(BOT_UA.test(ua), ua);
  }
  const before = db.runs.length;
  await recordView(req({ p: '/' }, { ...person, Origin: 'https://evil.example' }), env);
  await recordView(req({ p: '/assets/site.css' }, person), env);
  assert.equal(db.runs.length, before);
});

test('page addresses are counted the way the site writes them', () => {
  assert.equal(pagePath('/news/%D8%AE%D8%A8%D8%B1/?utm=x'), '/news/خبر/');
  assert.equal(pagePath('/shows/x'), '/shows/x/');
  assert.equal(pagePath('/shows/x/index.html'), '/shows/x/');
  assert.equal(pagePath('/admin/'), null);
  assert.equal(pagePath('/sitemap.xml'), null);
  assert.equal(pagePath('https://evil.example/'), null);
  assert.ok(fromSite(null, 'https://www.arab-wrestling.com/shows/x/'));
  assert.ok(!fromSite('https://arab-wrestling.com.evil.example', null));
  assert.equal(cairo(Date.parse('2026-10-12T22:30:00Z')).day, '2026-10-13');
});

test('days before the counter started show no number rather than a wrong one', async () => {
  const rows: Record<string, any[]> = {
    day_views: [{ day: '2026-10-12', views: 20000 }],
    visitor_daily_by_day: [{ day: '2026-10-12', n: 3000 }],
    min: [{ d: '2026-10-12' }],
  };
  const db: any = { prepare: (sql: string) => ({ sql, bind() { return this; } }), batch: async (list: any[]) => list.map((s: any) =>
    ({ results: /MIN\(day\)/.test(s.sql) ? rows.min : /FROM day_views/.test(s.sql) ? rows.day_views : /FROM visitor_daily WHERE/.test(s.sql) ? rows.visitor_daily_by_day : [] })) };
  const a = await siteAnalytics({ ANALYTICS: db, PUSH_KV: kv() as any }, 3, Date.parse('2026-10-12T12:00:00Z'));
  // a day the counter didn't see: «—» for views and visitors alike
  assert.deepEqual(a.daily.map(d => [d.date, d.views, d.visitors]), [['2026-10-10', null, null], ['2026-10-11', null, null], ['2026-10-12', 20000, 3000]]);
  assert.equal(a.visitorsSince, '2026-10-12');
});

test('every page loads the counter, which waits until a person really sees the page', () => {
  assert.match(fs.readFileSync('_includes/theme-init.njk', 'utf8'), /<script src="\/assets\/v\.js\?v=\d+" defer><\/script>/);
  const v = fs.readFileSync('assets/v.js', 'utf8');
  assert.match(v, /navigator\.webdriver/);
  assert.match(v, /document\.prerendering/);
  assert.match(v, /visibilityState/);
  const toml = fs.readFileSync('worker/wrangler.toml', 'utf8');
  assert.match(toml, /binding = "ANALYTICS"\ndatabase_name = "arw-analytics"/);
  assert.match(fs.readFileSync('worker/src/index.ts', 'utf8'), /if \(path === "\/v"\) return recordView\(request, env\);/);
});
