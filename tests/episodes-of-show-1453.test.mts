import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1453: «ستتوفر عروض العرض للمشاهدة» (episodes of the show) reached a TNA story.
test("«عروض العرض» is corrected to «حلقات العرض» and no story keeps it", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ستتوفر عروض العرض للمشاهدة عبر TNA+"), "ستتوفر حلقات العرض للمشاهدة عبر TNA+");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /عروض العرض/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});
