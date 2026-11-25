import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1532: «عند عودته إلى عرض AEW» (the promotion is not a show) and «انتقادات كواليس» (missing «في»).
test("promotion called a show and backstage without «في» are corrected", () => {
  assert.equal(applyCorrections("بادي ماثيوز يلمح إلى تغييرات كبرى عند عودته إلى عرض AEW"), "بادي ماثيوز يلمح إلى تغييرات كبرى عند عودته إلى AEW");
  assert.equal(applyCorrections("بعد انضمامها إلى عرض WWE، قالت"), "بعد انضمامها إلى WWE، قالت");
  // a real show name or a specific event stays
  assert.equal(applyCorrections("عند عودته إلى عرض AEW Dynamite"), "عند عودته إلى عرض AEW Dynamite");
  assert.equal(applyCorrections("عند عودته إلى عرض WWE المرتقب في السعودية"), "عند عودته إلى عرض WWE المرتقب في السعودية");
  assert.equal(applyCorrections("إيزي دايم تتلقى انتقادات كواليس عرض WWE NXT"), "إيزي دايم تتلقى انتقادات في كواليس عرض WWE NXT");
  assert.equal(applyCorrections("انتقادات في كواليس WWE"), "انتقادات في كواليس WWE");
});
