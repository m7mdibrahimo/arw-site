import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1489: «سكاي راي»، «عرض 24 أغسطس من عرض WWE SmackDown»، «طوال 100 يوم الماضية».
test("round 2026-11-22 Skylar Rae, «edition of» dates and «100 يوم الماضية» are corrected", () => {
  assert.equal(applyCorrections("هزمت سكاي راي منافستها كينزي."), "هزمت سكايلر راي منافستها كينزي.");
  assert.equal(
    applyCorrections("مواجهة بايج في عرض 24 أغسطس من عرض WWE SmackDown، ولم"),
    "مواجهة بايج في عرض WWE SmackDown يوم 24 أغسطس، ولم",
  );
  assert.equal(applyCorrections("على اللقب طوال 100 يوم الماضية"), "على اللقب طوال الأيام الـ100 الماضية");
  assert.equal(applyCorrections("في عرض WWE SmackDown يوم 24 أغسطس"), "في عرض WWE SmackDown يوم 24 أغسطس");
});
