import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, teaserTitleHidesName } from "../scripts/news-qa.ts";

// INCIDENTS #1309: Kyle Fletcher's headline hid Angelico («أحد نجوم AEW») while the text named him; «اثنين من النجوم
// عرضا» (dual verb) in the Destination X story; «كارلوس شيفاني» for TNA's president Carlos Silva; «إحدى خطاباته».
const codes = (title: string, body: string) => checkArticle(title, body).map((i) => i.code);

test("a teaser headline that hides a name the text gives is blocked", () => {
  const title = "كايل فليتشر ينسب الفضل إلى أحد نجوم AEW في ابتكار لقبه الشهير بروتوستار";
  const body = "ابتكر هذا الاسم بمساعدة المنتج جيمي جاكوبز وأحد نجوم AEW.\n\nوقال فليتشر إن جاكوبز سأل عن كلمة تعبر عن نجم صاعد، ليقوم أنجيليكو بالبحث عبر الإنترنت.";
  assert.equal(teaserTitleHidesName(title, body), "أنجيليكو");
  assert.ok(codes(title, body).includes("unnamed_person_title"));
});

test("the named headline, and a teaser whose source never names him, pass", () => {
  const body = "ابتكر هذا الاسم بمساعدة المنتج جيمي جاكوبز ونجم AEW أنجيليكو، فقام أنجيليكو بالبحث عبر الإنترنت.";
  assert.equal(teaserTitleHidesName("كايل فليتشر يكشف أن أنجيليكو صاحب فكرة لقبه الشهير بروتوستار", body), null);
  assert.equal(teaserTitleHidesName("أحد نجوم WWE يطلب الرحيل عن الاتحاد", "قالت التقارير إن أحد نجوم WWE طلب الرحيل دون ذكر اسمه."), null);
});

test("a dual verb after «اثنين من…» is blocked, the singular passes", () => {
  assert.ok(codes("اتحاد TNA يؤكد إقامة عرض Destination X في موعده", "مشيرا إلى أن اثنين من النجوم عرضا السفر جوا داخل أمريكا.").includes("dual_form"));
  assert.ok(!checkArticle("اتحاد TNA يؤكد إقامة عرض Destination X في موعده", "مشيرا إلى أن اثنين من النجوم عرضوا السفر جوا.").some((i) => i.code === "dual_form"));
});

test("corrections: Carlos Silva and «أحد» before a masculine plural", () => {
  assert.equal(applyCorrections("قال رئيس اتحاد TNA كارلوس شيفاني"), "قال رئيس اتحاد TNA كارلوس سيلفا");
  assert.equal(applyCorrections("بعد استخدامه في إحدى خطاباته، وفي إحدى حلقات البرنامج"), "بعد استخدامه في أحد خطاباته، وفي إحدى حلقات البرنامج");
  assert.equal(applyCorrections("وإحدى نزالاته"), "وأحد نزالاته");
});
