import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1254: El Clon's loss on the 11/11 Collision was written as the loss of his August match (Arabic and
// English), a squash match became «نزال الإطاحة السريع», and «كمنافس تال» reached a story.
test("a return story's result belongs to the new match, in both languages", async () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.match(guide, /نتيجة نزال العودة تخص نزال العودة/);
  const { englishStyleRules } = await import("../scripts/english-edition.ts");
  const rules = typeof englishStyleRules === "function" ? (englishStyleRules as () => string)() : String(englishStyleRules);
  assert.match(rules, /In a return story, the result/);
});

test("squash match and «منافس تال» are handled", async () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.match(guide, /squash \/ squash match ← «نزال سريع من طرف واحد»/);
  const { applyCorrections } = await import("../scripts/news-qa");
  const out = applyCorrections("وظهور إيليا دراغونوف كمنافس تال.");
  assert.equal(typeof out === "string" ? out : (out as { text: string }).text, "وظهور إيليا دراغونوف كمنافس قادم.");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /نزال الإطاحة السريع|كمنافس تال\b/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
  const en = fs.readFileSync(fs.readdirSync("content/news-en").filter(f => f.startsWith("20261112065950-")).map(f => `content/news-en/${f}`)[0], "utf-8");
  assert.ok(!/August[^\n]*BTE Trigger/.test(en.split("His prior")[1] || ""));
});
