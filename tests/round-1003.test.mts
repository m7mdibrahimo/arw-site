import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
test("Scientology spelling and تجربته typo are corrected", () => {
  assert.equal(applyCorrections("ارتباطاتها بالساينولوجي"), "ارتباطاتها بالساينتولوجي");
  assert.equal(applyCorrections("كنيسة السينولوجي"), "كنيسة الساينتولوجي");
  assert.equal(applyCorrections("تجريته في الفنون"), "تجربته في الفنون");
});
