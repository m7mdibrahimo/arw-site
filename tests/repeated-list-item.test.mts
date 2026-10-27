import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dropRepeatedListItem, autoFix, applyCorrections } from "../scripts/news-qa.ts";
import { fixEnglishNames } from "../scripts/english-edition.ts";

// INCIDENTS #892: the George Iceman story listed the Elegance Brand members twice, in Arabic and in English.
test("a name repeated in the same list is dropped (Arabic and English)", () => {
  const ar = "ليصبح المتحدث الرسمي باسم فريق «Elegance Brand» الذي يضم أيضا هيذر باي إليغانس وإم باي إليغانس ومستر إليغانس، وإم باي إليغانس، ومستر إليغانس. ورغم ذلك خاض أول نزال له.";
  assert.equal(autoFix(ar), "ليصبح المتحدث الرسمي باسم فريق «Elegance Brand» الذي يضم أيضا هيذر باي إليغانس وإم باي إليغانس ومستر إليغانس. ورغم ذلك خاض أول نزال له.");
  const en = "Iceman has been a staple of TNA television, particularly as the Personal Concierge for the Elegance Brand, which includes Ash By Elegance, Heather By Elegance, Ash By Elegance, and Mr. Elegance. Beyond his role.";
  assert.equal(fixEnglishNames(en), "Iceman has been a staple of TNA television, particularly as the Personal Concierge for the Elegance Brand, which includes Ash By Elegance, Heather By Elegance, and Mr. Elegance. Beyond his role.");
});

test("names said twice on purpose, quotes and numbers are left alone", () => {
  for (const s of [
    "فاز سامي زين على جيفون إيفانز، وخسر جيفون إيفانز لاحقا.",
    "التقى سي ام بانك مع سيث رولينز، وتحدث سيث رولينز عن ذلك.",
    "«نظرت إلى أوبا وقلت له: ضع قدمك علي، لقد هزمتني، ضع قدمك علي»",
    "\"He just kept pushing me, pushing me, and then I came back.\"",
    "WWE NXT drew 532,000 viewers, while AEW Dynamite drew 495,000 viewers.",
    "He beat Seth Rollins, CM Punk and Sheamus.",
  ]) assert.equal(dropRepeatedListItem(s), s);
});

test("no published story carries a repeated list item", () => {
  const bad: string[] = [];
  for (const dir of ["content/news", "content/news-en"]) for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".md"))) {
    const t = fs.readFileSync(`${dir}/${f}`, "utf-8");
    const body = t.slice(t.indexOf("\n---", 4) + 4);
    if (dropRepeatedListItem(body) !== body) bad.push(`${dir}/${f}`);
  }
  assert.deepEqual(bad, []);
});

// INCIDENTS #893: «لا يجدون غضاضة» was added to corrections.json (#883) but the story that had it stayed live.
// A correction is only done when the recent stories it matches are fixed too.
test("stories of the last 4 days carry nothing a correction would change", () => {
  const files = fs.readdirSync("content/news").filter(f => /^\d{14}-.*\.md$/.test(f)).sort();
  const newest = files[files.length - 1].slice(0, 8);
  const since = new Date(Date.UTC(+newest.slice(0, 4), +newest.slice(4, 6) - 1, +newest.slice(6, 8) - 4)).toISOString().slice(0, 10).replace(/-/g, "");
  const bad = files.filter(f => f.slice(0, 8) >= since).filter(f => {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8");
    const body = t.slice(t.indexOf("\n---", 4) + 4);
    return applyCorrections(body) !== body;
  });
  assert.deepEqual(bad, []);
});

test("the round's corrections: «ستيفن رولينز», «عدواته», «إنديانا بوليس»", () => {
  assert.equal(applyCorrections("مثل سي ام بانك وشيماس وستيفن رولينز"), "مثل سي ام بانك وشيماس وسيث رولينز");
  assert.equal(applyCorrections("خلال عدواته مع إلياس"), "خلال عداوته مع إلياس");
  assert.equal(applyCorrections("حضر عرض Royal Rumble في إنديانا بوليس"), "حضر عرض Royal Rumble في إنديانابوليس");
});
