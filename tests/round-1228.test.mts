import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCorrections, stableSwappedFromEnglish } from "../scripts/news-qa.ts";

const glossary = JSON.parse(readFileSync("scripts/wrestler-names.json", "utf8"));
const en = "Zilla Fatu's promo was interrupted by a brawl involving DarkState, BirthRight, and Los Perros del Mal, which required security to intervene as the show concluded.";

test("#1228: a results report that writes «ذا 946» where the English says DarkState is caught", () => {
  const bad = "شهد ختام العرض مشاجرة بين فرق ذا 946 وبيرثرايت ولوس بيروس ديل مال.";
  assert.deepEqual(stableSwappedFromEnglish(bad, en, glossary), { arabicOnly: ["The 946"], englishOnly: ["DarkState"] });
});

test("#1228: the right stables pass, and a story the English simply shortened is not a swap", () => {
  assert.equal(stableSwappedFromEnglish("شهد ختام العرض مشاجرة بين فرق دارك ستيت وبيرثرايت ولوس بيروس ديل مال.", en, glossary), null);
  assert.equal(stableSwappedFromEnglish("هاجم فريق ذا 946 المصارع في نهاية العرض.", "He was attacked at the end of the show by a group of wrestlers and left the ring holding his arm.", glossary), null);
});

test("#1228: ordinary English like «The Man» never counts as a stable", () => {
  assert.equal(stableSwappedFromEnglish("هاجم فريق ذا 946 المصارع في نهاية العرض.", "The Man said the whole world is watching this show and he will not back down from anybody.", glossary), null);
});

test("#1228: glossary and corrections carry DarkState and BirthRight", () => {
  assert.equal(glossary.DarkState, "دارك ستيت");
  assert.equal(applyCorrections("مشاجرة بين ذا بيرثرايت ودارك ستيت"), "مشاجرة بين بيرثرايت ودارك ستيت");
});
