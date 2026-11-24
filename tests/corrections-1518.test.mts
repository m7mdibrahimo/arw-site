import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1518: two women came out as «كونهم من المصارعات المفضلات لديه».
test("a masculine plural pronoun before «من المصارعات» becomes feminine", () => {
  assert.equal(applyCorrections("كونهم من المصارعات المفضلات لديه"), "كونهن من المصارعات المفضلات لديه");
  assert.equal(applyCorrections("لأنهم من النجمات"), "لأنهن من النجمات");
  assert.equal(applyCorrections("لأنهم من المصارعين"), "لأنهم من المصارعين");
});
