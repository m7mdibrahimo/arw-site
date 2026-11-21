import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1461: Perry Saturn written as Buck's real name, «الخلف الكواليس», «الابتمام», «استعداد الظهور».
test("21 November evening wrong words are corrected", () => {
  assert.equal(applyCorrections("قال النجم السابق بيري ساتيرلي إنهم حساسون"), "قال النجم السابق بيري ساترن إنهم حساسون");
  assert.equal(applyCorrections("ردود فعل نجوم الخلف الكواليس"), "ردود فعل نجوم خلف الكواليس");
  assert.equal(applyCorrections("فإنه يفضل الابتمام عن هذا المجال"), "فإنه يفضل الابتعاد عن هذا المجال");
  assert.equal(applyCorrections("بشأن توقيع عقد أو استعداد الظهور على الشاشة"), "بشأن توقيع عقد أو استعداده للظهور على الشاشة");
  assert.equal(applyCorrections("مقابلة على قناة شايس في يوتيوب"), "مقابلة على قناة تشيس في يوتيوب");
  // Buck's real name stays as it is.
  assert.equal(applyCorrections("بنجامين ساتيرلي"), "بنجامين ساتيرلي");
});

test("Perry Saturn and Heath Slater are in the names glossary", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(g["Perry Saturn"], "بيري ساترن");
  assert.equal(g["Heath Slater"], "هيث سلاتر");
});
