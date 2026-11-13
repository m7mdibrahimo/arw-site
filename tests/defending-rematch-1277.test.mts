import { test } from "node:test";
import assert from "node:assert/strict";
import { fixEnglishNames } from "../scripts/english-edition.ts";

test("#1277: a rematch is never «defended» — it is a rematch between the two", () => {
  assert.equal(
    fixEnglishNames("The main event featured Nic Nemeth defending his World Championship rematch against Elijah in a match booked on the fly."),
    "The main event featured a World Championship rematch between Nic Nemeth and Elijah in a match booked on the fly.",
  );
});

test("#1277: defending a title stays as written", () => {
  const s = "Nic Nemeth defended his World Championship against Elijah in a rematch.";
  assert.equal(fixEnglishNames(s), s);
});
