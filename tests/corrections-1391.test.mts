import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
import { collapseRepeatedEnglishWords, normalizeEnglishTitle } from "../scripts/english-edition.ts";

// INCIDENTS #1391: «خسته», «حملها في طفل», «شارك في تحدي عبر تيك توك» reached the site;
// the English edition cut the song «'Big Michael Michael'» to «'Big Michael'» and wrote «Ash by Elegance».
test("Arabic slips of round #1391 are corrected; idafa «في تحدي الأبطال» stays", () => {
  assert.equal(applyCorrections("اللقب الذي خسته لصالح جوردان"), "اللقب الذي خسرته لصالح جوردان");
  assert.equal(applyCorrections("تعلن حملها في طفل ذكر"), "تعلن حملها بطفل ذكر");
  assert.equal(applyCorrections("وشارك في تحدي عبر تيك توك"), "وشارك في تحد عبر تيك توك");
  assert.equal(applyCorrections("فشل في تحدي البطلة"), "فشل في تحدي البطلة");
  assert.equal(applyCorrections("شارك في تحدي عبرة"), "شارك في تحدي عبرة");
});

test("a double word inside single quotes is the song's own name and stays", () => {
  assert.equal(collapseRepeatedEnglishWords("his song 'Big Michael Michael,' which he sang"), "his song 'Big Michael Michael,' which he sang");
  assert.equal(collapseRepeatedEnglishWords("Janela's dog and Kevin Kevin Owens's title"), "Janela's dog and Kevin Owens's title");
});

test("«By» is part of the Elegance names in a headline", () => {
  assert.equal(normalizeEnglishTitle("Ash By Elegance Reveals She Is 32 Weeks Pregnant"), "Ash By Elegance Reveals She Is 32 Weeks Pregnant");
  assert.equal(normalizeEnglishTitle("Jordynne Grace Defeats Heather by Elegance"), "Jordynne Grace Defeats Heather By Elegance");
});
