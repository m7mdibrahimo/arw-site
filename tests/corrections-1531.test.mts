import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1531: Mika Lockwood and John Cena Classic stories — «أصارعين», «قوتها البنية», «أضاف … كل من».
test("Lockwood and Cena Classic wording is corrected", () => {
  assert.equal(applyCorrections("في نزال فرق مختلط من ثمانية أصارعين."), "في نزال فرق مختلط من ثمانية مصارعين.");
  assert.equal(applyCorrections("واستعرضت لوكوود قوتها البنية منذ البداية"), "واستعرضت لوكوود قوتها البدنية منذ البداية");
  assert.equal(applyCorrections("أضاف المصارع جون سينا كل من رين سنكلير وكيندال غراي"), "أضاف المصارع جون سينا كلا من رين سنكلير وكيندال غراي");
  // «كل» subject right after the verb stays as it is
  assert.equal(applyCorrections("وأضاف كل من درو وجاكوب أنهما"), "وأضاف كل من درو وجاكوب أنهما");
});
