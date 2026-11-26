// «بث مباشر»: each server opened like a visitor opens it — framed in our page, clicked once — to know which play, how
// fast the picture comes, and the picture's real size (owner 2026-11-26: «خلي اول سيرفر دايما هو اسرع سيرفر… اتاكد منهم
// انهم شغاليين دايما»). Runs from .github/workflows/live-check.yml around a show; the answer goes to /api/live/health,
// which orders the servers (fastest first) and keeps the stopped ones out of sight. Nothing passes through our Worker.
import { chromium } from 'playwright';

const API = process.env.WORKER_API || 'https://arw-site-bot.m7mdibrahimpc.workers.dev';
const TOKEN = process.env.GITHUB_TOKEN || '';
const WAIT = 30_000;
const now = Date.now();

const data = await fetch(API + '/live/data').then((r) => r.json());
// from three hours before a show to its end: the channels are on before the show, so the order is right at the start
const near = (data.shows || []).filter((s) => now > s.start - 3 * 3_600_000 && now < s.end);
const urls = [...new Set(near.flatMap((s) => (s.sv || []).filter((v) => !v.x).map((v) => v.u)))];
if (!urls.length) { console.log('no show near: nothing to check'); process.exit(0); }
console.log(`checking ${urls.length} servers of ${near.map((s) => s.k).join(', ')}`);

// Google Chrome (the runner has it): it plays H.264, which Chromium alone does not
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });

async function check(u) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  try {
    await ctx.route('https://arab-wrestling.com/__live-check', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="margin:0"><iframe src="${u.replace(/"/g, '&quot;')}" style="width:960px;height:540px;border:0" allow="autoplay; fullscreen" allowfullscreen></iframe></body>` }));
    const p = await ctx.newPage();
    p.on('popup', (x) => x.close().catch(() => {}));
    const t0 = Date.now(); let seg = 0, plOk = 0, plBad = 0, docBad = 0;
    p.on('response', (r) => {
      const x = r.url(), st = r.status();
      if (x === u && st >= 400) docBad = st;
      if (/\.m3u8(\?|$)/i.test(x) && !(st >= 300 && st < 400)) { if (st < 300) plOk++; else plBad++; }
      if (!seg && st < 400 && /\.(ts|m4s|aac)(\?|$)|\/seg[-_]?\d|segment/i.test(x)) seg = Date.now() - t0;
    });
    await p.goto('https://arab-wrestling.com/__live-check', { timeout: 20_000 }).catch(() => {});
    let clicks = 0;
    while (Date.now() - t0 < WAIT) {
      await p.waitForTimeout(700);
      const v = (await Promise.all(p.frames().map((f) => f.evaluate(() => { const x = document.querySelector('video'); return x && x.videoWidth > 0 ? { w: x.videoWidth, h: x.videoHeight, t: x.currentTime } : null; }).catch(() => null)))).find(Boolean);
      if (v && (seg || v.t > 0)) return { u, ok: 1, ms: seg || Date.now() - t0, h: v.h };
      // a visitor's click on the player, twice at most (some start only on a click)
      if ((Date.now() - t0 > 5000 && clicks === 0) || (Date.now() - t0 > 12_000 && clicks === 1)) { clicks++; await p.mouse.click(480, 300).catch(() => {}); }
    }
    // stopped only on a plain answer: the server's page or its stream «not found»; a player that only spins in a robot
    // browser (the hosts start on a visitor's click, behind an ad window) is not known either way — left as it is
    if (docBad || (plBad && !plOk)) return { u, ok: 0, ms: WAIT, why: docBad ? `page ${docBad}` : 'stream not found' };
    return { u, unknown: 1 };
  } catch (e) { return { u, unknown: 1 }; }
  finally { await ctx.close().catch(() => {}); }
}

const out = [];
for (let i = 0; i < urls.length; i += 3) out.push(...(await Promise.all(urls.slice(i, i + 3).map(check))));
await browser.close();
for (const c of out) console.log(`${c.unknown ? 'unknown' : c.ok ? 'plays  ' : 'stopped'} ${c.unknown ? '' : String(c.ms).padStart(6) + ' ms'} ${c.h ? c.h + 'p' : ''}${c.why ? ' (' + c.why + ')' : ''}  ${c.u}`);

const r = await fetch(API + '/api/live/health', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ checks: out }) });
console.log('saved:', r.status, await r.text());
if (!r.ok) process.exit(1);
