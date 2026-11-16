import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1349: «عرض التمهيد الضعيف: اعتمد العرض…» (TNA Destination X review) — «pre-show» is «العرض التمهيدي».
test("«عرض التمهيد» becomes «العرض التمهيدي», and the right form is untouched", () => {
  assert.equal(applyCorrections("- عرض التمهيد الضعيف: اعتمد"), "- العرض التمهيدي الضعيف: اعتمد");
  assert.equal(applyCorrections("في العرض التمهيدي لعرض AEW All In"), "في العرض التمهيدي لعرض AEW All In");
  assert.equal(applyCorrections("ضمن العروض التمهيدية"), "ضمن العروض التمهيدية");
});
