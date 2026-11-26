import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1556: «فايرفلاي فان هاوس»، «ثاندردوم»، «إصاباتتي»، «متخديا»، «بالهوليداي».
test("round 2026-11-26 corrections", () => {
  assert.equal(applyCorrections("فقرات فايرفلاي فان هاوس حيث"), "فقرات Firefly Fun House حيث");
  assert.equal(applyCorrections("خلال حقبة ثاندردوم أثناء"), "خلال حقبة ThunderDome أثناء");
  assert.equal(applyCorrections("قائمة إصاباتتي؟"), "قائمة إصاباتي؟");
  assert.equal(applyCorrections("متخديا إياه"), "متحديا إياه");
  assert.equal(applyCorrections("يحتفل بالهوليداي الأمريكية"), "يحتفل بالعطلة الأمريكية");
});

test("a wrestler named هوليداي is left alone", () => {
  assert.equal(applyCorrections("تحرى عن وضع هوليداي"), "تحرى عن وضع هوليداي");
});
