import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("library program descriptions carry the other Arabic spellings of the program (INCIDENTS #477)", () => {
  const njk = fs.readFileSync("pages/library-program.njk", "utf8");
  assert.match(njk, /libAltNames\(lp\.prog\)/);
  const cfg = fs.readFileSync("eleventy.config.js", "utf8");
  assert.match(cfg, /addNunjucksGlobal\("libAltNames"/);
});
