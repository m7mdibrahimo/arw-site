import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #453: corrections.json turned «شيلوه هيل» into «شيلو هيل» while the names glossary says «شايلو هيل»,
// so the two rules pulled stories in opposite directions. A correction must never rewrite a name into a spelling
// the glossary does not have, nor rewrite a glossary spelling into something else.
test("corrections never contradict the names glossary", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  const spellings = new Set(Object.values(glossary).map(v => v.replace(/\s*\(.*\)\s*$/, "").trim()));
  const bad: string[] = [];
  for (const c of corrections) {
    if (spellings.has(c.wrong.trim()) && c.right !== c.wrong) bad.push(`«${c.wrong}» is a glossary spelling but is rewritten to «${c.right}»`);
  }
  assert.deepEqual(bad, []);
  assert.equal(glossary["KAIRI"], "كايري");
});

// INCIDENTS #489: «كانيلس» reached two stories while the glossary spelling is «كانيليس».
test("Kanellis is spelled as the glossary says, in the glossary, the corrections and every story", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Maria Kanellis"], "ماريا كانيليس");
  assert.equal(glossary["Mike Kanellis"], "مايك كانيليس");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "كانيلس" && c.right === "كانيليس"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "").includes("كانيلس"));
  assert.deepEqual(bad, []);
});

// The glossary said «آش باي إيليجانس» while corrections.json and 39 published stories said «آش باي إليغانس»,
// so Gemini got two spellings for one wrestler and a story used the glossary's (2026-10-27).
test("Ash By Elegance has one spelling in the glossary, the corrections and every story", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Ash By Elegance"], "آش باي إليغانس");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "آش باي إيليجانس" && c.right === "آش باي إليغانس"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("إيليجانس"));
  assert.deepEqual(bad, []);
});

// INCIDENTS #883: show and recap front matter never passes through applyCorrections, so 13 RAW pages carried the tag
// «رومان راينز» while the glossary (and every story) says «رومان رينز». A tag that a correction would rewrite is a
// misspelling Google cannot connect to the wrestler's page.
test("no show, recap or nostalgia tag is a spelling corrections.json would rewrite", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string; regex?: boolean }[];
  // A rule whose right side has no Arabic letters («كراون جول» → «Crown Jewel») is the news rule «show names stay in
  // English», not a misspelling: a show page's Arabic program-name tag (typed by the owner in the panel) is how Arabic
  // visitors search it (INCIDENTS #1131).
  const wrongOnes = corrections.filter(c => !c.regex && c.right !== c.wrong && /[\u0621-\u064A]/.test(c.wrong) && /[\u0621-\u064A]/.test(c.right));
  const bad: string[] = [];
  for (const dir of ["content/shows", "content/nostalgia"]) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".md"))) {
      const text = fs.readFileSync(`${dir}/${f}`, "utf-8");
      const tags = ((text.match(/^tags:\n((?:  - .*\n)+)/m) || ["", ""])[1] || "").split("\n").map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
      for (const tag of tags) for (const c of wrongOnes) if (tag === c.wrong) bad.push(`${dir}/${f}: «${c.wrong}» (الصح «${c.right}»)`);
    }
  }
  assert.deepEqual(bad, []);
  // the glossary spelling is the one the show pages carry now
  assert.equal((JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>)["Roman Reigns"], "رومان رينز");
  assert.ok(!fs.readFileSync("content/shows/20261027125824-wwe-raw-26-10-2026.md", "utf-8").includes("رومان راينز"));
});

// INCIDENTS #1121: Diamond Dallas Page was written 4 different ways and Chelsea Green «تشلسي» in published stories.
test("Diamond Dallas Page and Chelsea Green have one spelling in the glossary, the corrections and every story", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Diamond Dallas Page"], "دايموند دالاس بيج");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "دياموند دالاس بايج" && c.right === "دايموند دالاس بيج"));
  assert.ok(corrections.some(c => c.wrong === "تشلسي غرين" && c.right === "تشيلسي غرين"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /د[يا]+موند دالاس ب[يا]+ج|تشلسي غرين/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|source_url):.*$/gm, "").replace(/دايموند دالاس بيج/g, "")) );
  assert.deepEqual(bad, []);
});

// INCIDENTS #1123: «الجريمة» for surgery, «بشكل معجزة», «الكافى», «إبان», «مسارها مغايرا», «ارتباط الرموز», «أو تونغا».
test("known broken Arabic phrases are corrected and absent from every story", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  const wrong = ["الكافى", "إبان", "بشكل معجزة", "الجريمة منحت", "مسارها مغايرا", "ارتباط الرموز", "أو تونغا"];
  for (const w of wrong) assert.ok(corrections.some(c => c.wrong === w), `missing correction for ${w}`);
  const bad: string[] = [];
  for (const f of fs.readdirSync("content/news").filter(f => f.endsWith(".md"))) {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "");
    for (const w of wrong) if (new RegExp(`(?<![\\u0600-\\u06FF])${w}(?![\\u0600-\\u06FF])`).test(t)) bad.push(`${f}: ${w}`);
  }
  assert.deepEqual(bad, []);
});

// INCIDENTS #1130: corrections.json turned every spelling of «إم باي إليغانس» (M By Elegance, the Knockouts TV champion)
// into «آش باي إليغانس» — another wrestler — and ENGLISH_FIXES did the same in English, so 30 stories gave the title
// to the wrong woman. A misspelling's correction keeps the same name: when the «wrong» side, without vowels and
// hamzas, is a glossary name, the «right» side must be that same glossary name — never someone else's.
test("a correction never turns one glossary name into another wrestler's name", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string; regex?: boolean }[];
  const skeleton = (s: string) => s.replace(/[ً-ْ]/g, "").replace(/[اأإآويىءئؤة]/g, "").replace(/\s+/g, " ").trim();
  const names = new Map<string, string[]>();
  for (const v of Object.values(glossary)) {
    const k = skeleton(v);
    if (k.length >= 5) names.set(k, [...(names.get(k) || []), v]);
  }
  const bad = corrections.filter(c => !c.regex).flatMap(c => {
    const same = names.get(skeleton(c.wrong));
    return same && !same.includes(c.right) ? [`«${c.wrong}» → «${c.right}» but the glossary name is «${same.join("/")}»`] : [];
  });
  assert.deepEqual(bad, []);
  assert.equal(glossary["M By Elegance"], "إم باي إليغانس");
});

test("no English fix rewrites a wrestler the glossary knows into another name", async () => {
  const { ENGLISH_FIXES } = await import("../scripts/english-edition.ts");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  const bad: string[] = [];
  for (const name of Object.keys(glossary)) {
    if (!/^[A-Z][\w.'-]*(?: [A-Z][\w.'-]*)+$/.test(name)) continue;
    for (const [re, to] of ENGLISH_FIXES) {
      re.lastIndex = 0;
      const out = name.replace(re, to as string);
      re.lastIndex = 0;
      const plain = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); // «Mone» → «Moné» is the same name
      if (out !== name && plain(out) !== plain(name)) bad.push(`${name} → ${out} (${re})`);
    }
  }
  assert.deepEqual(bad, []);
});
