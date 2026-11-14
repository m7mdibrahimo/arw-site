import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

test("WWE (Women's) Intercontinental is never «القارية» (INCIDENTS #1291)", () => {
  assert.equal(
    applyCorrections("إلى جانب دفاع راكيل رودريغيز عن بطولة WWE القارية للسيدات ضد آيو سكاي."),
    "إلى جانب دفاع راكيل رودريغيز عن بطولة WWE للقارات للسيدات ضد آيو سكاي.",
  );
  assert.equal(applyCorrections("فاز إيثان بايج ببطولة WWE القارية."), "فاز إيثان بايج ببطولة القارات.");
  assert.equal(applyCorrections("حامل بطولة WWE القارية"), "حامل بطولة القارات");
  // AEW's Continental title keeps «القارية»
  assert.equal(applyCorrections("دافع عن البطولة القارية في عرض AEW Dynamite."), "دافع عن البطولة القارية في عرض AEW Dynamite.");
});

test("WarGames is a match, and a match is added to a show's card (INCIDENTS #1291)", () => {
  assert.equal(
    applyCorrections("أعلن اتحاد WWE عن إضافة نزال لتحديد الأفضلية في عرض WarGames إلى جدول أعمال عرض WWE RAW القادم."),
    "أعلن اتحاد WWE عن إضافة نزال لتحديد الأفضلية في نزال WarGames إلى بطاقة عرض WWE RAW القادم.",
  );
});

test("the names glossary carries Women's Intercontinental (INCIDENTS #1291)", () => {
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(names["Women's Intercontinental Championship"], "بطولة WWE للقارات للسيدات");
});
