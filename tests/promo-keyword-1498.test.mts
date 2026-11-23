import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keywordList } = require("../lib/show-seo.cjs");

// INCIDENTS #1498: «wwe مترجم» / «عرض AEW مترجم» were in alternateName but never among a show's 14 keywords
test("the promotion's «مترجم» form keeps the last keyword slot", () => {
  const names = ["عرض سماك داون", ...Array.from({ length: 20 }, (_, i) => `سماك داون ${"ابجدهوزحطيكلمنسعفصقرشت"[i]}`), "wwe مترجم", "عرض سماك داون 20/11/2026"];
  const kw = keywordList([], names, 14, true);
  assert.equal(kw.length, 14);
  assert.ok(kw.includes("wwe مترجم"));
  const aew = keywordList([], ["عرض داينامايت", ...Array.from({ length: 20 }, (_, i) => `داينامايت ${i}x`), "عرض AEW مترجم"], 14, true);
  assert.ok(aew.includes("عرض AEW مترجم"));
});

test("a list that already holds the form is unchanged", () => {
  const names = ["عرض الرو", "wwe مترجم", "عرض الرو الاخير"];
  assert.deepEqual(keywordList([], names, 14, true), keywordList([], names, 14, true));
  assert.ok(keywordList([], names, 14, true).includes("wwe مترجم"));
});
