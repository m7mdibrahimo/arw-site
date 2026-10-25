import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const { libraryNameForms } = createRequire(import.meta.url)("../lib/show-seo.cjs");

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

test("Money in the Bank is also written «مونى» with a final alef maqsura (INCIDENTS #734)", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض موني ان ذا بانك 10.10.2026 مترجم", title: "WWE Money in the Bank (2026)", programName: "WWE Money in the Bank", eventDate: "2026-10-10", aliases: ["عرض موني ان ذا بانك"], isShow: true });
  assert.ok(forms.includes("عرض مونى ان ذا بانك 2026"));
  assert.ok(forms.includes("تحميل عرض مونى ان ذا بانك"));
});

// INCIDENTS #735: «عرض ماين ايفنت الاخير» — Main Event is written with both «مين» and «ماين».
test("Main Event is also written with the other Arabic spelling", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض مين ايفنت 14.10.2026 مترجم", programName: "WWE Main Event", eventDate: "2026-10-14", aliases: ["عرض مين ايفنت"], isShow: true });
  assert.ok(forms.includes("عرض ماين ايفنت الاخير"), "ماين الاخير");
  assert.ok(forms.includes("عرض ماين ايفنت مترجم"), "ماين مترجم");
});

test("a yearly program's library page also answers «… 2026 تحميل» and «… 2026 اون لاين» (INCIDENTS #753)", () => {
  const forms = libraryNameForms({ arName: "عرض موني ان ذا بانك", name: "WWE Money in the Bank", aliases: [], year: 2026, count: 3, latest: "2026-07-05" });
  for (const f of ["Money in the Bank 2026 تحميل", "عرض موني ان ذا بانك 2026 اون لاين", "عرض Money in the Bank 2026 مشاهدة"]) assert.ok(forms.includes(f), f);
});

// INCIDENTS #810: «عرض ماين ايفنت 2026 مترجم» — a weekly program is also searched with the year after its Arabic name.
test("a weekly episode also answers «عرض ماين ايفنت 2026 مترجم» and «… الاخير 2026 مترجم»", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض مين ايفنت 14.10.2026 مترجم", programName: "WWE Main Event", eventDate: "2026-10-14", aliases: ["عرض مين ايفنت"], isShow: true });
  for (const f of ["عرض ماين ايفنت 2026 مترجم", "عرض ماين ايفنت الاخير 2026 مترجم", "عرض مين ايفنت 2026 مترجم"]) assert.ok(forms.includes(f), f);
});

test("a show's alternateName lists each spelling once (the layout's global drops repeats)", async () => {
  const fs = await import("node:fs");
  assert.match(fs.readFileSync("eleventy.config.js", "utf-8"), /showNameForms\(\{[^}]*\}\)\.filter\(\(n\) => !seen\.has\(n\) && seen\.add\(n\)\)/);
});
