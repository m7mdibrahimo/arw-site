import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1540: wording from the 25 November stories (Adam Pearce, Logan Paul).
test("25 November wording is corrected", () => {
  assert.equal(applyCorrections("ولم تقتصر الرفوض على WCW"), "ولم يقتصر الرفض على WCW");
  assert.equal(applyCorrections("فإنه يمتلك الامتنان لأنه لم يخف"), "فإنه يشعر بالامتنان لأنه لم يخف");
  assert.equal(applyCorrections("ليكون مذيع الحلبة الداخلي لفريق سان دييغو بادريس"), "ليكون مذيع الملعب لفريق سان دييغو بادريس");
  assert.equal(applyCorrections("تكتيكات فريق ذا فيجن"), "ذا فيجن");
  assert.equal(applyCorrections("رفض العرض"), "رفض العرض");
});
