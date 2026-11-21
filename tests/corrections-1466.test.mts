import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1466: «تفاعل جماهير كبير»، «الأربع الفارسات»، «عليهم... تورمهم» للركب، «إيفي ماليبو».
test("round 2026-11-22 Arabic slips are corrected", () => {
  assert.equal(applyCorrections("وسط تفاعل جماهير كبير"), "وسط تفاعل جماهيري كبير");
  assert.equal(applyCorrections("مجموعة الأربع الفارسات"), "مجموعة الفارسات الأربع");
  assert.equal(applyCorrections("بالغت في الضغط عليهم، مما أدى إلى تورمهم"), "بالغت في الضغط عليها، مما أدى إلى تورمها");
  assert.equal(applyCorrections("اسمها إيفي ماليبو"), "اسمها آيفي ماليبو");
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(g["Ivy Malibu"], "آيفي ماليبو");
});
