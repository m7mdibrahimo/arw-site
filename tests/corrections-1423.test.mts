import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1423: «لهجوم قاسي», «ضغط العتبة» (bench press) and «يحاول بناؤه» reached stories.
test("indefinite «قاسي» → «قاس»; bench press; «يحاول بناءه»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بعد تعرضه لهجوم قاسي من فريق"), "بعد تعرضه لهجوم قاس من فريق");
  assert.equal(applyCorrections("### شرط قاسي: محو التاريخ"), "### شرط قاس: محو التاريخ");
  assert.equal(applyCorrections("كان قاسي جدا"), "كان قاسي جدا");
  assert.equal(applyCorrections("الشتاء القاسي"), "الشتاء القاسي");
  assert.equal(applyCorrections("صعوبة أداء تمارين مثل ضغط العتبة"), "صعوبة أداء تمارين مثل ضغط الصدر");
  assert.equal(applyCorrections("للحفاظ على الزخم الذي يحاول بناؤه رغم"), "للحفاظ على الزخم الذي يحاول بناءه رغم");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?:لهجوم|شرط|توقيت) قاسي(?![ء-ي])|ضغط العتبة|يحاول بناؤه/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
