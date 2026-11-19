import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1412: «نات سخولنيك» (Nate Skulnick) and «بطولة جون سينا الكلاسيكية المقرر في» reached stories.
test("Skulnick is «سكولنيك» and a feminine noun takes «المقررة في»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("الكاتب نات سخولنيك"), "الكاتب نات سكولنيك");
  assert.equal(applyCorrections("بطولة جون سينا الكلاسيكية المقرر في 14 ديسمبر"), "بطولة جون سينا الكلاسيكية المقررة في 14 ديسمبر");
  assert.equal(applyCorrections("البطولة الكلاسيكية المقرر إقامتها في ديسمبر"), "البطولة الكلاسيكية المقرر إقامتها في ديسمبر");
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  assert.equal(names["Nate Skulnick"], "نيت سكولنيك");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /سخولنيك|[ء-ي]+ية المقرر (?:في|يوم)/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
