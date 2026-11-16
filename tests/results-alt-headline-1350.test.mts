import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resultsAltHeadline } = require("../lib/results-headline.cjs");

// INCIDENTS #1350: «نتائج عرض الرو الاخير» (7.5) and «نتائج عرض سماك داون الاخير 2026» (6.7) went to the home page:
// results stories name the program only in Latin letters.
test("a weekly results story gets the Arabic program name, dotted date and English form", () => {
  assert.equal(
    resultsAltHeadline("نتائج عرض WWE RAW (9 نوفمبر 2026): فوز آيو سكاي وبيكي لينش في الحدث الرئيسي"),
    "نتائج عرض الرو 9 نوفمبر 2026 (09.11.2026) — WWE Raw Results November 9, 2026",
  );
  assert.equal(
    resultsAltHeadline("نتائج عرض WWE SmackDown 6 نوفمبر 2026: نزال No Holds Barred"),
    "نتائج عرض سماك داون 6 نوفمبر 2026 (06.11.2026) — WWE SmackDown Results November 6, 2026",
  );
  assert.equal(
    resultsAltHeadline("نتائج تسجيلات عرض TNA iMPACT القادم 27 أغسطس 2026"),
    "نتائج عرض امباكت 27 أغسطس 2026 (27.08.2026) — TNA iMPACT Results August 27, 2026",
  );
});

test("other stories get nothing", () => {
  assert.equal(resultsAltHeadline("كي سي نافارو يفوز بنزال ألتيميت إكس للرجال"), "");
  assert.equal(resultsAltHeadline("نتائج عرض TNA Destination X 15 نوفمبر 2026"), "");
  assert.equal(resultsAltHeadline("نتائج عرض WWE RAW الليلة"), "");
});
