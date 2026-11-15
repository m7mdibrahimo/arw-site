import { test } from "node:test";
import assert from "node:assert/strict";
import { titleChangeWrittenAsDefense, applyCorrections, fixSubjunctiveDuals, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS #1335: the Kofi / AEW Full Gear story said the champions «دافعوا عن ألقابهم أمام» Swerve and the New Level,
// who in fact recaptured the titles; and «الجديدين»، «لن تتمكنا»، «هذه الموقفة»، «المققيم»، «إدمنتون»، «ألتيميت X» went live.
const SOURCE = "On the show, the AEW World Trios Titles were on the line as Hangman Adam Page, Brody King, and Bandido defended their belts against Swerve Strickland and the New Level (Austin Creed and Kofi). Following their victory, Kofi shared: We are your World Trios Champions, once again. After recapturing the AEW World Trios Titles at Full Gear.";

test("a title change written as a successful defense is caught, Arabic and English", () => {
  assert.ok(titleChangeWrittenAsDefense("حيث دافع هانغمان آدم بيدج وبرودي كينج وبانديدو عن ألقابهم أمام سويرف ستريكلاند وثنائي ذا نيو ليفل. وبعد الفوز وتحقيق اللقب، كتب كوفي", SOURCE));
  assert.ok(titleChangeWrittenAsDefense("Hangman Adam Page, Brody King, and Bandido defended the AEW World Trios Titles against Swerve Strickland and The New Level. Following their victory, Kofi wrote", SOURCE, "en"));
});

test("a story that says who took the titles passes, and a real retention is never flagged", () => {
  assert.equal(titleChangeWrittenAsDefense("انتزع سويرف ستريكلاند وفريق ذا نيو ليفل بطولة العالم للفرق الثلاثية من هانغمان آدم بيدج وبرودي كينج وبانديدو.", SOURCE), "");
  assert.equal(titleChangeWrittenAsDefense("Swerve Strickland and The New Level won the AEW World Trios Titles from Hangman Adam Page.", SOURCE, "en"), "");
  assert.equal(titleChangeWrittenAsDefense("دافع رومان رينز عن لقبه أمام بينتا", "Roman Reigns defended against Penta and retained the title."), "");
  assert.equal(titleChangeWrittenAsDefense("دافع رومان رينز عن لقبه أمام بينتا", "Roman Reigns will defend against Penta at the show."), "");
});

test("«الجديدين» and «لن تتمكنا» are blocked, «لن يتمكنا» is rewritten", () => {
  const pad = " كلام".repeat(80);
  assert.ok(checkArticle("ترحيب سويرف بزملائه في AEW", "رحب سويرف ستريكلاند بالنجوم الجديدين رسميا." + pad, []).some((i: any) => i.code === "dual_noun"));
  assert.ok(checkArticle("مشاكل السفر في TNA", "أكدت التقارير أن هارتويل وبروكسايد لن تتمكنا من اللحاق بالعرض." + pad, []).some((i: any) => i.code === "dual_form"));
  assert.equal(fixSubjunctiveDuals("ولن يتمكنا من التواجد"), "ولن يتمكنوا من التواجد");
  assert.equal(fixSubjunctiveDuals("لم يستطيعا الوصول"), "لم يستطيعوا الوصول");
  assert.ok(!checkArticle("أبطال جدد في WWE", "توج الأبطال الجدد باللقب في عرض جديد." + pad, []).some((i: any) => i.code === "dual_noun"));
});

test("«الموقفة»، «المققيم»، «إدمنتون» and «ألتيميت X» are corrected", () => {
  assert.equal(applyCorrections("ولا تعد هذه الموقفة الأولى لها"), "ولا تعد هذا الموقف الأول لها");
  assert.equal(applyCorrections("العرض المققيم في صالة"), "العرض المقام في صالة");
  assert.equal(applyCorrections("إلى مدينة إدمنتون في الوقت"), "إلى مدينة إدمونتون في الوقت");
  assert.equal(applyCorrections("في مدينة إدمونتون"), "في مدينة إدمونتون");
  assert.equal(applyCorrections("شهد نزال ألتيميت X للسيدات"), "شهد نزال ألتيميت إكس للسيدات");
});
