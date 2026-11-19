import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1417: «بينهماد» (stray letter after «بينهما») reached a story.
test("«بينهماد» is corrected to «بينهم» (no dual)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("المواجهة الكلامية التي حدثت بينهماد خلال فقرة"), "المواجهة الكلامية التي حدثت بينهم خلال فقرة");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بينهماد/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
