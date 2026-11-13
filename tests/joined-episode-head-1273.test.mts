import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { showSeoText } = require('../lib/show-seo.cjs');

// INCIDENTS #1273: the AEW Dynamite and Collision 11.11.2026 page's Google title and description named only «داينامايت»
// in Arabic — «كوليجن» was in alternateName only.
test('a joined episode names both programs in Arabic in the head title and description', () => {
  const r = showSeoText({ headline: 'عرض داينامايت 11.11.2026 مترجم', title: 'AEW Dynamite and Collision (11.11.2026)', programName: 'AEW Dynamite', eventDate: '2026-11-11', day: '11 نوفمبر 2026', isLatest: true, description: '' });
  assert.match(r.title, /^عرض داينامايت وكوليجن الأخير 11\.11\.2026 كامل مترجم/);
  assert.match(r.description, /عرض داينامايت وكوليجن الأخير 11\.11\.2026/);
});

test('a plain or themed Dynamite keeps its own title', () => {
  const plain = showSeoText({ headline: 'عرض داينامايت 04.11.2026 مترجم', title: 'AEW Dynamite (04.11.2026)', programName: 'AEW Dynamite', eventDate: '2026-11-04', day: '4 نوفمبر 2026', isLatest: false, description: '' });
  assert.equal(plain.title, 'عرض داينامايت 04.11.2026 كامل مترجم — AEW Dynamite');
  const themed = showSeoText({ headline: 'عرض داينامايت 04.11.2026 مترجم', title: 'AEW Dynamite Blood & Guts (04.11.2026)', programName: 'AEW Dynamite', eventDate: '2026-11-04', day: '4 نوفمبر 2026', isLatest: false, description: '' });
  assert.ok(!themed.title.includes(' و'), themed.title);
});
