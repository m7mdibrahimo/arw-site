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
const ABBREVIATION_END = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|a\.m|p\.m|U\.S|U\.K|Bros|Co|Corp|Inc|Ltd|Dept|Univ|Assn|Ave|Blvd|No|Vol|Fig|[A-Z])\.$/;

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
  if (acc.length >= 70) return acc;
  // 2. the last clause boundary (comma, semicolon, colon, dash) that fits
  const head = t.slice(0, limit);
  const at = Math.max(head.lastIndexOf("، "), head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(" — "), head.lastIndexOf(" – "));
  let out = at >= 70 ? head.slice(0, at) : "";
  const clauseCut = out !== ""; // a clause cut keeps its verb («…focused on improving»): only a word cut can hang
  // 3. last resort: the last whole word that fits — a dangling «in/at/of/the» is dropped first
  if (!out) {
    // A quantifier needs the noun after it: «…to poke fun at several.» said nothing (live 2026-10-27), so it
    // goes with the prepositions and articles.
    const DANGLING = /(?:^|\s)(?:in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via|several|many|some|most|each|every|these|those|such|various|numerous|few|another)$/i;
    let cut = head;
    for (let guard = 0; guard < 4 && DANGLING.test(cut); guard++) cut = cut.slice(0, cut.lastIndexOf(" "));
    const sp = cut.lastIndexOf(" ");
    out = cut.slice(0, sp >= 70 ? sp : cut.length);
    // A word cut can land in the middle of a proper name («…will face Bron.»): a complete short
    // sentence above reads better than half a name under the title (INCIDENTS #869).
    const tail = out.split(/\s+/).pop() || "";
    const nextWord = t.slice(out.length).trimStart().split(/\s+/)[0] || "";
    if (/^[A-Z][A-Za-z'’-]+$/.test(tail) && /^[A-Z]/.test(nextWord)) {
      const first = (sentences[0] || "").trim();
      if (first.length >= 40) out = first;
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
  if (FRAGMENT_OPENER.test(openerTail) && !/[،,]/.test(openerTail)) {
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
  const DANGLING_END = /(?:^|\s)(?:in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via|several|many|some|most|each|every|these|those|such|various|numerous|few|another|في|من|على|إلى|عن|مع|أن|إن|التي|الذي)$/i;
  for (let guard = 0; guard < 4 && DANGLING_END.test(out); guard++) out = out.slice(0, out.lastIndexOf(" ")).trim();
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
  const HANGING = /(?:^|\s)(?:by|of|for|about|from|with|into|on|at|to|against|over|under|between|via)\s+[A-Za-z]+ing$/i;
  // the same when the cut leaves a phrase after a subordinating word and its words do not say anything whole:
  // «…their full capabilities following years spent.» (live 2026-10-27) — the phrase goes, the clause stays
  const HANGING_PHRASE = /(?:^|\s)(?:following|including|during|after|before|despite|amid|alongside|beyond|within|without|regarding|concerning|per|plus)\s+[A-Za-z'’-]+(?:\s+[A-Za-z'’-]+)?$/i;
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
  // a quote left open by the cut is closed so the snippet does not look broken
  const quotes = (out.match(/«/g) || []).length - (out.match(/»/g) || []).length;
  if (quotes > 0) out += "»".repeat(Math.min(quotes, 2));
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
