import { test } from "node:test";
import assert from "node:assert/strict";
import { claimNotInSource } from "../scripts/news-qa.ts";

// Deonna Purrazzo, INCIDENTS #1310: the source never says "only".
const SOURCE = `Deonna Purrazzo thinks women's wrestling has a character problem, and she doesn't believe simply giving women more matches is going to fix it. "So I think across the board for women's wrestling, it's developing characters that people relate to or hate. And that's what's going to get us those storylines, and that's what's going to get us more time, and that's what's going to get us main events."`;
const LABEL = "السبيل الوحيد / the only way";

test("«السبيل الوحيد» with no 'only' in the source is blocked", () => {
  assert.ok(claimNotInSource("وشددت بورازو على أن الاستثمار في تطوير الشخصيات هو السبيل الوحيد للحصول على قصص أطول.", SOURCE).includes(LABEL));
  assert.ok(claimNotInSource("She said it is the only way to get longer storylines.", SOURCE, "en").includes(LABEL));
});

test("a negated «ليست الحل الوحيد», or a source that says only, passes", () => {
  assert.ok(!claimNotInSource("ترى أن زيادة عدد النزالات ليست الحل الوحيد.", SOURCE).includes(LABEL));
  assert.ok(!claimNotInSource("قال إن WWE هي الطريق الوحيد.", SOURCE + " Everyone said WWE was the only way.").includes(LABEL));
});
