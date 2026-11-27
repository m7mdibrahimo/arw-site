import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1567: مفعول به نكرة جمع تكسير لازم منصوب: «قدم نجوما بارزين».
test("round 2026-11-27 accusative corrections", () => {
  assert.equal(applyCorrections("مشهد مستقل قوي قدم نجوم بارزين مثل ريا ريبلي"), "مشهد مستقل قوي قدم نجوما بارزين مثل ريا ريبلي");
  assert.equal(applyCorrections("وتضم نجوم عالميين"), "وتضم نجوما عالميين");
  assert.equal(applyCorrections("نجوم بارزين في القائمة"), "نجوم بارزين في القائمة");
});
