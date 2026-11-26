import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1561: Natalya's "projects outside the company" became «تشارك في عدة اتحادات أخرى».
test("projects outside WWE are not turned into other promotions (INCIDENTS #1561)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("INCIDENTS #1561"));
  assert.ok(guide.includes("projects outside the company"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ناتاليا/.test(f) && /تشارك في عدة اتحادات أخرى/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
