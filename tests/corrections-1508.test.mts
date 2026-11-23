import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1508: «وضارب مثلا» (typo for «وضرب مثلا») in the Jonathan Coachman story, and a
// first-person quote that slipped into the third person: «أن أتأكد من أن كل نزال يخوضه» (Speedball).
test("«وضرب مثلا» and first-person «كل نزال أخوضه»", () => {
  assert.equal(applyCorrections("وضارب مثلا بشارلوت فلير"), "وضرب مثلا بشارلوت فلير");
  assert.equal(applyCorrections("وأن أتأكد من أن كل نزال يخوضه سيكون مثاليا"), "وأن أتأكد من أن كل نزال أخوضه سيكون مثاليا");
  assert.equal(applyCorrections("قال إنه يريد أن يكون كل نزال يخوضه مثاليا"), "قال إنه يريد أن يكون كل نزال يخوضه مثاليا");
});
