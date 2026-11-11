import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1232: «حسم النزال… ليعلن نفسه المنافس الأول» — the winner of a contenders match becomes the contender,
// he doesn't announce anything; and the glossary spelling «ازوم» never reached older stories that kept «AZM».
test("a contenders match winner «becomes» the contender, and AZM is spelled as the glossary says", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("حسم النزال ليعلن نفسه المنافس الأول على اللقب"), "حسم النزال ليصبح المنافس الأول على اللقب");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["AZM"], "ازوم");
  const bad = fs.readdirSync("content/news").filter(f => {
    if (!f.endsWith(".md")) return false;
    const body = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^---\n[\s\S]*?\n---\n/, "");
    return /\bAZM\b|ايه زد ام|ليعلن نفسه المنافس/.test(body);
  });
  assert.deepEqual(bad, []);
});
