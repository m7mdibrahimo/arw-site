import { test } from "node:test";
import assert from "node:assert/strict";
import { isReturnOrDebutStory } from "../scripts/fightful-watcher.ts";

test("a wished-for return is not a return (INCIDENTS #1484)", () => {
  assert.equal(isReturnOrDebutStory("Charlotte Flair On Women's Royal Rumble 2027: I Can't Imagine What Faces Of Those Grown Ass Men And Women Will Be If Bianca Belair Or Naomi Returned"), false);
  assert.equal(isReturnOrDebutStory("CM Punk Wonders What Would Happen If The Rock Came Back"), false);
});

test("a real return is still caught", () => {
  assert.equal(isReturnOrDebutStory("Bianca Belair Returns On WWE Raw"), true);
  assert.equal(isReturnOrDebutStory("Naomi Returned At Survivor Series"), true);
});
