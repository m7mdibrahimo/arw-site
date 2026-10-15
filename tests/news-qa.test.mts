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

test("the names glossary has no dual-form champion titles (INCIDENTS #559)", async () => {
  const fs = await import("node:fs");
  const names = JSON.parse(fs.readFileSync(new URL("../scripts/wrestler-names.json", import.meta.url), "utf8")) as Record<string, string>;
  const dual = Object.entries(names).filter(([, v]) => /(?:بطلتا|بطلا|العالميتان|العالميان)(?![ء-ي])/.test(String(v)));
  assert.deepEqual(dual, []);
});

test("a tatweel before an ARABIC name is removed and blocked (INCIDENTS #564)", async () => {
  const { autoFix } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("إعلان ضخم لـبيكي لينش ورد بـتايتشي"), "إعلان ضخم لبيكي لينش ورد بتايتشي");
  const t = "ساتوشي كوجيما مطالب بتحقيق شرط الوزن لمواجهة يوه في عرض NJPW الخاص بـتايتشي";
  assert.ok(checkArticle(t, "نص الخبر هنا طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic" && i.field === "title"));
  assert.ok(!checkArticle(t.replace("بـتايتشي", "بتايتشي"), "نص الخبر هنا.").some((i) => i.code === "tatweel_before_arabic"));
});

test("no published Arabic story has a tatweel before an Arabic letter (INCIDENTS #564)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../content/news/", import.meta.url);
  const bad = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && /\u0640(?=[\u0621-\u064A])/.test(fs.readFileSync(new URL(f, dir), "utf8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

test("dual_form: «تزوجا» is blocked, but the name «بي جي فازا» (PJ Vasa) is not a dual verb (INCIDENTS #570)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("تمت خطبة الثنائي ثم تزوجا رسميا في جامايكا خلال يونيو 2026 وسط حضور كبير من الأصدقاء والعائلة.").includes("dual_form"));
  assert.ok(!codes("وطلب بي جي فازا منها أن تجرب ذلك معه في الأسبوع القادم بعد انتهاء النزال الرئيسي في العرض.").includes("dual_form"));
});

test("«ى» for «ي» in nisba words and a dropped show name are blocked (INCIDENTS #594)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("سيناقش الثنائى مسيرتهم العالمية وماضي ومستقبل المصارعة مع تلقي أسئلة الجماهير المتابعة.").includes("alif_maqsura_ya"));
  assert.ok(codes("عن نزالهم التاريخى السابق في الاتحاد وكواليس تروى لأول مرة للجمهور المتابع.").includes("alif_maqsura_ya"));
  assert.ok(!codes("سيناقش الثنائي مسيرتهم العالمية وأعلى مستوى وصلوا إليه في الاتحاد.").includes("alif_maqsura_ya"));
  assert.ok(codes("أوضحت كيتلين خلال استضافتها في برنامج أن المخطط الأصلي كان يقضي بخروجها مبكرا من النزال.").includes("dropped_show_name"));
  assert.ok(!codes("أوضحت كيتلين خلال استضافتها في برنامج Insight مع كريس فان فليت أن المخطط الأصلي كان خروجها مبكرا.").includes("dropped_show_name"));
});

test("a wrestler teaming with himself is blocked (INCIDENTS #602: «فليتشر … سيتعاون مع كايل فليتشر»)", () => {
  const bad = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع كايل فليتشر لمواجهة فريق ذا يانغ باكس.";
  assert.ok(checkArticle("عنوان واضح للخبر هنا", bad).some((i) => i.code === "self_partner"));
  const ok = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع مارك ديفيس لمواجهة فريق ذا يانغ باكس.";
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", ok).some((i) => i.code === "self_partner"));
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "يتعاون كوفي كينغستون مع أوستن كريد في الحلبة.").some((i) => i.code === "self_partner"));
});

test("«الحدف» is corrected to «الهدف» (INCIDENTS #602)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("لتحقيق هذا الحدف"), "لتحقيق هذا الهدف");
});

test("a relative with the same surname is not a self-partner (INCIDENTS #602)", () => {
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "ويدافع نيك نيميث عن لقبه، قبل أن يتحد مع شقيقه رايان نيميث في النزال القادم.").some((i) => i.code === "self_partner"));
});
