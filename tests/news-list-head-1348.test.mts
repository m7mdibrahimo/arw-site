import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// INCIDENTS #1348: «اخبار المصارعة الحرة wwe» (8.3) and «اخبار المصارعة» landed on the home page, not /news/:
// the news list names WWE and AEW in its <title>, description and CollectionPage alternateName — head only.
const src = readFileSync(new URL("../pages/news.njk", import.meta.url), "utf8");
const en = createRequire(import.meta.url)("../lib/i18n/en.cjs");
const dict = en.default || en.UI || en.dictionary || en;

test("the news list head names WWE/AEW news, page 1 only in the title", () => {
  assert.match(src, /\{% else %\} — أخبار WWE وAEW\{% endif %\} \| عرب راسلنج<\/title>/);
  assert.match(src, /"alternateName": \[[^\]]*"اخبار المصارعة الحرة WWE"/);
  assert.match(src, /content="آخر أخبار المصارعة الحرة اليوم بالعربية: أخبار WWE وAEW وTNA/);
});

test("the English mirror has the new title and descriptions", () => {
  const s = readFileSync(new URL("../lib/i18n/en.cjs", import.meta.url), "utf8");
  for (const k of ["أخبار المصارعة الحرة اليوم — أخبار WWE وAEW | عرب راسلنج", "آخر أخبار المصارعة الحرة اليوم بالعربية: أخبار WWE وAEW وTNA أولاً بأول."]) {
    assert.ok(s.includes(JSON.stringify(k) + ":"), k);
  }
  assert.ok(dict);
});
