import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1410: literal translations and a misspelled «Theatre».
test("literal-translation fixes of round #1410", () => {
  assert.equal(applyCorrections("هاربوز كونسيرت ثياتتر"), "هاربوز كونسيرت ثياتر");
  assert.equal(applyCorrections("وصنع العملة التي نعرفها"), "وتحقيق النجاح الذي نعرفها");
  assert.equal(applyCorrections("الشاحنة لا تحتاج إلى أي شك حول"), "الشاحنة لا تترك أي شك حول");
  assert.equal(applyCorrections("الأمر لا يحتاج إلى أي شك"), "الأمر لا يترك أي شك");
});
