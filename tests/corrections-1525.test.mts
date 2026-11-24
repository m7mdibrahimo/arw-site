import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1525: Jade Cargill «أعمرهن», «تلقاتها», «الأفضلية لفيلمها»; Cody Rhodes «كارميلو أنطوني».
test("misspellings and the mistranslated 'her team' are corrected", () => {
  assert.equal(applyCorrections("الثلاثينيات من أعمرهن"), "الثلاثينيات من أعمارهن");
  assert.equal(applyCorrections("نصيحة مهمة تلقاتها من النجم"), "نصيحة مهمة تلقتها من النجم");
  assert.equal(applyCorrections("مع كارميلو أنطوني استرجع"), "مع كارميلو أنتوني استرجع");
  assert.equal(applyCorrections("لتضمن الأفضلية لفيلمها في نزال WarGames"), "لتضمن الأفضلية لفريقها في نزال WarGames");
  assert.equal(applyCorrections("تروج منصة Netflix لفيلمها الجديد"), "تروج منصة Netflix لفيلمها الجديد");
});
