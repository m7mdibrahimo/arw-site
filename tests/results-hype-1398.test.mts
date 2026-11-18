// INCIDENTS #1398: a results report must not praise a match the source lists in one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInventedMatchHype } from "../scripts/fightful-watcher.ts";

test("hype adjectives are stripped from results reports", () => {
  const body = "التقت الثنائيات في نزال قوي جمع بين بيرسيفوني ورينا إيسيس.\n\n🏆 **الفائزات:** بيرسيفوني\n\nخاض فولكانو نزالا قويا ضد أكوما في مواجهة نارية وحماسية جدا.";
  const out = stripInventedMatchHype(body);
  assert.match(out, /في نزال جمع بين/);
  assert.match(out, /خاض فولكانو نزالا ضد أكوما في مواجهة\./);
  assert.doesNotMatch(out, /قوي|نارية|حماسية/);
});

test("quotes and non-results stories keep their words", () => {
  assert.equal(stripInventedMatchHype("قال إنه يريد نزالا قويا."), "قال إنه يريد نزالا قويا.");
  const q = "> \"سيكون نزالا قويا\"\n\n🏆 **الفائز:** فلان";
  assert.equal(stripInventedMatchHype(q), q);
});

test("words that only start like an adjective are untouched", () => {
  const b = "🏆 x\nفي نزال قويدر ومواجهة ناريمان";
  assert.equal(stripInventedMatchHype(b), b);
});

test("an adjective joined to another word by «و» is left alone", () => {
  const b = "🏆 x\nمواجهة قوية وسريعة شهدت لقطات";
  assert.equal(stripInventedMatchHype(b), b);
});
