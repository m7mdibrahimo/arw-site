import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1280: «بقيمة خمسعين دولارا» (George Barrios) and «ولم تحج وقتا طويلا» (Thea Hail) went live.
test("garbled tens and «لم تحج» are corrected", () => {
  assert.equal(applyCorrections("بقيمة خمسعين دولارا شهريا"), "بقيمة خمسين دولارا شهريا");
  assert.equal(applyCorrections("حوالي ثلاثعين ألفا وثمانعين مشجعا"), "حوالي ثلاثين ألفا وثمانين مشجعا");
  assert.equal(applyCorrections("ولم تحج وقتا طويلا للرد"), "ولم تحتج وقتا طويلا للرد");
  assert.equal(applyCorrections("لم يحج إلى أكثر من دقيقة"), "لم يحتج إلى أكثر من دقيقة");
});

test("real words stay", () => {
  for (const s of ["خمسين دولارا", "سبعين ألفا", "أربعين عاما", "ستعين الشركة مدربا جديدا", "دانهاوزن يستعين ببابا شانغو", "لم تحتج وقتا"]) {
    assert.equal(applyCorrections(s), s);
  }
});

test("no published story keeps them", () => {
  for (const dir of ["content/news"]) {
    for (const f of fs.readdirSync(dir)) {
      const t = fs.readFileSync(`${dir}/${f}`, "utf-8");
      assert.ok(!/(?:^|[\s«"(])(?:[وبل])?(?:خمس|ثلاث|ثمان)عين(?=[\s.,،»"]|$)/m.test(t), f);
      assert.ok(!/لم [تي]حج(?=[\s.,،]|$)/m.test(t), f);
    }
  }
});
