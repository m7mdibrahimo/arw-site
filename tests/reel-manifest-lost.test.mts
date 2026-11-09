// INCIDENTS #1153: a reel already on the site but missing from the manifest (two renders raced) is still found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReelOnSite } from '../scripts/show-reel-monitor';

const fake = (served: string[]) => (async (url: string) => {
  const name = decodeURIComponent(String(url).split('/videos/')[1] || '');
  return served.includes(name)
    ? new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } })
    : new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}) as unknown as typeof fetch;

test('the 45-character reel name served by the site is used', async () => {
  const slug = '20261109062934-cmll-martes-de-glamour-03-11-2026';
  assert.equal(await findReelOnSite(slug, fake(['reel-20261109062934-cmll-martes-de-glamour-03-11-2.mp4'])), 'reel-20261109062934-cmll-martes-de-glamour-03-11-2.mp4');
});

test('nothing on the site means still waiting, and a 200 page that is not a video does not count', async () => {
  assert.equal(await findReelOnSite('20261109000000-wwe-raw-09-11-2026', fake([])), null);
  const html = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
  assert.equal(await findReelOnSite('20261109000000-wwe-raw-09-11-2026', html), null);
});
