// INCIDENTS #1273 — «إضافة بطلي TNA العالمية للفرق رايان نيميث ونيك نيميث» (TNA Destination X story) and four
// older stories with «بطلي WWE/AEW/NXT … للفرق» / «بطلي الوزن الثقيل»: the dual_form check only knew «بطلي فرق/العالم».
// «في أيار 2026» (a Levantine month name) sat in the FTR story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle } from "../scripts/news-qa.ts";

const pad = " نص الخبر الطويل بما يكفي للفحص".repeat(20);

test("«بطلي <promotion> …» becomes «أبطال …»", () => {
  assert.equal(applyCorrections("إضافة بطلي TNA العالمية للفرق رايان نيميث"), "إضافة أبطال TNA العالميين للفرق رايان نيميث");
  assert.equal(applyCorrections("أمام فانيتي بروجيكت بطلي NXT للفرق."), "أمام فانيتي بروجيكت أبطال NXT للفرق.");
  assert.equal(applyCorrections("بصفتهم بطلي AEW العالميين للفرق"), "بصفتهم أبطال AEW العالميين للفرق");
  // a quote «بطلي الحقيقي» (my real hero) stays
  assert.equal(applyCorrections("والدي هو بطلي الحقيقي"), "والدي هو بطلي الحقيقي");
});

test("dual_form blocks «بطلي TNA» and «بطلي الوزن» but not «بطلي الحقيقي»", () => {
  const codes = (b: string) => checkArticle("عنوان عربي كامل للخبر هنا", b + pad, []).map(i => i.code);
  assert.ok(codes("قرر ماريلا إضافة بطلي TNA العالمية للفرق إلى النزال.").includes("dual_form"));
  assert.ok(codes("المواجهة بين بطلي الوزن الثقيل السابقين.").includes("dual_form"));
  assert.ok(!codes("قال: والدي هو بطلي الحقيقي.").includes("dual_form"));
});

test("Levantine month names become the site's month names", () => {
  assert.equal(applyCorrections("وانتهت فترتهم الأخيرة في أيار 2026"), "وانتهت فترتهم الأخيرة في مايو 2026");
  assert.equal(applyCorrections("في تشرين الثاني 2025"), "في نوفمبر 2025");
});
