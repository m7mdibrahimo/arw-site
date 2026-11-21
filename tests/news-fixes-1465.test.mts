import { test } from "node:test";
import assert from "node:assert/strict";
import { fixHeadlessResults, fixDecadeFromEnglish, confusableSwappedFromEnglish, fixEventCalledMovie, applyCorrections } from "../scripts/news-qa.ts";

const glossary = { "The Hurt Syndicate": "ذا هيرت سنديكيت", "The Hurt Business": "ذا هيرت بيزنس" };

test("#1465: a winner line with no heading of its own gets one, and the headings are renumbered", () => {
  const body = [
    "افتتاحية العرض.", "",
    "**المواجهة الأولى: نزال فردي**", "", "فاز أ على ب.", "", "🏆 **الفائز:** أ", "",
    "🏆 **الفائزون:** ج ود (بفوزهم على هـ وو)", "",
    "**المواجهة الرابعة: نزال فردي**", "", "فازت ز على ح.", "", "🏆 **الفائزة:** ز", "",
    "🏆 **الفائزة:** ط (بعد دفاعها عن اللقب)",
  ].join("\n");
  const out = fixHeadlessResults(body);
  const heads = out.match(/^\*\*المواجهة [^*]+\*\*$/gm);
  assert.deepEqual(heads, ["**المواجهة الأولى: نزال فردي**", "**المواجهة الثانية: نزال فرق**", "**المواجهة الثالثة: نزال فردي**", "**المواجهة الرابعة: نزال فردي**"]);
  assert.equal(applyCorrections(body).match(/^\*\*المواجهة/gm)?.length, 4);
});

test("#1465: a well-formed report is left alone", () => {
  const body = "**المواجهة الأولى: نزال فردي**\n\nفاز أ على ب.\n\n🏆 **الفائز:** أ\n\n**المواجهة الثانية: نزال فرق**\n\n🏆 **الفائزون:** ج ود";
  assert.equal(fixHeadlessResults(body), body);
});

test("#1465: «late 2010s» is not «عشرينيات القرن الماضي»", () => {
  const ar = "تعاونهما في WWE خلال أواخر عشرينيات القرن الماضي.";
  assert.equal(fixDecadeFromEnglish(ar, "their run in WWE during the late 2010s."), "تعاونهما في WWE خلال أواخر العقد الثاني من القرن الحالي.");
  assert.equal(fixDecadeFromEnglish("في تسعينيات القرن الماضي", "back in the 1990s and the 2010s"), "في تسعينيات القرن الماضي");
  assert.equal(fixDecadeFromEnglish("في تسعينيات القرن الماضي", "back in the '90s"), "في تسعينيات القرن الماضي");
});

test("#1465: The Hurt Business written for The Hurt Syndicate is caught", () => {
  const en = "Although Bobby Lashley is currently finding great success alongside his Hurt Syndicate stablemates MVP and Shelton Benjamin, fans remember Lio Rush.";
  assert.deepEqual(confusableSwappedFromEnglish("زملائه في فريق ذا هيرت بيزنس ام في بي وشيلتون بنجامين", en, glossary), ["The Hurt Syndicate"]);
  assert.deepEqual(confusableSwappedFromEnglish("زميليه في فريق ذا هيرت سنديكيت", en, glossary), []);
});

test("#1465: «the 2026 adaptation of Street Fighter» keeps «فيلم»", () => {
  const src = "most notably playing the video game character Guile in the 2026 adaptation of Street Fighter.";
  assert.equal(fixEventCalledMovie("شخصية غايل في فيلم Street Fighter", src), "شخصية غايل في فيلم Street Fighter");
});

test("#1465: malformed headings count, and a copied winner line is dropped, not headed", () => {
  const body = "**المواجهة الأولى: نزال فردي**\n\n🏆 **الفائز:** أ\n\n**الحدث الرئيسي:** بطولة العالم\n\nفاز ب على ج.\n\n🏆 **الفائز:** ب\n\nكلام بعد النزال.\n\n🏆 **الفائز:** ب";
  assert.equal(fixHeadlessResults(body), "**المواجهة الأولى: نزال فردي**\n\n🏆 **الفائز:** أ\n\n**الحدث الرئيسي:** بطولة العالم\n\nفاز ب على ج.\n\n🏆 **الفائز:** ب\n\nكلام بعد النزال.");
});
