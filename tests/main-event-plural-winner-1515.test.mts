import { test } from "node:test";
import assert from "node:assert/strict";
import { resultsTitleOutcome } from "../scripts/news-qa.ts";

// RAW 23/11/2026: «🏆 **الفائزات:**» was read as «الفائز» + name «ات» → title «فوز ات في الحدث الرئيسي» (INCIDENTS #1515).
const body = "**الحدث الرئيسي (Main Event): نزال فرق للسيدات**\n\nنص.\n\n🏆 **الفائزات:** بايلي وستيفاني فاكير\n";

test("feminine-plural winner line gives the real names", () => {
  assert.equal(
    resultsTitleOutcome("نتائج عرض WWE RAW (23 نوفمبر 2026): مواجهات نارية", body),
    "نتائج عرض WWE RAW (23 نوفمبر 2026): فوز بايلي وستيفاني فاكير في الحدث الرئيسي");
});

test("an already-broken «فوز ات» title is rebuilt", () => {
  assert.equal(
    resultsTitleOutcome("نتائج عرض WWE RAW (23 نوفمبر 2026): فوز ات في الحدث الرئيسي", body),
    "نتائج عرض WWE RAW (23 نوفمبر 2026): فوز بايلي وستيفاني فاكير في الحدث الرئيسي");
});

test("a bare plural ending is never used as a winner", () => {
  const t = "نتائج عرض WWE RAW (23 نوفمبر 2026): مواجهات نارية";
  assert.equal(resultsTitleOutcome(t, "**الحدث الرئيسي**\n\n🏆 **الفائزون:** ون\n"), t);
});
