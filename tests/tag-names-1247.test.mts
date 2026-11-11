import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1247: the Asuka/Fight Size story had the tag «ليوه روش» while its body said «ليو راش» (Lio Rush),
// wrote «مواجهة بين فريق باستا وذا برين ضد فريق…», and the English Carlito story's description ended «…seasoning compared.».
test("a name tag a letter or two off from the name the story uses takes the story's spelling (INCIDENTS #1247)", async () => {
  const { snapTagsToStoryNames } = await import("../scripts/news-qa");
  const glossary = { "Lio Rush": "ليو راش", "Asuka": "أسوكا", "Jey Uso": "جاي أوسو", "Jimmy Uso": "جيمي أوسو" };
  const body = "وتلقى المصارع ليو راش التهاني بمناسبة عيد ميلاده، وزارت أسوكا مقر SEGA.";
  assert.deepEqual(snapTagsToStoryNames(["أسوكا", "WWE NXT", "ليوه روش"], "أسوكا تزور مقر SEGA", body, glossary), ["أسوكا", "WWE NXT", "ليو راش"]);
  // a different approved name is never rewritten into the one the story uses
  assert.deepEqual(snapTagsToStoryNames(["جاي أوسو"], "", "جيمي أوسو يتحدث", glossary), ["جاي أوسو"]);
  // a topic tag far from every name stays
  assert.deepEqual(snapTagsToStoryNames(["المملكة المتحدة"], "", body, glossary), ["المملكة المتحدة"]);
});

test("«مواجهة بين A ضد B» loses the «بين» (INCIDENTS #1247)", async () => {
  const { autoFix } = await import("../scripts/news-qa");
  assert.equal(autoFix("سيشهد العرض مواجهة بين فريق Bustah & The Brain ضد فريق Tabarnak De Team."), "سيشهد العرض مواجهة فريق Bustah & The Brain ضد فريق Tabarnak De Team.");
  assert.equal(autoFix("حكمة في نزال بين لولا فايس ضد جايدا باركر."), "حكمة في نزال لولا فايس ضد جايدا باركر.");
  // «بين A و B» is right and stays
  assert.equal(autoFix("نزال بين لولا فايس وجايدا باركر."), "نزال بين لولا فايس وجايدا باركر.");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])(?:مواجهة|نزال|مباراة) بين [^.،؛\n]{3,60}? ضد /.test(fs.readFileSync(`content/news/${f}`, "utf-8").split("\n---\n").slice(1).join("\n")));
  assert.deepEqual(bad, []);
});

test("an English description never ends on «compared/prior/according» cut from its «to» (INCIDENTS #1247)", async () => {
  const { metaDescription } = await import("../lib/meta-description.cjs");
  const d = metaDescription("Carlito discussed his experiences in the United Kingdom, asserting that British cuisine suffers from a lack of sufficient flavor and seasoning compared to other foods. During an appearance on the podcast, he explained more.");
  assert.doesNotMatch(d, /\b(?:compared|prior|according)\.$/);
  const bad = fs.readdirSync("content/news-en").filter(f => f.endsWith(".md") && /^description: ".* (?:compared|according|prior|relative|owing)\."$/m.test(fs.readFileSync(`content/news-en/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
