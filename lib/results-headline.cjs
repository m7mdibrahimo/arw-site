// A weekly show's results story is titled «نتائج عرض WWE RAW (9 نوفمبر 2026): …» — the program only in Latin letters.
// People search it as «نتائج عرض الرو الاخير» (7.5, 476 impressions) and «نتائج عرض سماك داون الاخير 2026» (6.7), and Google
// answered both with the home page. The NewsArticle's alternativeHeadline names the program in Arabic, the dotted date and the
// English «WWE Raw Results November 9, 2026» — structured data only, nothing on the page (INCIDENTS #1350).
const PROGRAMS = [
  [/^WWE\s+RAW\b/i, "الرو", "WWE Raw"],
  [/^WWE\s+SmackDown\b/i, "سماك داون", "WWE SmackDown"],
  [/^WWE\s+NXT\b/i, "ان اكس تي", "WWE NXT"],
  [/^AEW\s+Dynamite\b/i, "داينامايت", "AEW Dynamite"],
  [/^AEW\s+Collision\b/i, "كوليجن", "AEW Collision"],
  [/^TNA\s+iMPACT\b/i, "امباكت", "TNA iMPACT"],
];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function resultsAltHeadline(title) {
  const m = String(title || "").match(/^نتائج\s+(?:تسجيلات\s+)?عرض\s+(.+)$/);
  if (!m) return "";
  const rest = m[1];
  const prog = PROGRAMS.find(([re]) => re.test(rest));
  if (!prog) return "";
  const d = rest.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
  if (!d) return "";
  const norm = { "ابريل": "أبريل", "اغسطس": "أغسطس", "اكتوبر": "أكتوبر" };
  const mi = AR_MONTHS.indexOf(norm[d[2]] || d[2]);
  const day = Number(d[1]);
  const dotted = `${String(day).padStart(2, "0")}.${String(mi + 1).padStart(2, "0")}.${d[3]}`;
  return `نتائج عرض ${prog[1]} ${day} ${AR_MONTHS[mi]} ${d[3]} (${dotted}) — ${prog[2]} Results ${EN_MONTHS[mi]} ${day}, ${d[3]}`;
}

module.exports = { resultsAltHeadline };
