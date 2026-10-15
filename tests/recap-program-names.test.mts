import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Recaps carry their program's TVSeries link and every spelling people search it by, like shows do (INCIDENTS #578)
test("recap pages get the program aliases in their structured data", () => {
  const layout = fs.readFileSync("_includes/post-layout.njk", "utf-8");
  assert.match(layout, /libraryProgramOf\(page\.url, collections\.library, program_name\)/);
  assert.match(layout, /page\.url\.startsWith\('\/recaps\/'\)\) else null/);
  const cfg = fs.readFileSync("eleventy.config.js", "utf-8");
  assert.match(cfg, /libraryProgramOf", function\(url, library, programName\)/);
});
