import { test } from "node:test";
import assert from "node:assert/strict";
import { claimNotInSource, yearRangeAsTwoYears, YEAR_RANGE_LABEL, applyCorrections } from "../scripts/news-qa.ts";

// Muhammad Hassan, INCIDENTS #1311: "worked for WWE from 2002 to 2005" became «عام 2002 وعام 2005».
const SOURCE = `Muhammad Hassan worked for WWE from 2002 to 2005, playing the character of an Arab American on television. His last match in the company took place at The Great American Bash 2005, where he was defeated by The Undertaker. Speaking on Monte & The Pharaoh, Hassan was asked what Vince McMahon was like towards him. "I never had a bad one, personally, 2004 and 2005."`;

test("a range in the source written as two single years is blocked", () => {
  const ar = "ولعب حسن دور البطولة بشخصية أمريكي من أصل عربي خلال مسيرته مع الاتحاد عام 2002 وعام 2005.";
  assert.ok(yearRangeAsTwoYears(ar, SOURCE));
  assert.ok(claimNotInSource(ar, SOURCE).includes(YEAR_RANGE_LABEL));
});

test("«من/بين … عام» ranges, real pairs of years and close years pass", () => {
  assert.equal(yearRangeAsTwoYears("عمل في WWE بين عام 2002 وعام 2005.", SOURCE), "");
  assert.equal(yearRangeAsTwoYears("لم أتعرض لأي تعامل سيئ منه عام 2004 وعام 2005.", SOURCE), "");
  assert.equal(yearRangeAsTwoYears("فاز باللقب عام 2010 وعام 2015.", SOURCE + " He won it in 2010 and 2015."), "");
});

test("the wrong words of the round are corrected", () => {
  const fixed = applyCorrections("فلكل قصة جانبين. وانضم مع زميله مارك ديس. نجاحي في المنافسات الفردية داخل عرض AEW تحقق أسرع. عقد الأساطير تتيح لـ WWE");
  assert.match(fixed, /لكل قصة أكثر من رواية/);
  assert.match(fixed, /مارك ديفيس/);
  assert.match(fixed, /في AEW تحقق/);
  assert.match(fixed, /عقود الأساطير تتيح/);
});
