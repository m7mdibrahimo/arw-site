import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1452: Galeno del Mal written as the CMLL wrestler «غالينو فانتاسما», «هاكساو», «المسور الحديدي», «إيفانسفيل».
test("#1452 Galeno del Mal", () => {
  assert.equal(applyCorrections("فاغنر جونيور وغالينو فانتاسما"), "فاغنر جونيور وغالينو ديل مال");
});
test("#1452 Hacksaw is هاكسو", () => {
  assert.equal(applyCorrections("الأسطورة هاكساو جيم دوغان"), "الأسطورة هاكسو جيم دوغان");
});
test("#1452 barricade is السور الحديدي", () => {
  assert.equal(applyCorrections("تعلقت ساقه بالمسور الحديدي"), "تعلقت ساقه بالسور الحديدي");
});
test("#1452 Evansville is إيفانزفيل", () => {
  assert.equal(applyCorrections("في إيفانسفيل بولاية إنديانا"), "في إيفانزفيل بولاية إنديانا");
});
