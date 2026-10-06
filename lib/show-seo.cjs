// Search title and description for a show page, worded the way people search. Only the <head> changes:
// nothing here is shown on the page itself (the owner's call, INCIDENTS #296).
// «عرض الرو 05.10.2026 مترجم» is how the show is named and searched, so the dotted date leads the
// title next to «الأخير» and the written date (INCIDENTS #275, #296). The description adds the English
// name and date for searches like «WWE Raw October 5 2026».
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function partsOf(eventDate, base) {
  const fromName = String(base || "").match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (fromName) return { d: Number(fromName[1]), m: Number(fromName[2]), y: Number(fromName[3]) };
  if (eventDate instanceof Date && !isNaN(eventDate.getTime())) return { d: eventDate.getUTCDate(), m: eventDate.getUTCMonth() + 1, y: eventDate.getUTCFullYear() };
  const ymd = String(eventDate || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return ymd ? { d: Number(ymd[3]), m: Number(ymd[2]), y: Number(ymd[1]) } : null;
}

function showSeoText({ headline, title, programName, eventDate, day, isLatest, description }) {
  const base = String(headline || title || "");
  const arName = base.replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, "").replace(/\s+/g, " ").trim();
  const prog = String(programName || "").trim();
  if (!/[؀-ۿ]/.test(arName) || !day) return { title: base, description: description || "", isLatest };
  const p = partsOf(eventDate, base);
  const dot = p ? `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}` : "";
  const en = p && prog ? `${prog} ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
  const tail = prog && !arName.includes(prog) ? ` — ${prog}` : "";
  const name = `${arName}${isLatest ? " الأخير" : ""}`;
  const t = `${name}${dot ? ` ${dot}` : ""} مترجم (${day})${tail}`;
  const generic = !description || /^عرض .* مترجم بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim());
  const d = generic
    ? `شاهد ${name}${dot ? ` ${dot}` : ""} مترجم بالعربي كامل بتاريخ ${day}${en ? ` (${en})` : ""} بجودة عالية مع كل النزالات، مشاهدة وتحميل على عرب راسلنج.`
    : description;
  return { title: t, description: d, isLatest };
}

module.exports = { showSeoText };
