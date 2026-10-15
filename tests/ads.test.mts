// No ads for a member with «العضوية المميزة», ever (owner 2026-10-15): the site has none yet; when it does, every ad
// script is loaded only when window.arwShowAds() says so, and every ad spot is hidden for those members from the first paint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const nunjucks = require('nunjucks');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(new URL('../_includes', import.meta.url).pathname));
function run(member: any) {
  const html = env.render('theme-init.njk', { ads: { scripts: [{ src: 'https://ads.example/net.js', attrs: { 'data-zone': '7' } }] } });
  const added: any[] = [];
  const classes = new Set<string>();
  const store: Record<string, string> = member ? { 'arw-member': JSON.stringify({ token: 't', member }) } : {};
  const el = () => ({ attrs: {} as any, setAttribute(k: string, v: string) { this.attrs[k] = v; } });
  const ctx: any = {
    localStorage: { getItem: (k: string) => store[k] ?? null },
    document: { cookie: '', documentElement: { classList: { add: (c: string) => classes.add(c), contains: (c: string) => classes.has(c) } }, createElement: () => el(), head: { appendChild: (x: any) => added.push(x) } },
    Date,
  };
  ctx.window = ctx;
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], ctx);
  return { html, added, classes, show: ctx.window.arwShowAds() };
}

test('a member with the membership gets no ad scripts and no ad spots; everyone else does; it ends with the membership', () => {
  const prem = run({ username: 'a', premium: Date.now() + 86400e3 });
  assert.equal(prem.show, false);
  assert.equal(prem.added.length, 0);
  const free = run({ username: 'b', premium: 0 });
  assert.equal(free.show, true);
  assert.deepEqual(free.added.map((x) => [x.src, x.attrs['data-zone']]), [['https://ads.example/net.js', '7']]);
  assert.equal(run(null).added.length, 1);
  assert.equal(run({ username: 'c', premium: Date.now() - 1000 }).added.length, 1);
  assert.equal(run({ username: 'site', official: true }).added.length, 0);
  // the spots, hidden for them from the first paint: the site's own and the usual networks'
  for (const sel of ['html.arw-is-prem .arw-ad', 'html.arw-is-prem [data-arw-ad]', 'html.arw-is-prem ins.adsbygoogle', 'html.arw-is-prem [id^="div-gpt-ad"]']) assert.ok(prem.html.includes(sel), sel);
  // no ads today: nothing is loaded for anyone
  const none = env.render('theme-init.njk', { ads: require('../_data/ads.js') });
  assert.doesNotMatch(none, /arwShowAds\(\)\)\{\[/);
});
