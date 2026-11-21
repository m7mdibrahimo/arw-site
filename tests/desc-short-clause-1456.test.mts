import test from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1456: a long first sentence was word-cut and the snippet ended «…left him considering.» / «…with complete.»
test("a long first sentence ends on its 50–69 letter main clause instead of a hanging word (INCIDENTS #1456)", async () => {
  const { metaDescription } = await import("../lib/meta-description.cjs");
  const a = metaDescription("Jim Cornette made it clear that he has reached his limit with AEW, expressing that the Anarchy in the Arena match at AEW Full Gear 2026 left him considering walking away from professional wrestling completely. During a recent episode of his podcast, Cornette delivered a harsh review.");
  assert.equal(a, "Jim Cornette made it clear that he has reached his limit with AEW.");
  const b = metaDescription("R-Truth's family may feature a new wrestler in the future, as his son Christopher was spotted performing impressive moves inside the ring with complete confidence and comfort. R-Truth had previously spoken about it.");
  assert.equal(b, "R-Truth's family may feature a new wrestler in the future.");
});

test("Arabic fixes of round #1456 are applied by the corrections list", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("بكل ثقة وارتتاح"), "بكل ثقة وارتياح");
  assert.equal(applyCorrections("قال: يا أبتاه"), "قال: يا أبي");
  assert.equal(applyCorrections("تنفيذ حركة رماية الذراع"), "تنفيذ حركة آرم دراج");
  assert.equal(applyCorrections("رومان رينز، بطولة العالم للوزن الثقيل الحالي، يستعد"), "رومان رينز، بطل العالم للوزن الثقيل الحالي، يستعد");
});
