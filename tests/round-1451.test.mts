import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCorrections, confusableSwappedFromEnglish } from "../scripts/news-qa.ts";

const glossary = JSON.parse(readFileSync(new URL("../scripts/wrestler-names.json", import.meta.url), "utf8"));

test("#1451: Ash By Elegance written where the English says M By Elegance is blocked", () => {
  const en = "The Personal Concierge previously performed as part of The Elegance Brand stable, which featured Ash by Elegance, Heather by Elegance, M by Elegance, and Mr. Elegance.";
  const bad = "كان ضمن فريق The Elegance Brand الذي ضم أش باي إليغانس، هيذر باي إليغانس، آش باي إليغانس، ومستر إليغانس.";
  assert.deepEqual(confusableSwappedFromEnglish(bad, en, glossary), ["M By Elegance"]);
  const good = "كان ضمن فريق The Elegance Brand الذي ضم آش باي إليغانس وهيذر باي إليغانس وإم باي إليغانس ومستر إليغانس.";
  assert.deepEqual(confusableSwappedFromEnglish(good, en, glossary), []);
});

test("#1451: «بيور» with no Pure in the English is blocked", () => {
  const en = "The event will also feature additional title matches, as Athena defends the ROH Women's Championship against Hyan.";
  assert.deepEqual(confusableSwappedFromEnglish("إذ تدافع أثينا عن بطولة ROH بيور للسيدات أمام هايان.", en, glossary), ["Pure Championship"]);
  assert.deepEqual(confusableSwappedFromEnglish("إذ تدافع أثينا عن بطولة ROH العالمية للسيدات أمام هايان.", en, glossary), []);
  assert.deepEqual(confusableSwappedFromEnglish("بطولة ROH بيور للسيدات.", en.replace("Women's Championship", "Women's Pure Championship"), glossary), []);
});

test("#1451: spellings fixed by corrections", () => {
  assert.equal(applyCorrections("ابتعدت أش باي إليغانس وسافر إلى مينيسابوليس"), "ابتعدت آش باي إليغانس وسافر إلى مينيابوليس");
});
