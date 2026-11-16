import test from "node:test";
import assert from "node:assert/strict";
import { applyNamesGlossary } from "../scripts/fightful-watcher.ts";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1340: «وشهد النزال مشاركة … وجو ألونسو وTJP» — an all-caps glossary name behind «و» stayed in Latin,
// because every all-caps key was treated like a company. People in capitals are translated; companies stay English.
test("an all-caps wrestler behind «و» is translated from the glossary", () => {
  assert.equal(applyNamesGlossary("وشهد النزال مشاركة جو ألونسو وTJP."), "وشهد النزال مشاركة جو ألونسو وتي جيه بي.");
  assert.equal(applyNamesGlossary("بجانب أميزينج ريد وODB"), "بجانب أميزينج ريد وأودي بي");
});

test("companies and channels behind «و» stay English", () => {
  assert.equal(applyNamesGlossary("عروض GCW وEVOLVE"), "عروض GCW وEVOLVE");
  assert.equal(applyNamesGlossary("على قناة TNT وCNN"), "على قناة TNT وCNN");
});

test("red mist, X Division and Aichner are fixed before publishing", () => {
  assert.equal(applyCorrections("رش تي جيه بي رغوة حمراء في عيني نافارو"), "رش تي جيه بي رذاذا أحمر في عيني نافارو");
  assert.equal(applyCorrections("المنافس الأول على بطولة TNA إكس ديفيجن"), "المنافس الأول على بطولة TNA X Division");
  assert.equal(applyCorrections("ضد فابيان إيكنر وفابيان آيشنر"), "ضد فابيان أيتشنر وفابيان أيتشنر");
});

// INCIDENTS #1341: «في نزال على لقب وزن الثقيل» and «ومضرب النساء» in the Josh Hokit story.
test("heavyweight is «الوزن الثقيل», the idafa weights stay, and «مضرب النساء» is «ضارب النساء»", () => {
  assert.equal(applyCorrections("في نزال على لقب وزن الثقيل في UFC"), "في نزال على لقب الوزن الثقيل في UFC");
  assert.equal(applyCorrections("بطل العالم لوزن الثقيل"), "بطل العالم للوزن الثقيل");
  assert.equal(applyCorrections("بطل الوزن الثقيل وبطولة وزن الريشة"), "بطل الوزن الثقيل وبطولة وزن الريشة");
  assert.equal(applyCorrections("المدمن ومضرب النساء"), "المدمن وضارب النساء");
});
