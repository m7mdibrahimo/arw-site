import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle } from "../scripts/news-qa.ts";

test("a long number spelled in words in the TITLE is blocked (INCIDENTS #520: «ألف وثلاثمائة وستة عشر يوما»)", () => {
  const issues = checkArticle("رومان رينز يكشف صعوبة تصديق نهاية فترة احتفاظه بلقبه لمدة ألف وثلاثمائة وستة عشر يوما", "نص الخبر هنا.");
  assert.ok(issues.some((i) => i.code === "spelled_number" && i.field === "title"));
  assert.ok(!checkArticle("رومان رينز يحتفظ بلقبه لمدة 1316 يوما", "نص.").some((i) => i.code === "spelled_number"));
});

test("a sentence ending on «وقال.» and the duals «الاثنتين» / «ليلتا» are blocked (INCIDENTS #535)", () => {
  const body = "تحدث رويس كيز عن انضمام هايز، مشيرا إلى أن هايز يمتلك جانبا عدوانيا لم يره الجمهور بعد، وقال.\n\nنص آخر طويل بما يكفي.";
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", body).some((i) => i.code === "dangling_speech"));
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وقال كيز إن الفريق قوي جدا.").some((i) => i.code === "dangling_speech"));
  // a colon before a blockquote is a normal way to introduce a quote, not a lost quote
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\n> لا أعرف حقا.\n\nنص آخر.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\nنص آخر طويل.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("عنوان", "المواجهة بين الاثنتين مهمة.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "ليلتا العرض كانتا ممتازتين.").some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle("عنوان", "في يوم الاثنين أقيم العرض.").some((i) => i.code === "dual_noun"));
});

test("dual verbs «يعرفان / الاثنان» and a bold heading line opening the story are blocked (INCIDENTS #558)", () => {
  const t = "جيفون إيفانز يتحدث عن علاقته بجاكوب فاتو";
  assert.ok(checkArticle(t, "بدأ الاثنان مسيرتهم في الاتحادات المستقلة ويعرفان حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(!checkArticle(t, "بدأ كل منهم مسيرته في الاتحادات المستقلة ويعرف حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(checkArticle(t, "**المواجهة الأولى: نزال فرق للسيدات**\n\nأعلن اتحاد AEW عن نزال جديد.").some((i) => i.code === "stray_heading"));
  assert.ok(!checkArticle(t, "أعلن اتحاد AEW عن نزال جديد في **عرض كبير** قريبا.").some((i) => i.code === "stray_heading"));
});
