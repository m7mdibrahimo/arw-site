import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { showNameForms } = require('../lib/show-seo.cjs');

// INCIDENTS #1256: «AEW Dynamite and Collision» was read as a themed Dynamite episode: «and Collision», «AEW and Collision
// 2026» as alternate names, and no Collision name with the date.
test('a joined episode carries the second program\'s dated names, never «and Collision»', () => {
  const f = showNameForms({ headline: 'عرض داينامايت 11.11.2026 مترجم', title: 'AEW Dynamite and Collision 11.11.2026', programName: 'AEW Dynamite', eventDate: '2026-11-11', isShow: true });
  assert.ok(!f.some((x: string) => /^(?:AEW )?and Collision/i.test(x)), f.filter((x: string) => /and/i.test(x)).join(' | '));
  for (const want of ['AEW Collision November 11 2026', 'AEW Collision 11.11.2026', 'عرض كوليجن 11.11.2026', 'عرض داينامايت وكوليجن 11.11.2026']) assert.ok(f.includes(want), want);
  assert.ok(!f.includes('AEW Collision'), 'the bare program name stays with its own latest page');
});

test('a real theme still gets its theme names', () => {
  const f = showNameForms({ headline: 'عرض داينامايت 04.11.2026 مترجم', title: 'AEW Dynamite Blood & Guts 04.11.2026', programName: 'AEW Dynamite', eventDate: '2026-11-04', isShow: true });
  assert.ok(f.includes('AEW Blood and Guts 2026'));
});

// INCIDENTS #1291: the theme was only in English — «بلود اند جتس» is how it's typed in Arabic
test('a themed episode carries its theme in Arabic letters', () => {
  const f = showNameForms({ headline: 'عرض داينامايت 04.11.2026 مترجم', title: 'AEW Dynamite Blood & Guts 04.11.2026', programName: 'AEW Dynamite', eventDate: '2026-11-04', isShow: true });
  for (const want of ['بلود اند جتس', 'عرض بلود اند جتس 2026', 'بلود اند جتس مترجم']) assert.ok(f.includes(want), want);
  const plain = showNameForms({ headline: 'عرض داينامايت 11.11.2026 مترجم', title: 'AEW Dynamite 11.11.2026', programName: 'AEW Dynamite', eventDate: '2026-11-11', isShow: true });
  assert.ok(!plain.some((x: string) => x.includes('بلود')));
});
