import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle } from "../scripts/news-qa.ts";
const codes = (b: string) => checkArticle("عنوان", b).map(i => i.code);
test("an English sentence glued into an Arabic paragraph is blocked", () => {
  const bad = "تغلب أنتوني جونسون في عرض World Series of Fighting 2. In 2013, Anthony Johnson defeated Andrei Arlovski by unanimous decision at World تعرض أرلوفسكي للسقوط.";
  assert.ok(codes(bad).includes("english_sentence_in_arabic"));
});
test("promotion and event names inside Arabic text are fine", () => {
  const ok = "أقام اتحاد GCW عرض GCW Dead On Arrival في صالة Pop's Nightclub & Concert Venue بمدينة ساوجيت وحضر برنامج «Insight with Chris Van Vliet» كما ظهر في World Series of Fighting 2 مباشرة.";
  assert.ok(!codes(ok).includes("english_sentence_in_arabic"));
});
