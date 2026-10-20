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

// INCIDENTS #728: «smackdown مترجم» / «raw مترجم» (program name without the federation) were not in the show's alternate names.
test("a weekly show carries the English program name without the federation", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض سماك داون 16.10.2026 مترجم", programName: "WWE Smackdown", eventDate: "2026-10-16", aliases: ["عرض سماك داون"], isShow: true });
  for (const q of ["Smackdown مترجم", "Smackdown الاخير مترجم", "مشاهدة Smackdown", "Smackdown 2026 مترجم"]) assert.ok(forms.includes(q), q);
});
