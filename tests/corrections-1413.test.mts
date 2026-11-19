import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1413: «الذكرى الثلاثية» (30th anniversary) and «أبقى عليهم في الظلام» (kept them in the dark) reached stories.
test("30th anniversary is «الذكرى الثلاثين» and «kept in the dark» is not literal", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("تعليقا على الذكرى الثلاثية لمسيرته"), "تعليقا على الذكرى الثلاثين لمسيرته");
  assert.equal(applyCorrections("اتحاد WWE أبقى عليهم في الظلام بخصوص دعوات سينا"), "اتحاد WWE أخفى عنهم أمر دعوات سينا");
  assert.equal(applyCorrections("الاتحاد أبقاهم في الظلام بشأن الخطة"), "الاتحاد أخفى عنهم أمر الخطة");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /الذكرى الثلاثية|في الظلام (?:بخصوص|بشأن)/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
