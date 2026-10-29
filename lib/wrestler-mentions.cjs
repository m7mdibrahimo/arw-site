// A news story about «ماكس كاستر» or «المصارع باك» is the page Google shows for that name, but the head
// said nothing about who the story is about: only the headline carried the name. Search Console showed
// such name queries on positions 10-11 (round 2026-10-27). The glossary (scripts/wrestler-names.json) has
// the Arabic and English spelling of every name, so the story's NewsArticle now lists the people its
// headline names as `mentions` — head only, nothing on the page changes.
//
// Only people: the same file also holds championships, promotions, shows and teams, and marking a title
// or an event as a Person would be wrong. A person's English name is one to four capitalised words
// («Sami Zayn», «AJ Styles», «PAC») — an event reads «Money in the Bank», «Bound for Glory» with a
// lowercase small word, and a title carries a word from NOT_A_PERSON. A name must be written whole in the
// headline (no «سيث» inside «سيث رولينز»).
const fs = require("fs");
const path = require("path");

const NOT_A_PERSON = /\b(Championship|Championships|Title|Titles|Tournament|Cup|League|Award|Awards|Show|Event|Match|Team|Teams|Tag|Hall|Fame|Classic|Rumble|Mania|Slam|Bash|Draft|Network|Wrestling|Promotion|Company|Group|Faction|Stable|Brand|Division|Rules|Night|Champion|Champions)\b/i;
const NOT_A_PERSON_AR = /(بطولة|بطولات|كأس|دوري|جائزة|عرض|حدث|نزال|فريق|فرق|اتحاد|شركة|مجموعة|تحالف|قاعة|شهرة|تصفيات|نسخة)/;
const ORG = /^(WWE|AEW|TNA|ROH|NJPW|CMLL|AAA|MLW|UFC|NXT|RAW|SmackDown|Dynamite|Collision|Rampage|iMPACT|EVOLVE|GCW|PROGRESS|Stardom|NOAH|AJPW|TJPW|RevPro|PWG|NWA|Bound|All|Money|Crown|Summer|Royal|Survivor|Wrestle)\b/;
const PARTICLES = new Set(["de", "del", "van", "von", "la", "le", "dos", "bin", "al", "el", "the", "da"]);

/** A person's name: 1-4 words, each capitalised, no lowercase small word (an event has one). */
function looksLikePerson(en) {
  const words = en.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every((w, i) => {
    if (PARTICLES.has(w.toLowerCase()) && i > 0) return true;
    return /^[A-Z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w) || /^[A-Z.]+$/.test(w);
  });
}

let cache = null;
/** Every person in the glossary as { en, ar }, longest Arabic name first. */
function people(glossaryPath = path.join(__dirname, "..", "scripts", "wrestler-names.json")) {
  if (cache && cache.path === glossaryPath) return cache.list;
  let list = [];
  try {
    const raw = JSON.parse(fs.readFileSync(glossaryPath, "utf8"));
    list = Object.entries(raw)
      .filter(([en, ar]) => typeof ar === "string" && typeof en === "string")
      .filter(([, ar]) => /[\u0621-\u064A]/.test(ar) && ar.length >= 3 && ar.length <= 40)
      .filter(([en, ar]) => !NOT_A_PERSON.test(en) && !NOT_A_PERSON_AR.test(ar) && !ORG.test(en) && !/^\d/.test(en))
      // a faction or team reads «The Demand», «ذا ديماند» — not a person in the structured data
      .filter(([en, ar]) => !/^The\s/.test(en) && !/^ذا\s/.test(ar))
      .filter(([en]) => looksLikePerson(en))
      .map(([en, ar]) => ({ en, ar }))
      .sort((a, b) => b.ar.length - a.ar.length);
  } catch {
    list = [];
  }
  cache = { path: glossaryPath, list };
  return list;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The people a headline names, for the story's structured data (max `limit`, longest name first).
 * @param {string} text  the story's headline
 * @param {number} limit how many names the headline may give (the tags add at most two more)
 * @param {string[]} tags the story's tags: a tag that is a person's whole Arabic name is listed after the headline's
 * @returns {{name: string, en: string}[]}
 */
function personMentions(text, limit = 4, tags = []) {
  const t = String(text || "");
  if (!t) return [];
  const out = [];
  const taken = [];
  // the headline's people first, then the people the story is tagged with: the Max Caster story named Anthony
  // Bowens and Moose only in its tags, and its NewsArticle listed Caster alone (Search Console: «ماكس كاستر» on
  // position 11.1, round 2026-10-29). A tag must be the person's whole name, so a tag like «عروض WWE» adds nobody.
  const tagNames = new Set((Array.isArray(tags) ? tags : []).map((x) => String(x || "").trim()).filter(Boolean));
  for (const p of people()) {
    if (out.length >= limit) break;
    // the Arabic name written whole: no Arabic letter glued on either side — but the conjunction «و/ف»
    // is glued to the name («تافيون هايتس ومايلز بورن»), so it may sit right before it, as long as the
    // character before the conjunction is not an Arabic letter. Without this, every second name of a
    // headline was missing from `mentions` (main page of the story left Tavion Heights alone).
    const re = new RegExp(`(^|[^\\u0621-\\u064A])[وف]?${escapeRe(p.ar)}(?![\\u0621-\\u064A])`);
    if (!re.test(t)) continue;
    // a name already covered by a longer one is not a second person
    if (taken.some((n) => n.includes(p.ar) || p.ar.includes(n))) continue;
    taken.push(p.ar);
    out.push({ name: p.ar, en: p.en });
  }
  for (const p of people()) {
    if (out.length >= limit + 2) break;
    if (!tagNames.has(p.ar) || taken.some((n) => n.includes(p.ar) || p.ar.includes(n))) continue;
    taken.push(p.ar);
    out.push({ name: p.ar, en: p.en });
  }
  return out;
}

/**
 * The people an English headline or its tags name, for the English story's structured data — the same
 * `mentions` the Arabic story has, in English (Search Console showed the English pages of name stories
 * outside the first results, e.g. «liv morgan boy meets world» on position 8.9 with 778 impressions,
 * and the English NewsArticle listed nobody). Matched against the glossary only, so a chance
 * capitalised phrase is never marked as a person.
 * @param {string} text  the English headline and tags
 * @param {number} limit how many names to list
 * @returns {{name: string, ar: string}[]}
 */
function englishPersonMentions(text, limit = 4) {
  const t = String(text || "");
  if (!t) return [];
  const out = [];
  const taken = [];
  // longest English name first: «Seth Rollins» before «Rollins», «CM Punk» before «Punk»
  const list = people().slice().sort((a, b) => b.en.length - a.en.length);
  for (const p of list) {
    if (out.length >= limit) break;
    if (p.en.length < 3) continue;
    const re = new RegExp(`(^|[^A-Za-z])${escapeRe(p.en)}(?![A-Za-z])`);
    if (!re.test(t)) continue;
    if (taken.some((n) => n.includes(p.en) || p.en.includes(n))) continue;
    taken.push(p.en);
    out.push({ name: p.en, ar: p.ar });
  }
  return out;
}

/**
 * What an English story is about besides its people: the story's own tags that its headline names
 * («Boy Meets World» in «Liv Morgan Calls Cory Matthews Toxic After Rewatching Boy Meets World»).
 * Google showed that page on position 8.9 for «liv morgan boy meets world» (778 impressions, round
 * 2026-10-29) while its structured data only knew Liv Morgan. Promotion names alone («WWE») and the
 * people already in `mentions` are left out. Head only.
 */
function englishTopics(headline, tags, limit = 3) {
  const title = ` ${String(headline || "").toLowerCase().replace(/[^a-z0-9'&.-]+/g, " ")} `;
  const persons = new Set(englishPersonMentions(headline).map((m) => m.name.toLowerCase()));
  const out = [];
  for (const raw of tags || []) {
    const t = String(raw || "").trim();
    const key = t.toLowerCase();
    if (!t || /^[A-Z0-9]{2,5}$/.test(t) || persons.has(key) || out.some((o) => o.toLowerCase() === key)) continue;
    if (!title.includes(` ${key.replace(/[^a-z0-9'&.-]+/g, " ")} `)) continue;
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { personMentions, englishPersonMentions, englishTopics, people };
