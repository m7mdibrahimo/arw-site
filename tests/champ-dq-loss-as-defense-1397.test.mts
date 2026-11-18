import { test } from "node:test";
import assert from "node:assert/strict";
import { champDqLossAsDefense } from "../scripts/news-qa.ts";

// WWE NXT 17 Nov 2026: Kelani Jordan slapped the referee to cause the DQ and kept her title — not «a successful defense» (INCIDENTS #1397).
const src = "After finding herself in Grey's ankle lock, Jordan slapped the referee to cause the DQ, keeping her title via champion's advantage.";

test("a champion who caused the DQ is not written as a successful defense", () => {
  const wrong = "دافعت كيلاني جوردان بنجاح عن بطولة WWE NXT للسيدات ضد كيندال غراي، واحتفظت بلقبها بالاستبعاد بعد صفعة متعمدة للحكم.";
  assert.ok(champDqLossAsDefense(wrong, src));
});

test("the right wording, or a source without a caused DQ, passes", () => {
  const right = "صفعت كيلاني جوردان الحكم عمدا وخسرت النزال بالاستبعاد، لكنها احتفظت بالبطولة لأن اللقب لا ينتقل بالاستبعاد.";
  assert.equal(champDqLossAsDefense(right, src), null);
  const legit = "دافع البطل بنجاح عن لقبه بعد فوزه بالاستبعاد.";
  assert.equal(champDqLossAsDefense(legit, "The champion retained after the challenger hit him with a chair, by disqualification."), null);
});
