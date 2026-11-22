// INCIDENTS #1478: the owner — «مش عايزه يسحب ابدا اكتر من كدا مهما يحصل». Cloudflare has no spending cap, so at 90% of
// anything the 5-dollar plan includes, the site stops everything that costs until the period ends on the 22nd: a zone
// firewall rule blocks the pictures/videos before arw-media runs, the bot's workers.dev address goes off, the bot's minute
// job does nothing but the check. Only what the guard stopped is switched back on, when the new period begins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judge, applyHardStop, setStopRule, setBotAddress, budgetProblems, runBudgetCheck, HARD_KEY, STOP_RULE, CHECK_MINUTES } from '../worker/src/budget.ts';

const now = Date.UTC(2026, 11, 10, 12);

function kv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) } as any;
}
/** A fake Cloudflare API: the zone's custom-rules entrypoint (absent at first) and the bot's workers.dev switch. */
function api(start: { rules?: any[] | null; sub?: boolean } = {}) {
  const st = { rules: start.rules === undefined ? null : start.rules, sub: start.sub ?? true, calls: [] as string[], tg: [] as string[] };
  const f = (async (url: string, init: any = {}) => {
    const u = new URL(url); const p = u.pathname.replace('/client/v4', ''); const m = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const ok = (result: any) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (u.hostname === 'api.telegram.org') { st.tg.push(body.text); return ok(true); }
    st.calls.push(`${m} ${p}`);
    if (p.endsWith('/phases/http_request_firewall_custom/entrypoint')) {
      if (m === 'GET') return st.rules === null ? new Response(JSON.stringify({ success: false }), { status: 404 }) : ok({ id: 'rs1', rules: st.rules });
      if (m === 'PUT') { st.rules = body.rules.map((r: any, i: number) => ({ id: 'r' + i, ...r })); return ok({ id: 'rs1', rules: st.rules }); }
    }
    if (p === '/zones/3b71ea65441dd354d82e877d737835b3/rulesets/rs1/rules' && m === 'POST') { st.rules!.push({ id: 'rN', ...body }); return ok({}); }
    const rm = p.match(/\/rulesets\/rs1\/rules\/(\w+)$/);
    if (rm && m === 'PATCH') { const r = st.rules!.find((x) => x.id === rm[1]); Object.assign(r, body); return ok({}); }
    if (p.endsWith('/workers/scripts/arw-site-bot/subdomain')) {
      if (m === 'GET') return ok({ enabled: st.sub, previews_enabled: true });
      if (m === 'POST') { st.sub = body.enabled; return ok({ enabled: st.sub }); }
    }
    return new Response('{}', { status: 500 });
  }) as typeof fetch;
  return { st, f };
}

test('INCIDENTS #1478: 90% of any allowance (but build minutes) is a hard stop; below it is not', () => {
  assert.equal(judge({ cpuMs: 26_000_000 }, now).hardStop, false);
  const s = judge({ cpuMs: 27_000_000 }, now);
  assert.equal(s.hardStop, true); assert.deepEqual(s.hard, ['cpuMs']); assert.equal(s.brakeCpu, true);
  assert.deepEqual(judge({ requests: 9_100_000 }, now).hard, ['requests']);
  assert.deepEqual(judge({ kvWrites: 950_000 }, now).hard, ['kvWrites']);
  assert.equal(judge({ buildMinutes: 5_900 }, now).hardStop, false, 'blocking visitors cannot stop a build trigger: alert only');
  assert.ok(judge({ buildMinutes: 5_900 }, now).warn.includes('buildMinutes'));
});

test('INCIDENTS #1478: the stop adds the firewall rule (zone had none), turns the bot address off, remembers it; the release undoes both', async () => {
  const { st, f } = api(); const env = { PUSH_KV: kv(), CF_GUARD_TOKEN: 't' };
  assert.equal(await applyHardStop(env, judge({ cpuMs: 28_000_000 }, now), f), 'stopped');
  assert.equal(st.rules!.length, 1); assert.equal(st.rules![0].ref, STOP_RULE.ref); assert.equal(st.rules![0].enabled, true); assert.equal(st.rules![0].action, 'block');
  assert.equal(st.sub, false);
  assert.ok(env.PUSH_KV.m.get(HARD_KEY));
  assert.equal(await applyHardStop(env, judge({ cpuMs: 29_000_000 }, now), f), 'holding');
  const released = await applyHardStop(env, judge({ cpuMs: 10_000 }, Date.UTC(2026, 11, 22, 0, 5)), f);
  assert.equal(released, 'released');
  assert.equal(st.rules![0].enabled, false); assert.equal(st.sub, true); assert.equal(env.PUSH_KV.m.get(HARD_KEY), undefined);
});

test('INCIDENTS #1478: with no stop in place nothing is touched — not the owner\'s own firewall rules, not the bot address', async () => {
  const { st, f } = api({ rules: [{ id: 'own', ref: 'owner', expression: 'x', action: 'block', enabled: true }], sub: false });
  const env = { PUSH_KV: kv(), CF_GUARD_TOKEN: 't' };
  assert.equal(await applyHardStop(env, judge({ cpuMs: 1_000 }, now), f), 'none');
  assert.deepEqual(st.calls, []); assert.equal(st.sub, false);
  // a stop adds its rule next to the owner's, and leaves the owner's alone
  await applyHardStop(env, judge({ cpuMs: 28_000_000 }, now), f);
  assert.equal(st.rules!.length, 2); assert.equal(st.rules![0].enabled, true); assert.equal(st.rules![0].ref, 'owner');
});

test('INCIDENTS #1478: setting a state it is already in calls nothing that writes', async () => {
  const { st, f } = api({ rules: [{ id: 'r0', ...STOP_RULE, enabled: false }] });
  assert.equal(await setStopRule(false, 't', f), false);
  assert.equal(await setBotAddress(true, 't', f), false);
  assert.ok(st.calls.every((c) => c.startsWith('GET ')));
});

test('INCIDENTS #1478: the firewall rule blocks exactly arw-media\'s routes (pictures, resized pictures, videos), never the pages', () => {
  const media = fs.readFileSync('media-worker/wrangler.toml', 'utf8');
  for (const path of ['/content/images/', '/videos/', '/img/']) {
    assert.ok(media.includes(`arab-wrestling.com${path}*`), path);
    assert.ok(STOP_RULE.expression.includes(`"${path}"`), path);
  }
  assert.doesNotMatch(STOP_RULE.expression, /"\/"\)/);
});

test('INCIDENTS #1478: the owner is told on Telegram when the stop starts, and when the new month brings everything back', async () => {
  const { st, f } = api(); const env: any = { PUSH_KV: kv(), CF_GUARD_TOKEN: 't', CF_USAGE_TOKEN: 'u', TELEGRAM_BOT_TOKEN: 'b', ADMIN_TELEGRAM_CHAT_ID: '1' };
  const usage = (cpuTimeUs: number) => (async (url: string, init: any) => url.includes('/graphql')
    ? new Response(JSON.stringify({ data: { viewer: { accounts: [{ w: [{ sum: { requests: 1, cpuTimeUs } }] }] } } }))
    : f(url, init)) as typeof fetch;
  await runBudgetCheck(env, now, usage(28_000_000_000));
  assert.equal(st.tg.length, 1); assert.match(st.tg[0], /٩٠٪/); assert.match(st.tg[0], /يوم ٢٢/);
  await runBudgetCheck(env, now + 900_000, usage(28_500_000_000));
  assert.equal(st.tg.length, 1, 'once, not every 15 minutes');
  await runBudgetCheck(env, Date.UTC(2026, 11, 22, 0, 5), usage(1_000));
  assert.equal(st.tg.length, 2); assert.match(st.tg[1], /رجعت/);
  assert.equal(st.sub, true);
});

test('INCIDENTS #1478: /health names the stop; the check runs every 15 minutes; the minute job skips the rest during a stop', () => {
  assert.match(budgetProblems(judge({ cpuMs: 28_000_000 }, now), now)[0].title, /واقفين لحد يوم ٢٢/);
  assert.deepEqual(CHECK_MINUTES, [5, 20, 35, 50]);
  const idx = fs.readFileSync('worker/src/index.ts', 'utf8');
  const sched = idx.slice(idx.indexOf('async scheduled('));
  assert.match(sched, /if \(await hardStopped\(env\)\) \{ ctx\.waitUntil\(budget\); return; \}/);
  assert.ok(sched.indexOf('hardStopped(env)') < sched.indexOf('runWatcherPoll'), 'before any other work');
  const media = fs.readFileSync('media-worker/src/index.ts', 'utf8');
  assert.match(media, /resizeBraked\(env\)\.then\(\(braked\) => braked \? 0 : compressStored\(env\)\)/);
});
