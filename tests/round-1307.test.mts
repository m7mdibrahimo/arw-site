import { test } from "node:test";
import assert from "node:assert/strict";
import { claimNotInSource } from "../scripts/news-qa.ts";

// INCIDENTS #1307: Lars Sullivan / Brody King — «F*** ICE» chants written as anti-immigration chants
const SRC = "King has found himself getting plenty of attention outside the usual wrestling bubble this year because of his opposition to ICE. That has spilled directly into AEW shows, where crowds have repeatedly broken into loud F*** ICE chants during his appearances. The reaction became especially noticeable at AEW Grand Slam Australia on February 14.";

test("anti-ICE chants written as «مناهضة للهجرة» are blocked", () => {
  const ar = "حيث هتفت الجماهير مرارا بشعارات مناهضة للهجرة خلال عرض AEW Grand Slam Australia";
  assert.ok(claimNotInSource(ar, SRC).some(l => l.includes("ICE")));
  assert.ok(claimNotInSource("Fans repeatedly chanted anti-immigration slogans during the show.", SRC, "en").some(l => l.includes("ICE")));
});

test("the agency named right passes", () => {
  assert.deepEqual(claimNotInSource("هتفت الجماهير بشعارات ضد دائرة الهجرة والجمارك ومواقفه المناهضة لدائرة الهجرة", SRC), []);
  assert.deepEqual(claimNotInSource("crowds broke into anti-ICE chants", SRC, "en"), []);
});

test("a source that really says anti-immigration passes", () => {
  const src = SRC + " Some fans answered with anti-immigration signs, which drew criticism online from many viewers.";
  assert.deepEqual(claimNotInSource("رفع بعض المشجعين لافتات مناهضة للهجرة", src), []);
});
