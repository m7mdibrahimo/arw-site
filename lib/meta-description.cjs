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
  // a quote left open by the cut is closed so the snippet does not look broken
  const quotes = (out.match(/«/g) || []).length - (out.match(/»/g) || []).length;
  if (quotes > 0) out += "»".repeat(Math.min(quotes, 2));
  if (!SENTENCE_END.test(out.slice(-1))) out += ".";
  return out;
}

module.exports = { metaDescription };
