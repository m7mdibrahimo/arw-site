import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1373: «تضم المجموعة الزرقاء كل من…», «النزال الرئيسي التي جمعت», «مجموعة الذهب» reached the site
test("«كلا من» after تضم/يضم, masculine «النزال الذي», league names", () => {
  assert.equal(applyCorrections("تضم المجموعة الزرقاء كل من جاي وايت"), "تضم المجموعة الزرقاء كلا من جاي وايت");
  assert.equal(applyCorrections("انضم كل من جاي وايت"), "انضم كل من جاي وايت");
  assert.equal(applyCorrections("خلال النزال الرئيسي التي جمعت بين"), "خلال النزال الرئيسي الذي جمع بين");
  assert.equal(applyCorrections("والنزالات التي أقيمت أمس"), "والنزالات التي أقيمت أمس");
  assert.equal(applyCorrections("يشارك في مجموعة الذهب البطل"), "يشارك في المجموعة الذهبية البطل");
});
