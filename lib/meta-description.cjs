// The meta description is what a visitor reads under the title in Google. Cutting the text at a
// fixed length left it ending mid-sentence with «…» on 1,536 of 1,564 English stories (and the
// Arabic ones ended mid-word): Google rewrites such snippets and the click is lost. A description
// now always ends where a sentence (or at least a clause) ends. Head only — nothing on the page
// changes (INCIDENTS #862).
const SENTENCE_END = /[.!?؟]/;
// A full stop after a month, a common abbreviation or an initial is not the end of a sentence: «The
// performance took place on Oct. 25 at the Benchmark International Arena…» was cut at «on Oct.» and
// the snippet under the title read «…during a recent concert. The performance took place on Oct.»
// (INCIDENTS #869). The same cut hit «Nov.», «U.S.», «Wrestling Inc.», «Mr.», «vs.».
// Corporate forms too: «Following the acquisition of Warner Bros.» was a sentence end for the splitter, so
// the snippet under the title stopped half-way through the sentence (live 2026-10-28).
const ABBREVIATION_END = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|a\.m|p\.m|U\.S|U\.K|P\.S|Bros|Co|Corp|Inc|Ltd|Dept|Univ|Assn|Ave|Blvd|No|Vol|Fig|[A-Z])\.$/;

/** Adverbs a sentence reads the same without (English only; «reportedly/officially» change the meaning and stay). */
const FILLER = /\b(?:recently|completely|really|actually|truly|certainly|simply|totally|absolutely|entirely|definitely|genuinely) (?=[a-z])/g;

/** The text cut into sentences: a full stop counts only when it really ends one. */
function splitSentences(t) {
  const out = [];
  let start = 0;
  const re = /[.!?؟]+["»”']?\s+/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].trimEnd().length;
    const head = t.slice(start, end);
    if (ABBREVIATION_END.test(head)) continue;
    // a «?» or «.» inside a quoted title ("What's Your Story? With Steph McMahon") does not end the sentence
    if ((head.match(/"/g) || []).length % 2 === 1) continue;
    const next = t.slice(m.index + m[0].length);
    if (!next) break;
    // a sentence that continues with a lower-case word or a digit after a month is not over either
    if (!/^["«(“'(\[A-Zء-ي0-9٠-٩]/.test(next)) continue;
    out.push(head.trim());
    start = m.index + m[0].length;
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter(Boolean).map((s) => s + " ");
}

/**
 * The start of a clause that cannot stand alone as a sentence: a sentence made only of one («Prior to the
 * episode of NXT on The CW.») is a cut fragment, not a description (live 2026-10-27).
 */
const FRAGMENT_OPENER = /^(?:prior to|before|after|while|when|as|during|following|despite|because|since|if|although|though|according to|in order to|to|in|on|at|by|with|without|for|قبل|بعد|أثناء|عندما|بينما|وفقا|وفقاً|بحسب|حسب|من أجل|لأن|إذا|رغم|مع)\b/i;

/** «Continuing/Speaking/Having…» — an -ing word opening a sentence starts a clause, not a sentence. */
const PARTICIPLE_OPENER = /^[A-Z][a-z]{2,}ing\b/;

/** Where the last real sentence starts (the index after its full stop). «Bros.»/«Inc.» are not sentence
 *  ends, so a raw lastIndexOf(". ") landed inside the previous sentence and the fragment check below read
 *  «Discovery by Paramount» as the last sentence (live 2026-10-28). */
function lastSentenceStart(t) {
  const re = /[.!?؟]+["»”']?\s+/g;
  let start = 0;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBREVIATION_END.test(t.slice(0, end))) continue;
    start = m.index + m[0].length;
  }
  return start;
}

/**
 * @param {string} text  the story's lead (first paragraph of prose)
 * @returns {string} a description that ends at a sentence or clause boundary, never with «…»
 */
function metaDescription(text, limit = 158) {
  const t = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length <= limit) {
    const frag = /^(.{40,}[.!?])\s+(?:Prior to|Before|After|While|When|As|During|Following|Despite|Because|Since|If|Although|Though|According to)\s[^,.!?]*[.!]$/.exec(t);
    if (frag && t.slice(frag[1].length).trim().split(/\s+/).length <= 9) return frag[1];
    const s = t.replace(/[.،,;:\s]+$/, "");
    return s + (SENTENCE_END.test(s.slice(-1)) ? "" : ".");
  }
  // 1. as many whole sentences as fit — one very short first sentence alone («Yota Tsuji is set to appear
  //    for MLW.») is a useless snippet, so the next sentence joins it while it fits (at least ~70 letters)
  const sentences = splitSentences(t);
  let acc = "";
  for (const s of sentences) {
    if ((acc + s).trim().length > limit) break;
    acc += s;
  }
  acc = acc.trim();
  // the last whole sentence that fits can itself be a cut fragment («During the October 29 episode of TNA
  // iMPACT.», 2026-11-01): a short sentence opened by «During/After/Before…» with no comma has no clause of
  // its own, so it goes and the sentence before it ends the snippet
  const accSentences = splitSentences(acc).map((s) => s.trim());
  if (accSentences.length > 1) {
    const last = accSentences[accSentences.length - 1];
    if (/^(?:Prior to|Before|After|While|When|As|During|Following|Despite|Because|Since|If|Although|Though|According to)\s[^,]*$/.test(last) && last.split(/\s+/).length <= 9) acc = accSentences.slice(0, -1).join(" ");
  }
  if (acc.length >= 70) return acc;
  // 1b. a first sentence a little over the limit loses its filler adverbs before it is cut: «…recently revealed
  //     that rewatching Boy Meets World as an adult completely changed her view of the main character, Cory
  //     Matthews.» was cut at the comma and the snippet lost the name the query asked for (Liv Morgan story,
  //     778 searches at position 8.9, round 2026-10-30 00:15 UTC).
  const first = (sentences[0] || "").trim();
  const lean = first.replace(FILLER, "").replace(/\s{2,}/g, " ").trim();
  // (a filler-free sentence up to ~10 letters over the limit stays whole: «…a backyard trampoline shaped.» lost its object, 2026-11-01)
  if (lean !== first && lean.length <= limit + 10 && lean.length >= 70) return lean;
  // 2. the last clause boundary (comma, semicolon, colon, dash) that fits
  const head = t.slice(0, limit);
  const at = Math.max(head.lastIndexOf("، "), head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(" — "), head.lastIndexOf(" – "));
  let out = at >= 70 ? head.slice(0, at) : "";
  // A comma inside a list of names is not a clause end: «The Syx have been making waves in the TNA tag team
  // division, but Samuel Shaw.» was cut before «, Joseph Sawyer and Erick Redbeard recently took…» (round
  // 2026-10-30). The cut moves back to the comma before the list.
  for (let guard = 0; guard < 4 && out && /[A-Z][\w'’.-]*$/.test(out) && /^,\s+[A-Z]/.test(t.slice(out.length)); guard++) {
    const prev = out.lastIndexOf(", ");
    if (prev < 40) break;
    out = out.slice(0, prev);
  }
  const clauseCut = out !== ""; // a clause cut keeps its verb («…focused on improving»): only a word cut can hang
  // 3. last resort: the last whole word that fits — a dangling «in/at/of/the» is dropped first
  if (!out) {
    // «due/because/despite/than…» need what follows too: «…the death of PAC last month due.» (INCIDENTS #983).
    // A quantifier needs the noun after it: «…to poke fun at several.» said nothing (live 2026-10-27), so it
    // goes with the prepositions and articles.
    const DANGLING = /(?:^|\s)(?:following|in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via|several|many|some|most|each|every|these|those|such|various|numerous|few|another|due|because|despite|than|including|like|alongside|amid|toward|towards|upon|within|without|through|until|while|when|where|but|nor|if|whether|ahead|thanks|rather|instead|revealing|saying|stating|noting|explaining|adding|claiming|admitting|confirming|suggesting|stressing|insisting|hinting|stating|announcing|declaring|believing|feeling|thinking|hoping|knowing|will|would|could|last|sole|only|really|very|just|also|not)$/i;
    // A superlative needs its noun too: «…with providing the biggest.» for «the biggest break of his career»
    // (Sami Zayn story, INCIDENTS #935) — «the biggest/best/first…» goes with it.
    const SUPERLATIVE = /(?:^|\s)(?:the|a|an|his|her|their|its)\s+(?:biggest|greatest|largest|longest|highest|lowest|strongest|toughest|hardest|newest|latest|oldest|youngest|fastest|earliest|smallest|closest|wildest|craziest|proudest|happiest|funniest|scariest|darkest|hottest|first|last|most|least|best|worst|next|only|top)$/i;
    // «All In» is the name of an event: «…at AEW All In» is not a dangling «in» (live 2026-11-01)
    const ENDS_WITH_NAME = /\bAll In$/;
    let cut = head;
    for (let guard = 0; guard < 4 && DANGLING.test(cut) && !ENDS_WITH_NAME.test(cut); guard++) cut = cut.slice(0, cut.lastIndexOf(" "));
    const sp = cut.lastIndexOf(" ");
    out = cut.slice(0, sp >= 70 ? sp : cut.length);
    // Dropping the half word can leave a dangling word behind it («…last month due t» → «…last month due.»):
    // the same check runs again on what is left (INCIDENTS #983).
    for (let guard = 0; guard < 4 && DANGLING.test(out) && !ENDS_WITH_NAME.test(out) && out.lastIndexOf(" ") >= 70; guard++) out = out.slice(0, out.lastIndexOf(" "));
    // …it ends the description at the last «and» before it instead («…Sami Zayn reflected on his career.»)
    if (SUPERLATIVE.test(out) && out.lastIndexOf(" and ") >= 70) out = out.slice(0, out.lastIndexOf(" and "));
    // A word cut can land in the middle of a proper name («…will face Bron.»): a complete short
    // sentence above reads better than half a name under the title (INCIDENTS #869).
    const tail = out.split(/\s+/).pop() || "";
    const nextWord = t.slice(out.length).trimStart().split(/\s+/)[0] || "";
    if (/^[A-Z][A-Za-z'’-]+$/.test(tail) && /^[A-Z]/.test(nextWord)) {
      const first = (sentences[0] || "").trim();
      if (first.length >= 40 && first.length <= limit + 27) out = first;
      else {
        // the whole sentence is too long: the half name goes (and the word that introduced it) instead of
        // ending on «…groups like D-Generation.» (Royce Keys story, round 2026-11-03)
        let w = out.split(" ");
        while (w.length > 12 && /^[A-Z][\w'’-]*$/.test(w[w.length - 1])) w.pop();
        while (w.length > 12 && DANGLING.test(w.join(" "))) w.pop();
        out = w.join(" ");
      }
    }
    // A word cut can also stop inside a multi-word name whose second word is lower-case: «…paralysis he
    // suffered at a post-TNA Bound.» for «Bound for Glory» (live 2026-10-27). The rest of the name is gone,
    // so the cut moves back to the last preposition — «…paralysis he suffered.» — instead of half a name.
  }
  out = out.trim().replace(/[،,;:—-]+$/, "").trim();
  // A cut that leaves a new sentence with only a subordinate or prepositional clause («Prior to the October
  // 27th episode of WWE NXT on The CW.») says nothing under the title: the clause it depends on was cut away
  // (live 2026-10-27). The clause is completed from the story when it still fits, otherwise it goes and the
  // sentence before it ends the snippet.
  const openerAt = lastSentenceStart(out);
  const openerTail = openerAt > 0 ? out.slice(openerAt).trim() : out.trim();
  // A participle phrase cut at its comma is a fragment too: «…their first gold in WWE. Continuing their recent
  // success.» (Michin and B-Fab story, INCIDENTS #959).
  // A clause cut inside «revealed that when he was working at Studio 54 in New York City» keeps the «when»
  // clause and loses the main one after its comma: the snippet stopped with nothing said (Paul Heyman story,
  // round 2026-10-29). A «that/how/why + when/if/while…» left open at the end is completed the same way.
  const openSubordinate = clauseCut && /\b(?:that|how|why)\s+(?:when|while|if|after|before|because|although|though|since|once|until|as)\b[^,;:]*$/i.test(openerTail);
  // A clause cut can also stop after a name and its appositive, before the verb: «…an upcoming bout. TEAM
  // TENSHIN, the group backing the former MMA fighter, kickboxer, and active boxer.» — the main verb («is
  // staging an event») came after the last comma (Tenshin Nasukawa story, INCIDENTS #980).
  const appositiveCut = clauseCut && /^(?:[A-Z][\w'’.&-]*\s?)+,\s+(?:the|a|an|his|her|their|its)\s/.test(openerTail) && /^[a-z]/.test(t.slice(out.length).replace(/^[,;:\s]+/, ""));
  // A clause cut that stops right before the main verb leaves a subject with no predicate: «The mother of NWA
  // champion Bryan Idol, Antoinette Nazar.» (cut before «, took matters…») and «…as Mike Kitlas, the promotion's
  // Senior Director of Live Events.» (cut before «, has departed…»). The next whole sentence is used instead
  // (INCIDENTS #1008).
  const restAfterCut = t.slice(out.length).replace(/^[,;:\s]+/, "");
  if (clauseCut && /^(?:has|have|had|is|are|was|were|will|would|can|could|did|does|took|made|said|says|told|shared|revealed|confirmed|announced|signed|joined|left|returned)\b/.test(restAfterCut) && /^[a-z]/.test(restAfterCut)) {
    // the next whole sentence says something complete; a half sentence never does
    let nextSentence = "";
    for (const s of sentences.slice(1)) {
      if ((nextSentence + s).trim().length > limit) break;
      nextSentence += s;
    }
    nextSentence = nextSentence.trim();
    if (nextSentence.length >= 30) out = nextSentence;
  }
  if (((FRAGMENT_OPENER.test(openerTail) || PARTICIPLE_OPENER.test(openerTail)) && !/[،,]/.test(openerTail)) || openSubordinate || appositiveCut) {
    const joiner = /[\u0600-\u06FF]/.test(t) ? "، " : ", ";
    const rest = t.slice(out.length).replace(/^[،,;:\s—–-]+/, "");
    const sentenceTail = ((rest.match(/^[^.!?؟]{1,200}?[.!?؟](?=\s|$)/) || [""])[0] || "").trim();
    // a complete sentence that runs a little long (up to ~185 letters) reads better under the title than a
    // fragment or a four-word line, so the fragment is completed first and dropped only when it cannot fit
    if (sentenceTail && out.length + joiner.length + sentenceTail.length <= limit + 27) out = out + joiner + sentenceTail;
    else if (openerAt >= 42) out = out.slice(0, openerAt).trim();
    // no topic sentence long enough to end on: the completed sentence itself says the story
    else if (sentenceTail.length >= 70 && sentenceTail.length <= limit + 27) out = sentenceTail.charAt(0).toUpperCase() + sentenceTail.slice(1);
  }
  // a cut can leave a dangling connector («…according to», «…في»): drop it and end on a real word
  const DANGLING_END = /(?:^|\s)(?:following|including|despite|amid|alongside|in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via|several|many|some|most|each|every|these|those|such|various|numerous|few|another|في|من|على|إلى|عن|مع|أن|إن|التي|الذي)$/i;
  for (let guard = 0; guard < 4 && DANGLING_END.test(out) && !/\bAll In$/.test(out); guard++) out = out.slice(0, out.lastIndexOf(" ")).trim();
  // Half a multi-word name left by the cut («…at a post-TNA Bound.» for «Bound for Glory», live 2026-10-27):
  // the name's next word is lower-case, so the cut goes back to the last preposition before the half name.
  if (!clauseCut && /^[A-Z][A-Za-z'’-]+$/.test(out.split(/\s+/).pop() || "")) {
    const half = out.split(/\s+/).pop() || "";
    const nextW = t.slice(out.length).trimStart().split(/\s+/)[0] || "";
    if (/^[a-z]/.test(nextW)) {
      const beforeTail = out.slice(0, out.length - half.length);
      const prepAt = Math.max(...[" in ", " on ", " at ", " to ", " for ", " with ", " from ", " after ", " before ", " during ", " of ", " by "].map((p) => beforeTail.lastIndexOf(p)));
      if (prepAt >= 70) out = beforeTail.slice(0, prepAt).trim();
    }
  }
  // A cut in the middle of a clause can leave a verb hanging after its preposition («…with a Tesla
  // Cybertruck by sharing.», seen live on 2026-10-27): that is not a sentence, so go back to the last
  // complete sentence, or drop the dangling part. Only the head changes (INCIDENTS #868).
  // A word cut can stop on an adjective that needs its noun: «…so he can challenge the reigning.», «…as the
  // company's new.» (live 2026-11-01). The cut goes back to the last clause or sentence end that is long enough,
  // otherwise the adjective and the articles in front of it are dropped.
  const NEEDS_NOUN = /(?:^|\s)(?:reigning|new|current|former|upcoming|next|own|other|same|top|biggest|best|first|latest|longest)$/i;
  if (!clauseCut && NEEDS_NOUN.test(out)) {
    const boundary = Math.max(out.lastIndexOf(". "), out.lastIndexOf("? "), out.lastIndexOf("! "), out.lastIndexOf(", "), out.lastIndexOf("; "), out.lastIndexOf(": "));
    if (boundary >= 40) out = out.slice(0, boundary + 1).replace(/[,;:]$/, ".");
    else {
      out = out.slice(0, out.lastIndexOf(" ")).trim();
      for (let guard = 0; guard < 4 && DANGLING_END.test(out); guard++) out = out.slice(0, out.lastIndexOf(" ")).trim();
    }
  }
  const HANGING = /(?:^|\s)(?:by|of|for|about|from|with|into|on|at|to|against|over|under|between|via)\s+[A-Za-z]+ing$/i;
  // the same when the cut leaves a phrase after a subordinating word and its words do not say anything whole:
  // «…their full capabilities following years spent.» (live 2026-10-27) — the phrase goes, the clause stays
  const HANGING_PHRASE = /(?:^|\s)(?:following|including|during|after|before|despite|amid|alongside|beyond|within|without|regarding|concerning|per|plus)\s+[A-Za-z'’-]+(?:\s+[A-Za-z'’-]+)?$/i;
  // «…is currently in development and approaching.»: the cut took the object of the second verb
  // («the pilot filming stage»), so «and approaching» goes and the first verb ends it (Jericho story, INCIDENTS #976)
  const HANGING_AND = /\s(?:and|or|but)\s+[a-z]+ing$/i;
  if (!clauseCut && HANGING_AND.test(out) && (HANGING_AND.exec(out)).index >= 70) out = out.slice(0, (HANGING_AND.exec(out)).index).trim();
  if (!clauseCut && (HANGING.test(out) || HANGING_PHRASE.test(out))) {
    // a clause boundary close to the end reads better than a bare sentence, but a sentence always reads well
    const boundary = Math.max(out.lastIndexOf(". "), out.lastIndexOf("? "), out.lastIndexOf("! "), out.lastIndexOf(", "), out.lastIndexOf("; "), out.lastIndexOf(": "));
    if (boundary >= 40) out = out.slice(0, boundary + 1).replace(/[,;:]$/, ".");
    else {
      const cut = (HANGING.exec(out) || HANGING_PHRASE.exec(out) || { index: out.length }).index;
      out = out.slice(0, cut).trim().replace(/[,;:—-]+$/, "").trim();
      // «…instead of gaining»: the connector in front of the dropped part goes with it
      for (let guard = 0; guard < 3 && /(?:^|\s)(?:instead|rather|also|too|plus|and|or|but|while|when)$/i.test(out); guard++) out = out.slice(0, out.lastIndexOf(" ")).trim();
    }
  }
  // A cut can leave nothing but a time phrase as the last sentence — «…a viral moment involving Booker T.
  // Back in July 2025.», «…a major milestone in Ring of Honor history. On October 14.» (live 2026-10-27).
  // A date on its own says nothing under the title, so it goes and the sentence before it ends the
  // snippet (INCIDENTS #882).
  const tailAt = Math.max(out.lastIndexOf(". "), out.lastIndexOf("? "), out.lastIndexOf("! "));
  const tail = tailAt >= 0 ? out.slice(tailAt + 2).replace(/[.!]$/, "").trim() : "";
  if (tailAt >= 40 && tail && isTimeOnly(tail)) out = out.slice(0, tailAt + 1);
  // …and a last sentence that is only a subordinate phrase with no comma and no verb of its own
  // («…at TNA Destination X. During the October 29 episode of TNA iMPACT.», 2026-11-01) is the same fragment
  if (tailAt >= 40 && tail && /^(?:Prior to|Before|After|While|When|As|During|Following|Despite|Because|Since|If|Although|Though|According to)\s[^,]*$/.test(tail) && tail.split(/\s+/).length <= 9) out = out.slice(0, tailAt + 1);
  // a quote left open by the cut is closed so the snippet does not look broken
  const quotes = (out.match(/«/g) || []).length - (out.match(/»/g) || []).length;
  if (quotes > 0) out += "»".repeat(Math.min(quotes, 2));
  // «…with Steph McMahon," looking back.»: a participle phrase that lost its object goes (live 2026-11-01)
  if (!clauseCut) out = out.replace(/,(["”»]?)\s+(?:looking|reflecting|going|thinking|speaking|talking)\s+back$/i, "$1");
  out = out.replace(/[,;:]+(["”»]*)$/, "$1"); // «…\"The Wrestling Classic,\".» ends on the quote
  if (!SENTENCE_END.test(out.slice(-1))) out += ".";
  return out;
}

/** «Back in July 2025», «On October 14», «During the June 3 episode», «In 2019»: a time phrase and nothing else */
const TIME_OPENER = /^(?:back in|in|on|at|during|since|earlier|later|meanwhile|before|after|by)\s+/i;const TIME_ONLY = /^(?:the\s+)?(?:(?:january|february|march|april|may|june|july|august|september|october|november|december|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?\s+\d{1,4}(?:,?\s+\d{4})?(?:\s+episode)?|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?|\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?|\d{4})$/i;
function isTimeOnly(phrase) {
  const rest = String(phrase || "").replace(TIME_OPENER, "").replace(/^(?:the\s+)/i, "").trim();
  if (!rest || rest === phrase.trim()) return false; // no opener: a plain month/year is part of a longer sentence
  return TIME_ONLY.test(rest);
}

module.exports = { metaDescription };
