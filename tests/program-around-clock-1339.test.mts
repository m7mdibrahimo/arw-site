import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1339: «the 24/7 TNA Wrestling Radio» was written «برنامجه الإذاعي الخاص … والذي سيعمل على مدار الساعة».
test("a «program» that runs around the clock is blocked", () => {
  const body = "أعلن اتحاد TNA عن إطلاق برنامجه الإذاعي الخاص TNA Wrestling Radio، والذي سيعمل على مدار الساعة، وذلك في إطار شراكة مع منصة iHeartRadio.";
  const codes = checkArticle("TNA Wrestling تطلق برنامجا إذاعيا جديدا", body).map(i => i.code);
  assert.ok(codes.includes("program_around_clock"));
  assert.ok(BLOCKING_QA_CODES.includes("program_around_clock"));
});

test("a station that broadcasts around the clock, or a normal program, passes", () => {
  const ok = "أعلن اتحاد TNA عن إطلاق محطته الإذاعية الخاصة TNA Wrestling Radio، التي ستبث على مدار الساعة. وسيقدم المعلق برنامجا أسبوعيا يوم الاثنين.";
  assert.ok(!checkArticle("TNA Wrestling تطلق محطة إذاعية تبث على مدار الساعة", ok).map(i => i.code).includes("program_around_clock"));
});

// INCIDENTS #1339: «فوزها بنزال ألتيميت إكس للسيدات … في نزال فرق سداسي» — Ultimate X is a six-way, not a tag match.
test("an Ultimate X match called a tag match in the same sentence is blocked", () => {
  const body = "وتفوقت ستيلز على كل من شوتزي بلاك هارت وكيرا هوجان في نزال فرق سداسي ضمن نزال ألتيميت إكس للسيدات.";
  assert.ok(checkArticle("تاشا ستيلز تفوز بنزال ألتيميت إكس", body).map(i => i.code).includes("ultimate_x_as_tag"));
  assert.ok(BLOCKING_QA_CODES.includes("ultimate_x_as_tag"));
});

test("a real tag match in another sentence of an Ultimate X story passes", () => {
  const body = "تحددت مصارعات نزال ألتيميت إكس للسيدات. وتتحول المواجهة الأخرى إلى نزال فرق ثلاثي يدافع فيه الإخوة نيميث عن اللقب.";
  assert.ok(!checkArticle("تحديد مصارعات نزال ألتيميت إكس", body).map(i => i.code).includes("ultimate_x_as_tag"));
});

test("Baszler is always «شينا باسلر»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("سيطرت شاينا بازلر على الحلبة، ثم استهدفت بازلر ذراعها"), "سيطرت شينا باسلر على الحلبة، ثم استهدفت باسلر ذراعها");
});
