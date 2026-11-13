import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, fixSubjunctiveDuals } from "../scripts/news-qa.ts";

const body = "تحدثت نجمة WWE راكيل رودريغيز عن فترتها مع فريق ذا جادجمنت داي وعن قصتها مع كارليتو قبل رحيله عن الشركة في يونيو 2025.";
const codes = (title: string, b = body) => checkArticle(title, b, []).map(i => i.code);

test("#1271 a weak-verb dual subjunctive («أن يحظيا»، «لم يحظيا») is rewritten to the plural", () => {
  assert.equal(fixSubjunctiveDuals("معربة عن أملها في أن يحظيا بمشهد ختامي"), "معربة عن أملها في أن يحظوا بمشهد ختامي");
  assert.equal(fixSubjunctiveDuals("تقديم جديد لم يحظيا بفرصة تطبيقه"), "تقديم جديد لم يحظوا بفرصة تطبيقه");
  assert.equal(fixSubjunctiveDuals("قبل أن يلتقيا في الحلبة"), "قبل أن يلتقوا في الحلبة");
  assert.ok(applyCorrections(`${body}\n\nوتمنت أن يحظيا بمشهد أخير.`).includes("أن يحظوا بمشهد"));
});

test("#1271 «يبقيا» is not auto-rewritten (its subject is often a thing) but still blocks", () => {
  assert.equal(fixSubjunctiveDuals("الصداقة والاحترام يجب أن يبقيا فوق"), "الصداقة والاحترام يجب أن يبقيا فوق");
  assert.ok(codes("كيفن ناش يدعو الجماهير إلى التصويت في الانتخابات", `${body} الصداقة والاحترام يجب أن يبقيا فوق أي خلاف.`).includes("dual_form"));
});

test("#1271 a headline ending on «the former member of <group>» must name him", () => {
  assert.ok(codes("راكيل رودريغيز تتمنى لو أنها حصلت على نهاية واضحة لقصتها مع العضو السابق في فريق ذا جادجمنت داي").includes("unnamed_person_title"));
  assert.ok(!codes("راكيل رودريغيز تتمنى لو انتهت قصتها مع كارليتو بنهاية واضحة قبل رحيله عن WWE").includes("unnamed_person_title"));
  assert.ok(!codes("العضو السابق في فريق ذا شيلد دين أمبروز يعود إلى الحلبات في عرض جديد قريبا").includes("unnamed_person_title"));
});
