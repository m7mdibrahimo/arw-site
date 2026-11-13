import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// «أعلن اتحاد هاوس أوف جلوري»: promotion and event names stay in English — the names glossary
// itself turned «House of Glory», «Lucha Libre AAA Worldwide», «World Tag League»… into Arabic letters (INCIDENTS #1270)
test("promotion and event names are written in English", () => {
  const out = applyCorrections("أعلن اتحاد هاوس أوف جلوري، واتحاد لوتشا ليبري AAA وورلد وايد، وبطولة وورلد تاج ليج، وجولة ريسلينج دونتاكو، وتغيير في بروفيشنال فايترز ليج");
  assert.ok(!/هاوس|لوتشا ليبري|وورلد|دونتاكو|فايترز/.test(out), out);
  assert.match(out, /اتحاد House of Glory/);
  assert.match(out, /اتحاد AAA/);
  assert.match(out, /World Tag League/);
  assert.match(out, /Wrestling Dontaku/);
  assert.match(out, /PFL/);
});

test("«جينفر» and «كاتي فوربس» get the glossary spelling", () => {
  const out = applyCorrections("مع كاتي فوربس وجينفر بارلو");
  assert.match(out, /كاتي فوربز/);
  assert.match(out, /جينيفر بارلو/);
});

test("the names glossary never turns a promotion or event name into Arabic letters", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8")) as Record<string, string>;
  const english = ["House of Glory", "Lucha Libre AAA Worldwide", "Professional Fighters League", "Rizin Fighting Federation", "Wrestling Dontaku", "World Tag League", "Revolution Pro Wrestling", "Game Changer Wrestling", "Major League Wrestling", "Ring of Honor"];
  const bad = english.filter((k) => /[؀-ۿ]/.test(g[k] ?? ""));
  assert.deepEqual(bad, []);
  // any glossary key that is clearly a promotion («… Wrestling», «… League», «… Federation») must stay English
  const promo = Object.entries(g).filter(([k, v]) => /\b(Pro Wrestling|Championship Wrestling|Wrestling Alliance|Wrestling Federation|Fighting Federation|Fighters League|of Glory|AAA Worldwide)\b/.test(k) && /[؀-ۿ]/.test(v) && !/CMLL/.test(v));
  assert.deepEqual(promo, []);
});

// /library/wwe-crown-jewel/ at 5.1–5.9 for «تحميل/مشاهدة عرض كراون جول 2026»: a few-show library page's head title says
// «مشاهدة وتحميل» after the collection name (still the collection's, #862), and its alternateName says each name once (INCIDENTS #1270)
test("a few-show library page's head title carries «مشاهدة وتحميل» and its alternateName has no repeats", () => {
  const njk = fs.readFileSync("pages/library-program.njk", "utf8");
  assert.ok(njk.includes("— مشاهدة وتحميل {{ lp.prog.name }}{% else %}"));
  assert.ok(njk.includes("| uniqueNames %}"));
  assert.match(fs.readFileSync("eleventy.config.js", "utf8"), /addFilter\("uniqueNames"/);
});
