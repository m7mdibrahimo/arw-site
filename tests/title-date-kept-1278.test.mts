import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProofEdits } from "../scripts/editorial.ts";

const draft = { title: "عرض TNA iMPACT: ثلاثة أمور كرهناها وثلاثة أحببناها (12 نوفمبر)", body: "نص", tags: [] as string[] };

test("a proofread edit never drops the date from a title (INCIDENTS #1278)", () => {
  const { article, applied } = applyProofEdits(draft, [{ field: "title", find: draft.title, replace: "عرض TNA iMPACT: ثلاثة أمور كرهناها وثلاثة أحببناها" }]);
  assert.equal(article.title, draft.title);
  assert.equal(applied.length, 0);
});

test("a title edit that keeps or corrects the date still applies", () => {
  const typo = { ...draft, title: "عرض TNA iMPACT: ثلاثة أمور كرهناها وثلاثة احببناها (12 نوفمبر)" };
  const { article } = applyProofEdits(typo, [{ field: "title", find: "احببناها", replace: "أحببناها" }]);
  assert.equal(article.title, draft.title);
});
