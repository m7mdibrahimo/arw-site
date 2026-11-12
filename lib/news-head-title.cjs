// The head <title> of a news story whose headline says «الليلة» with no date («دليل مشاهدة عرض TNA iMPACT الليلة»):
// the same preview is written every week, so every week's page had almost the same <title> and Google left the new
// one «crawled, not indexed» (INCIDENTS #1260). The head title gets the night's date (New York day, as the shows'
// «tonight» is the American night); the visible headline is never changed.
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function datedTonightTitle(title, date) {
  const t = String(title || "");
  if (!/(^|\s)الليلة(\s|$|[،:.!؟])/.test(t)) return t;
  if (/\b(?:19|20)\d{2}\b/.test(t) || new RegExp(`\\d{1,2}\\s+(?:${MONTHS.join("|")})`).test(t)) return t;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return t;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (k) => Number(parts.find((p) => p.type === k)?.value);
  return `${t} ${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`;
}

module.exports = { datedTonightTitle };
