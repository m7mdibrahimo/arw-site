// The site build's copy of studio/js/names.js (INCIDENTS #462) — the same rules; tests/names.test.mts keeps them equal.
const SINGLE_AR = new Set(["عرض", "ملخص", "مترجم", "برنامج", "حلقة", "نتائج", "كامل", "اتحاد"]);
const isInitials = (w) => /^[A-Z][A-Z0-9&]{1,7}$/.test(w);
function collapseRepeatedNames(input) {
  if (typeof input !== "string" || !input.trim()) return input;
  let s = input, prev;
  do {
    prev = s;
    s = s.replace(/(^|\s)((?:\S+\s+){1,5}\S+)\s+\2(?=\s|$)/giu, "$1$2");
    s = s.replace(/(^|\s)(\S+)((?:\s+\2)+)(?=\s|$)/giu, (m, pre, w) => (isInitials(w.toUpperCase()) && w === w.toUpperCase()) || SINGLE_AR.has(w) ? pre + w : m);
  } while (s !== prev);
  return s;
}
module.exports = { collapseRepeatedNames };
