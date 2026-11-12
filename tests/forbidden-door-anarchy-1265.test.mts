import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";
import { applyNamesGlossary } from "../scripts/fightful-watcher.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { metaDescription } = require("../lib/meta-description.cjs");

const pad = " كلام عادي كثير ".repeat(40);
const codes = (body: string) => checkArticle("مارينا شافير تعلق على احتمالية عودة روندا راوزي إلى AEW", body + pad).map((i) => i.code);

test("«الباب المحرم» blocks publishing and retries (Marina Shafir story, INCIDENTS #1265)", () => {
  assert.ok(BLOCKING_QA_CODES.includes("forbidden_door_arabic"));
  assert.ok(RETRYABLE_QA_CODES.includes("forbidden_door_arabic"));
  assert.ok(codes("وأكد توني خان حينها إقفال «الباب المحرم» محذرا من العودة إذا أرادت المصارعة مجددا.").includes("forbidden_door_arabic"));
  assert.ok(!codes("وأكد توني خان بعدها أن الباب مفتوح أمامها إذا أرادت المصارعة في الاتحاد مجددا.").includes("forbidden_door_arabic"));
  assert.ok(!codes("ويقام عرض AEW x NJPW Forbidden Door في الصيف المقبل.").includes("forbidden_door_arabic"));
});

test("an English event name half-translated is blocked, and the glossary keeps it whole (INCIDENTS #1265)", () => {
  assert.ok(codes("كما استرجعت ذكرياتها في نزال أناركي in the Arena، مؤكدة أنها استمتعت.").includes("lowercase_latin_fragment"));
  assert.ok(!codes("كما استرجعت ذكرياتها في نزال Anarchy in the Arena، مؤكدة أنها استمتعت.").includes("lowercase_latin_fragment"));
  assert.equal(applyNamesGlossary("كما استرجعت ذكرياتها في نزال Anarchy in the Arena، مؤكدة"), "كما استرجعت ذكرياتها في نزال Anarchy in the Arena، مؤكدة");
  assert.match(applyNamesGlossary("من اتحاد St. Louis Anarchy يوم 25 سبتمبر"), /سانت لويس أناركي/);
  assert.match(applyNamesGlossary("من صالة INTRUST Bank Arena في مدينة"), /إنترست بانك أرينا/);
});

test("a meta description never stops inside a name or on one side of «between» (INCIDENTS #1265)", () => {
  const moore = metaDescription("Shannon Moore spoke about his role in helping individuals battle addiction and achieve sobriety during the latest episode of the Insight with Chris Van Vliet podcast. Moore explained that the wrestling community has evolved significantly from the past.");
  assert.doesNotMatch(moore, /the Insight\.$/);
  assert.match(moore, /Chris Van Vliet podcast\.$/);
  const rey = metaDescription("Rey Mysterio revealed that he is in talks with Adam Pearce and Nick Aldis about organizing a classic five-on-five Survivor Series match between Team USA and Team Mexico at this year's Survivor Series event in Houston, which is set for later this month.");
  assert.doesNotMatch(rey, /between Team USA\.$/);
});
