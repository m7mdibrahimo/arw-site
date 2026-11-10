import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

const body = (s: string) => `${s}\n\nنص إضافي طويل بما يكفي لكي لا يعتبر الخبر قصيرا عند الفحص الآلي، ويشرح تفاصيل ما حدث في العرض الأخير بوضوح.`;

test("#1222: «ووصفتهابأنها» blocks publishing, a real «بأنها» does not", () => {
  assert.ok(BLOCKING_QA_CODES.includes("glued_arabic_words"));
  const bad = checkArticle("بايلي تعلق على مواجهة ميتشين", body("كتبت بايلي منشورا ووصفتهابأنها واحدة من أكثر المصارعات موهبة."));
  assert.ok(bad.some((i: any) => i.code === "glued_arabic_words"));
  const ok = checkArticle("بايلي تعلق على مواجهة ميتشين", body("كتبت بايلي منشورا ووصفتها بأنها واحدة من أكثر المصارعات موهبة، وأضافت وبأنها تنتظر."));
  assert.ok(!ok.some((i: any) => i.code === "glued_arabic_words"));
});

test("#1222: «تحت اسمي فلان وفلان» is a dual, «تحت اسمي الحقيقي» in a quote is not", () => {
  const bad = checkArticle("بايلي تعلق على مواجهة ميتشين", body("عملتا معا تحت اسمي دابينا روز وميا يم."));
  assert.ok(bad.some((i: any) => i.code === "dual_noun"));
  const ok = checkArticle("بايلي تعلق على مواجهة ميتشين", body("قال: «أصارع تحت اسمي الحقيقي» في كل مكان."));
  assert.ok(!ok.some((i: any) => i.code === "dual_noun"));
});

test("#1222: corrections for Becky's name, «ارتكن», doubled «نزال», and «سيء»", () => {
  assert.equal(applyCorrections("عودة بيقي لينش"), "عودة بيكي لينش");
  assert.equal(applyCorrections("ارتكن إلى خيارات أخرى"), "لجأ إلى خيارات أخرى");
  assert.equal(applyCorrections("نزال تصفيات نزال Money in the Bank"), "التصفيات المؤهلة لنزال Money in the Bank");
  assert.equal(applyCorrections("هذا أمر سيء جدا"), "هذا أمر سيئ جدا");
  assert.equal(applyCorrections("لا يقول شيء عنه"), "لا يقول شيء عنه");
  assert.equal(applyCorrections("كلام مسيء له"), "كلام مسيء له");
});
