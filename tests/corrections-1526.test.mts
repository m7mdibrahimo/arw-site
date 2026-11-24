import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS #1526: NJPW «فكوشيما»; Charlotte Flair «تقبل كل ما مررت به في حياتها» and «التحديات التي مرتا بها».
test("Fukushima and the reported-speech verb are corrected", () => {
  assert.equal(applyCorrections("في صالة فكوشيما بيغ باليت في فكوشيما"), "في صالة فوكوشيما بيغ باليت في فوكوشيما");
  assert.equal(applyCorrections("وتقبل كل ما مررت به في حياتها."), "وتقبل كل ما مرت به في حياتها.");
});

test("the feminine dual «مرتا» is blocked", () => {
  const issues = checkArticle("شارلوت فلير تتحدث عن بيانكا بيلير", "تفهمها تماما بسبب التحديات التي مرتا بها في المسيرة.");
  assert.ok(issues.some((i) => i.code === "dual_form"), JSON.stringify(issues));
});
