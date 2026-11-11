import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, claimNotInSource } from "../scripts/news-qa.ts";
import { fixEnglishNames } from "../scripts/english-edition.ts";

const filler = " وتفاصيل كثيرة عن العرض والنجوم المشاركين فيه.".repeat(12);
const codes = (body: string, title = "عنوان خبر عادي عن عرض WWE RAW") => checkArticle(title, body + filler, []).map((i: any) => i.code);

test("#1227: dual «البطلين» and «ما زالا» never reach a story", () => {
  assert.equal(applyCorrections("🏆 **الفائزون (وما زالا البطلين):** فانيتي بروجيكت"), "🏆 **الفائزون (وما زالوا الأبطال):** فانيتي بروجيكت");
  assert.ok(codes("وحسم النزال أحد البطلين في النهاية.").includes("dual_noun"));
});

test("#1227: «SummerSlam weekend» is «أيام عرض», never «عطلة عرض»; a real weekend stays", () => {
  assert.equal(applyCorrections("تجربة أداء خلال عطلة SummerSlam"), "تجربة أداء خلال أيام عرض SummerSlam");
  assert.equal(applyCorrections("خلال عطلة عرض WrestleMania 43"), "خلال أيام عرض WrestleMania 43");
  assert.equal(applyCorrections("في عطلة نهاية الأسبوع الافتتاحية"), "في عطلة نهاية الأسبوع الافتتاحية");
});

test("#1227: «شارك مع فلان» with no object is blocked, «شارك مع فلان في …» passes", () => {
  assert.ok(codes("حقق اللقب مرتين، كما شارك مؤخرا مع زوجته إيه جيه لي.").includes("verb_missing_object"));
  assert.ok(!codes("كما شارك مؤخرا مع زوجته إيه جيه لي في نزال فرق.").includes("verb_missing_object"));
});

test("#1227: the same win told twice in one sentence is blocked", () => {
  const bad = "وتمكن إسكوبار من هزيمة مو جاباري ليفوز باللقب، بعد تغلبه على ريكي نايت في نزال، إضافة إلى هزيمته لمو جاباري.";
  assert.ok(codes(bad).includes("repeated_win_clause"));
  assert.ok(!codes("وفاز باللقب بعد أن هزم مو جاباري، إضافة إلى هزيمته لريكي نايت.").includes("repeated_win_clause"));
});

test("#1227: «لينهي عداوة» needs a source that says the feud ended", () => {
  const pad = " Punk has been busy in recent weeks with many matches across WWE programming and the end of the year is close.".repeat(4);
  const src = "Punk faced Kevin Owens, who finally got his vengeance on their unresolved animosity." + pad;
  assert.ok(claimNotInSource("واجه كيفن أوينز لينهي عداوة قديمة", src, "ar").length > 0);
  assert.equal(claimNotInSource("واجه كيفن أوينز لينهي عداوة قديمة", "Their rivalry was finally settled at the show." + pad, "ar").length, 0);
  assert.ok(claimNotInSource("He faced Kevin Owens to end their long-standing rivalry", src, "en").length > 0);
});

test("#1227: English spells her CJ Perry; Rock N Wrestling has no slash", () => {
  assert.equal(fixEnglishNames("C.J. Perry recently reflected"), "CJ Perry recently reflected");
  assert.equal(applyCorrections("عرض Rock N/Wrestling Rager at Sea"), "عرض Rock N Wrestling Rager at Sea");
});
