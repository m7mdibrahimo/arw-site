// INCIDENTS #1249: the Kyle Fletcher story said the segment «ended with a slap»
// (the source said it ended with Ospreay's «another level» line) and left
// «now that he was at full health» without saying who. The rule must reach
// the guide Gemini writes and proofreads with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editorialGuideForPrompt } from "../scripts/editorial.ts";

test("the editorial guide sent to Gemini forbids inventing how a segment ended", () => {
  const guide = editorialGuideForPrompt();
  assert.match(guide, /انتهى السجال\/انتهت الفقرة بـ…» بس لو المصدر قال كده/);
  assert.match(guide, /The confrontation ended after…/);
});

test("the guide asks to name who is back at full health when two wrestlers are in the sentence", () => {
  const guide = editorialGuideForPrompt();
  assert.match(guide, /بعد أن استعاد أوسبراي كامل جاهزيته/);
  assert.match(guide, /now that Ospreay is back at full health/);
});
