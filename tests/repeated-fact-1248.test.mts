import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, findRepeatedFact } from "../scripts/news-qa.ts";
import { cleanSpokenFillers, garbledSpeech } from "../scripts/english-edition.ts";
import { readFileSync } from "node:fs";

// INCIDENTS #1248: Carlito story said the same dated fact twice in one sentence; Rosser story wrote «ينموون»;
// the English Carlito quote kept the transcript's stammer («not with not with Brock», «Did Brock Brock didn't»).
test("a dated fact written twice in one sentence is caught", () => {
  const line = "يذكر أن رينز هزم أندرتيكر لاحقا في عرض WrestleMania 33 عام 2017، لكن السلسلة كانت قد انتهت بالفعل، ورومان رينز هزم أندرتيكر في WrestleMania 33 عام 2017.";
  assert.ok(findRepeatedFact(line));
  const issues = checkArticle("كارليتو: WWE أهدرت سلسلة انتصارات أندرتيكر", "كارليتو تحدث عن السلسلة في بودكاست جديد وقال رأيه بصراحة كبيرة.\n\n" + line);
  assert.ok(issues.some((i: any) => i.code === "repeated_phrase"));
});

test("lists of different titles or counts are not a repeated fact", () => {
  assert.equal(findRepeatedFact("تتويجه ببطولة Open the Dream Gate مرة واحدة، وبطولة Open the Brave Gate مرة واحدة، وبطولة Open the Twin Gate مرة واحدة."), null);
  assert.equal(findRepeatedFact("دفاع يوتا تسوجي عن بطولة العالم للوزن الثقيل أمام هيرووكي غوتو، ودفاع غاب كيد عن بطولة العالم للوزن الثقيل أمام دريلا مولوني."), null);
  assert.equal(findRepeatedFact("يذكر أن رينز هزم أندرتيكر لاحقا في عرض WrestleMania 33 عام 2017، لكن السلسلة كانت قد انتهت بالفعل."), null);
});

test("«ينموون» and its kind are corrected", () => {
  const c = JSON.parse(readFileSync(new URL("../editorial/corrections.json", import.meta.url), "utf8")).corrections;
  assert.ok(c.some((x: any) => x.wrong === "ينموون" && x.right === "ينمون"));
});

test("a stammered quote is cleaned and a leftover false start is flagged", () => {
  assert.equal(cleanSpokenFillers("It should have ended with Roman, not with not with Brock."), "It should have ended with Roman, not with Brock.");
  assert.equal(cleanSpokenFillers("Did Brock Brock didn't need it."), "Did Brock didn't need it.");
  assert.ok(garbledSpeech('> "What did it really do for Brock? Did Brock Brock didn\'t need it."'));
  // real doubles stay
  assert.equal(cleanSpokenFillers("it got bigger and bigger and better"), "it got bigger and bigger and better");
  assert.equal(cleanSpokenFillers("Kelly Kelly and Bang Bang Scissors Gang"), "Kelly Kelly and Bang Bang Scissors Gang");
});
