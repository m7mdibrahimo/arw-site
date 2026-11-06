import { test } from "node:test";
import assert from "node:assert/strict";
import { findAdjacentRepeatedPhrase } from "../scripts/news-qa.ts";

// «في عام 2020، في عام 2020،» reached the site (Drew McIntyre story, INCIDENTS #1095): the year made the phrase "not all Arabic".
test("a phrase with a year written twice in a row is caught", () => {
  assert.ok(findAdjacentRepeatedPhrase("في عام 2020، في عام 2020، بدأ ماكنتاير حمل سيف"));
});
test("plain numbers lists are left alone", () => {
  assert.equal(findAdjacentRepeatedPhrase("فاز في 2020 2020 2020 مرات"), null);
});
