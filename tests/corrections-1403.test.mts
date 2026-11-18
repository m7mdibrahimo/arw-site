import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1403: the bikini rule turned «لم يلتق بكيني أوميغا» into «بيكيني أوميغا».
test("«بكيني أوميغا» (with Kenny Omega) is not turned into a bikini", () => {
  assert.equal(applyCorrections("لم يلتق بكيني أوميغا سوى مرة"), "لم يلتق بكيني أوميغا سوى مرة");
  assert.equal(applyCorrections("ظهرت بكيني أحمر"), "ظهرت بيكيني أحمر");
  assert.equal(applyCorrections("ظهرت ببكيني أسود"), "ظهرت ببيكيني أسود");
});

test("Conrad Thompson, the AJ Styles podcast and a glued word", () => {
  assert.equal(applyCorrections("مع توني شيفاني وتونسون"), "مع توني شيفاني وكونراد تومسون");
  assert.equal(applyCorrections("مع كونراد تونسون"), "مع كونراد تومسون");
  assert.equal(applyCorrections("في برنامج إيه جيه ستايلز Podcast"), "في برنامج The AJ Styles Podcast");
  assert.equal(applyCorrections("لم يفهمابن طبيعة عملها"), "لم يفهموا طبيعة عملها");
});
