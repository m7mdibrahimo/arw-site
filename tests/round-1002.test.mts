import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
test("Reigns typo, plural Bulldozer nickname and literal diverticulitis are corrected", () => {
  assert.equal(applyCorrections("جون سينا ورمان رينز"), "جون سينا ورومان رينز");
  assert.equal(applyCorrections("لقب جرافات ساموا"), "لقب جرافة ساموا");
  assert.equal(applyCorrections("مرض التهاب جيوب القولون"), "مرض التهاب الرتج");
});
