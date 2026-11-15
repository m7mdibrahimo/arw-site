import { test } from "node:test";
import assert from "node:assert/strict";
import { demoteUnplayedMainEvent } from "../scripts/news-qa.ts";

const partial = `**المواجهة الأولى: نزال خفيف الوزن**
فاز إيفان إيلدر على صامويل سانشيس.

**المواجهة الخامسة: نزال بوزن 190 رطلا**
فاز سيزار ألميدا على دونتي جونسون.

**الحدث الرئيسي: نزال خفيف الوزن**
فاز ترانس مكيني على جيم ميلر.`;

test("UFC 334: the last finish so far is not the main event while Gane vs. Hokit is unplayed (INCIDENTS #1317)", () => {
  const src = "Evan Elder def. Samuel Sanches by unanimous decision\nTerrance McKinney def. Jim Miller by knockout";
  const out = demoteUnplayedMainEvent(partial, "UFC 334: Gane vs. Hokit Results", src);
  assert.ok(!out.includes("الحدث الرئيسي"));
  assert.ok(out.includes("**المواجهة الثالثة: نزال خفيف الوزن**"));
});

test("the main event stays once the source has the headliners' result", () => {
  const src = "Terrance McKinney def. Jim Miller by knockout\nCiryl Gane def. Hokit by TKO";
  assert.equal(demoteUnplayedMainEvent(partial, "UFC 334: Gane vs. Hokit Results", src), partial);
});

test("a source that labels a main event, or a title with no headliners, is left alone", () => {
  assert.equal(demoteUnplayedMainEvent(partial, "UFC 334: Gane vs. Hokit Results", "Main Event: McKinney def. Miller"), partial);
  assert.equal(demoteUnplayedMainEvent(partial, "AEW Dynamite Results (11/12/2026)", "McKinney def. Miller"), partial);
});
