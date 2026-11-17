import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1383: «إصابته ببرصاصات» (doubled ba) and «زميله السابق في فريق الفرق» (tag team partner) reached stories.
test("«ببرصاصات» and «في فريق الفرق» are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بعد إصابته ببرصاصات في رأسه"), "بعد إصابته برصاصات في رأسه");
  assert.equal(applyCorrections("أصيب ببرصاصة في ساقه"), "أصيب برصاصة في ساقه");
  assert.equal(applyCorrections("وزميله السابق في فريق الفرق كيفن نايت"), "وزميله السابق في الفريق الثنائي كيفن نايت");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /ببرصاص|فريق الفرق/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
