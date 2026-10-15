import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("style guide bans heavy headline words that reached the site (INCIDENTS #578)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("يسترجع"));
  assert.ok(guide.includes("تصنع"));
});
