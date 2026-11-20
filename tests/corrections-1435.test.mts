import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1435: a Netflix competition show was called «مسلسل المسابقات», and Yordi Rosado lost his «ي».
test("«مسلسل المسابقات» becomes «برنامج المسابقات»", () => {
  assert.equal(applyCorrections("يشارك في مسلسل المسابقات المكسيكي"), "يشارك في برنامج المسابقات المكسيكي");
  assert.equal(applyCorrections("مسلسل مسابقات جديد"), "برنامج مسابقات جديد");
  assert.equal(applyCorrections("يشارك في مسلسل درامي"), "يشارك في مسلسل درامي");
});
test("«وردي روسادو» becomes «يوردي روسادو»", () => {
  assert.equal(applyCorrections("ووردي روسادو"), "ووردي روسادو".replace("ووردي", "ويوردي"));
  assert.equal(applyCorrections("مع وردي روسادو"), "مع يوردي روسادو");
});
