import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1564: «ذا بادي» بدل «ذا باديز»، و«?» إنجليزية بعد WWE في جملة عربية.
test("round 2026-11-27 corrections", () => {
  assert.equal(applyCorrections("ضمن فريق ذا بادي إلى جانب جايد كارغيل"), "ضمن فريق ذا باديز إلى جانب جايد كارغيل");
  assert.equal(applyCorrections("تألق بادي ماثيوز"), "تألق بادي ماثيوز");
  assert.equal(applyCorrections("من هي نجمة المستقبل داخل WWE? وضعت"), "من هي نجمة المستقبل داخل WWE؟ وضعت");
  assert.equal(applyCorrections("في بودكاست What's Your Story? مع ستيف"), "في بودكاست What's Your Story? مع ستيف");
});
