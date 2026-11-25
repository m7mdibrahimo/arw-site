import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1530: NXT 24/11 results and Meltzer story — «أريزونة», «لنتزع منها», «لتعلينا», «بطاقة نزال عرض», «نزال البطولة للجدل».
test("NXT 24/11 wording is corrected", () => {
  assert.equal(applyCorrections("بمدينة غلينديل في أريزونة."), "بمدينة غلينديل في أريزونا.");
  assert.equal(applyCorrections("بفوز إيزي دايم على البطلة زاريا لنتزع منها اللقب."), "بفوز إيزي دايم على البطلة زاريا لتنتزع منها اللقب.");
  assert.equal(applyCorrections("قبل أن تتدخل ليزي رين وكالي أرمسترونغ لتعلينا استهدافهن"), "قبل أن تتدخل ليزي رين وكالي أرمسترونغ لإعلان استهدافهن");
  assert.equal(applyCorrections("تتضمن بطاقة نزال عرض WWE NXT الليلة"), "تتضمن بطاقة عرض WWE NXT الليلة");
  assert.equal(applyCorrections("بالحديث عن نزال البطولة للجدل الأسبوع الماضي"), "بالحديث عن نزال البطولة المثير للجدل الأسبوع الماضي");
});
