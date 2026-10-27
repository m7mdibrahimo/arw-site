// The meta description is what a visitor reads under the title in Google. Cutting the text at a
// fixed length left it ending mid-sentence with «…» on 1,536 of 1,564 English stories (and the
// Arabic ones ended mid-word): Google rewrites such snippets and the click is lost. A description
// now always ends where a sentence (or at least a clause) ends. Head only — nothing on the page
// changes (INCIDENTS #862).
const SENTENCE_END = /[.!?؟]/;

/**
 * @param {string} text  the story's lead (first paragraph of prose)
 * @param {number} limit the length Google shows (~158 letters)
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
  const sentences = t.match(/[^.!?؟]+[.!?؟]+["»”]?\s*/g) || [];
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
    const DANGLING = /(?:^|\s)(?:in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via)$/i;
    let cut = head;
    for (let guard = 0; guard < 4 && DANGLING.test(cut); guard++) cut = cut.slice(0, cut.lastIndexOf(" "));
    const sp = cut.lastIndexOf(" ");
    out = cut.slice(0, sp >= 70 ? sp : cut.length);
  }
  out = out.trim().replace(/[،,;:—-]+$/, "").trim();
  // a cut can leave a dangling connector («…according to», «…في»): drop it and end on a real word
  const DANGLING_END = /(?:^|\s)(?:in|on|at|to|for|with|and|or|of|the|a|an|by|from|as|that|which|who|whom|whose|his|her|their|its|after|before|during|about|into|over|under|between|against|via|في|من|على|إلى|عن|مع|أن|إن|التي|الذي)$/i;
  for (let guard = 0; guard < 4 && DANGLING_END.test(out); guard++) out = out.slice(0, out.lastIndexOf(" ")).trim();
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
  // a quote left open by the cut is closed so the snippet does not look broken
  const quotes = (out.match(/«/g) || []).length - (out.match(/»/g) || []).length;
  if (quotes > 0) out += "»".repeat(Math.min(quotes, 2));
  if (!SENTENCE_END.test(out.slice(-1))) out += ".";
  return out;
}

module.exports = { metaDescription };
