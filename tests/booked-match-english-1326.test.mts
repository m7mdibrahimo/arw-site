import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Samoa Joe / Jack Perry (INCIDENTS #1326): the source said "the two scheduled to face each other on Dynamite" and the
// English edition softened it to "expected to continue their storyline". The English rules keep a booked match booked.
test("English rules keep a booked match as a booked match", () => {
  const src = fs.readFileSync("scripts/english-edition.ts", "utf8");
  assert.match(src, /A match the source says is booked stays a booked match/);
  assert.match(src, /never softened to "expected to continue their storyline/);
});

test("the Samoa Joe story says the Dynamite match is scheduled", () => {
  // Stories older than 30 days are deleted (INCIDENTS #1481) and content/news-en is gone (#1480): a check on one story runs only while it exists.
  if (!fs.existsSync("content/news-en")) return;
  const f = fs.readdirSync("content/news-en").find(n => n.startsWith("20261115155616-original-plans-for-samoa-joe"));
  if (!f) return;
  const body = fs.readFileSync(`content/news-en/${f}`, "utf8");
  assert.match(body, /scheduled to face each other on AEW Dynamite/);
  assert.doesNotMatch(body, /continue their storyline/);
});
