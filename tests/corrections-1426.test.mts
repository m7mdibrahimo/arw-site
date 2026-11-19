import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1426: «عرض SurvivorSeries: WarGames» (glued) reached a story.
test("«SurvivorSeries» → «Survivor Series»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("سيكون عرض SurvivorSeries: WarGames"), "سيكون عرض Survivor Series: WarGames");
  assert.equal(applyCorrections("عرض Survivor Series القادم"), "عرض Survivor Series القادم");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /SurvivorSeries/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
