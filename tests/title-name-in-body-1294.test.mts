import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle, titleNamesMissingFromBody, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";
import { RETRY_SETTLE_MS } from "../scripts/check-playback.ts";

// INCIDENTS #1294: «… لم شمل سكاي تيم وظهور يوتا تسوجي» — the text never mentions Yota Tsuji
const cmllTitle = "نتائج عرض CMLL Viernes Espectacular (13 نوفمبر 2026): لم شمل سكاي تيم وظهور يوتا تسوجي";
const cmllBody = "أقيم عرض CMLL Viernes Espectacular مساء 13 نوفمبر 2026 في صالة أرينا مكسيكو.\n\nفاز بانديدو وبريانتي جونيور على باربارو كافيرناريو ويوتاني، وفاز فريق سكاي تيم في الحدث الرئيسي.";

test("a glossary name in the headline that the text never mentions blocks the story", () => {
  assert.deepEqual(titleNamesMissingFromBody(cmllTitle, cmllBody), ["يوتا تسوجي"]);
  assert.ok(checkArticle(cmllTitle, cmllBody).some((i) => i.code === "title_name_not_in_body"));
  assert.ok(BLOCKING_QA_CODES.includes("title_name_not_in_body"));
  assert.ok(RETRYABLE_QA_CODES.includes("title_name_not_in_body"));
});

test("the name in the text, a part of it, its English spelling or a team's members pass", () => {
  assert.deepEqual(titleNamesMissingFromBody(cmllTitle, cmllBody + "\n\nوشهد العرض أيضا ظهور يوتا تسوجي نجم اتحاد NJPW."), []);
  assert.deepEqual(titleNamesMissingFromBody(cmllTitle, cmllBody + "\n\nوظهر تسوجي بعد النزال."), []);
  assert.deepEqual(titleNamesMissingFromBody("ذا أندرتيكر يوضح أهمية دفع المستحقات", "تحدث مارك كالاواي في برنامجه Six Feet Under with The Undertaker عن بداياته."), []);
  assert.deepEqual(titleNamesMissingFromBody("مات هاردي: كل أزياء فريق ذا هارديز كانت من حياكتي", "قال مات هاردي إنه صنع الأزياء التي ارتداها مع شقيقه جيف هاردي."), []);
  assert.deepEqual(titleNamesMissingFromBody("مارينا شافير: لا توجد عقلية المساعد في فريق ديث رايدرز", "تؤكد مارينا شافير أنها ليست مساعدة تابعة لأحد."), ["ديث رايدرز"]);
});

test("the playback check's second try waits long enough for StreamHG's fallback", () => {
  assert.ok(RETRY_SETTLE_MS >= 20000);
});
