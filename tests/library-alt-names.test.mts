import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("library program descriptions carry the other Arabic spellings of the program (INCIDENTS #477)", () => {
  const njk = fs.readFileSync("pages/library-program.njk", "utf8");
  assert.match(njk, /libAltNames\(lp\.prog\)/);
  const cfg = fs.readFileSync("eleventy.config.js", "utf8");
  assert.match(cfg, /addNunjucksGlobal\("libAltNames"/);
});

test("every program also answers to «<federation in Arabic> <program>» and Main Event to «ماين ايفنت» (INCIDENTS #564)", () => {
  const cfg = fs.readFileSync("eleventy.config.js", "utf8");
  assert.match(cfg, /const FED_SAID = \{ WWE: "دبليو دبليو إي"/);
  assert.match(cfg, /aliases: withGenerated/);
  assert.match(cfg, /"wwe-main-event": \[[^\]]*"ماين ايفنت"/);
});

test("a library page title never repeats the year already in the program name (INCIDENTS #622)", async () => {
  const fs = await import("node:fs");
  const t = fs.readFileSync(new URL("../pages/library-program.njk", import.meta.url), "utf8");
  assert.match(t, /lp\.prog\.name \| string\)\.endsWith\(lp\.prog\.latest\.eventDate \| yearOf \| string\)/);
});
