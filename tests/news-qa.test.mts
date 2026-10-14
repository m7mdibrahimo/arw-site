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
  assert.ok(checkArticle("عنوان", "المواجهة بين الاثنتين مهمة.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "ليلتا العرض كانتا ممتازتين.").some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle("عنوان", "في يوم الاثنين أقيم العرض.").some((i) => i.code === "dual_noun"));
});
