import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1448: Evansville as «إيفانزوبوليس», Steel Cage as «قفص الهيكل», and «خطط قد قابلة للتغيير».
test("#1448 Evansville is إيفانزفيل", () => {
  assert.equal(applyCorrections("حلقة في إيفانزوبوليس بولاية إنديانا"), "حلقة في إيفانزفيل بولاية إنديانا");
});
test("#1448 Steel Cage is القفص الحديدي", () => {
  assert.equal(applyCorrections("مرورا بمواجهة قفص الهيكل"), "مرورا بمواجهة القفص الحديدي");
});
test("#1448 no «قد» before an adjective", () => {
  assert.equal(applyCorrections("وسط خطط قد قابلة للتغيير"), "وسط خطط قابلة للتغيير");
});
