import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1316: «في عرض AEW Dynamite التي أقيمت يوم 21 أكتوبر» — «عرض» is masculine.
test("«عرض X التي أقيمت» takes the masculine relative pronoun", () => {
  assert.equal(applyCorrections("على الأبطال في عرض AEW Dynamite التي أقيمت يوم 21 أكتوبر"), "على الأبطال في عرض AEW Dynamite الذي أقيم يوم 21 أكتوبر");
  assert.equal(applyCorrections("خلال عرض WWE NXT التي بثت أمس"), "خلال عرض WWE NXT الذي بث أمس");
  assert.equal(applyCorrections("في عرض AEW All Out والتي شهدت"), "في عرض AEW All Out والذي شهد");
});

test("«حلقة عرض X التي أقيمت» stays: «التي» belongs to «حلقة»", () => {
  assert.equal(applyCorrections("في حلقة عرض AEW Dynamite التي أقيمت أمس"), "في حلقة عرض AEW Dynamite التي أقيمت أمس");
});

test("a hype adjective after «النزال» is dropped", () => {
  assert.equal(applyCorrections("خلال النزال الحماسي في عرض AEW Full Gear"), "خلال النزال في عرض AEW Full Gear");
  assert.equal(applyCorrections("وفي المواجهة الملحمية بينهما"), "وفي المواجهة بينهما");
});

test("«chunky» is not «ذي اللحم البارز»", () => {
  assert.equal(applyCorrections("وهي تحمل الجرو ذي اللحم البارز والفراء البني"), "وهي تحمل الجرو ذا الجسم الممتلئ والفراء البني");
});
