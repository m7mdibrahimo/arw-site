import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
import { readFileSync } from "node:fs";

// INCIDENTS #1318: «تنجح في تبديل الأدوار مع كريس ستاتلاندر» for "tagged in Statlander",
// «بطولة منافسي بطولة الوزن الخفيف» for "Cruiserweight Title Contenders Tournament",
// and a title «ينفي … وتعيين دوريان رولدان» that reads as if Mysterio denied the appointment too.
test("a tag inside a match is «لمس يد», not «تبديل الأدوار»", () => {
  assert.equal(applyCorrections("قبل أن تنجح في تبديل الأدوار مع كريس ستاتلاندر."), "قبل أن تنجح في لمس يد كريس ستاتلاندر.");
});

test("a contenders tournament has no doubled «بطولة»", () => {
  assert.equal(applyCorrections("جاك كارتويل يتأهل في بطولة منافسي بطولة الوزن الخفيف"), "جاك كارتويل يتأهل في بطولة تحديد المنافس على لقب الوزن الخفيف");
  assert.equal(applyCorrections("ضمن بطولة المنافسين على لقب الوزن الخفيف"), "ضمن بطولة تحديد المنافس على لقب الوزن الخفيف");
});

test("the title prompt and the style guide ask for parallel two-part titles", () => {
  assert.match(readFileSync("scripts/fightful-watcher.ts", "utf8"), /بنفس الصيغة: فعل \+ فعل/);
  assert.match(readFileSync("editorial/style-guide.md", "utf8"), /عنوان فيه خبرين: الجزئين بنفس الصيغة/);
});
