// INCIDENTS #1198: NXT pages at 9.1 / 30.1 for «عروض المصارعة الحرة» — the description names the category in full
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { showSeoText } = createRequire(import.meta.url)('../lib/show-seo.cjs');

test('the NXT description says «من عروض المصارعة الحرة المترجمة»; RAW keeps its line for now', () => {
  const nxt = showSeoText({ headline: 'عرض ان اكس تي 04.11.2026 مترجم', title: 'WWE NXT 04.11.2026', programName: 'WWE NXT', eventDate: '2026-11-04', day: '4 نوفمبر 2026', isLatest: true });
  assert.match(nxt.description, /من عروض المصارعة الحرة المترجمة\.$/);
  assert.match(nxt.description, /دبليو دبليو إي ان اكس تي 4 نوفمبر 2026/);
  assert.ok(nxt.description.length < 215, nxt.description);
  const raw = showSeoText({ headline: 'عرض الرو 02.11.2026 مترجم', title: 'WWE RAW 02.11.2026', programName: 'WWE RAW', eventDate: '2026-11-02', day: '2 نوفمبر 2026', isLatest: false });
  assert.match(raw.description, /، مصارعة حرة مترجمة\.$/);
});
