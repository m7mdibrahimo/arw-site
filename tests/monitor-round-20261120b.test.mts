import { test } from "node:test";
import assert from "node:assert/strict";
import { fixTimeDuals, autoFix, applyCorrections, checkArticle } from "../scripts/news-qa.ts";

test("«two days» becomes forty-eight hours, not a dual and not 24 hours (DDP story)", () => {
  assert.equal(fixTimeDuals("أمضى مؤخرا يومين في تدريب"), "أمضى مؤخرا ثماني وأربعين ساعة في تدريب");
  assert.equal(fixTimeDuals("خلال اليومين الماضيين"), "خلال الساعات الثماني والأربعين الماضية");
  assert.equal(fixTimeDuals("ليومين"), "لثماني وأربعين ساعة");
  assert.equal(fixTimeDuals("يومين 18 و19 نوفمبر"), "يومين 18 و19 نوفمبر");
});

test("an Arabic quote ending on a Latin question mark gets the Arabic one (Markova story)", () => {
  assert.equal(autoFix('قائلة: "كيف تعاملكم لعبة GTA VI?"، بالتزامن'), 'قائلة: "كيف تعاملكم لعبة GTA VI؟"، بالتزامن');
  assert.ok(autoFix("https://www.youtube.com/watch?v=MOkXQZoZHjY").includes("watch?v="));
  assert.equal(autoFix("عقبة رئيسية تعطل توقيع فريق ذا نيو داي مع اتحاد AEW?"), "عقبة رئيسية تعطل توقيع فريق ذا نيو داي مع اتحاد AEW؟");
  assert.equal(autoFix("How is GTA VI treating you?"), "How is GTA VI treating you?");
  assert.equal(autoFix("عبر برنامج What's Your Story? الذي تقدمه"), "عبر برنامج What's Your Story? الذي تقدمه");
});

test("«لم تحتاج» is corrected to «لم تحتج»", () => {
  assert.ok(applyCorrections("ولم تحتاج ماركوفا إلى").includes("لم تحتج"));
});

test("dual trademark filings are blocked (WWE Gringo Anonimo story)", () => {
  const codes = checkArticle("اتحاد WWE يتقدم بطلبين لتسجيل العلامتين التجاريتين Gringo Anonimo", "نص الخبر هنا.").map((i) => i.code);
  assert.ok(codes.includes("dual_noun"));
});
