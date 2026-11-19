import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1421: «بيكي مونتويا» (Pinky Montoya) and «مشاكل الطيران الشهيرة» (widespread flight issues) reached stories.
test("Pinky Montoya is «بينكي»; widespread flight issues are «الواسعة»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("واجهت بيكي مونتويا"), "واجهت بينكي مونتويا");
  assert.equal(applyCorrections("لكن مشاكل الطيران الشهيرة منعت المصارع"), "لكن مشاكل الطيران الواسعة منعت المصارع");
  assert.equal(applyCorrections("حلبة الطيران الشهيرة"), "حلبة الطيران الشهيرة");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بيكي مونتويا|الطيران الشهيرة/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
