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

/** The show's Arabic name without date or «مترجم» («عرض سماك داون») and its dotted date («09.10.2026»). */
function showNameParts(headline, title, eventDate) {
  const base = String(headline || title || "");
  const arName = base.replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, "").replace(/\s+/g, " ").trim();
  const p = partsOf(eventDate, base);
  const dot = p ? `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}` : "";
  return { arName: /[؀-ۿ]/.test(arName) ? arName : "", dot };
}

function showSeoText({ headline, title, programName, eventDate, day, isLatest, description, aliases }) {
  const base = String(headline || title || "");
  const arName = base.replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, "").replace(/\s+/g, " ").trim();
  const prog = String(programName || "").trim();
  if (!/[؀-ۿ]/.test(arName) || !day) return { title: base, description: description || "", isLatest };
  const p = partsOf(eventDate, base);
  const dot = p ? `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}` : "";
  const en = p && prog ? `${prog} ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
  const tail = prog && !arName.includes(prog) ? ` — ${prog}` : "";
  const name = `${arName}${isLatest ? " الأخير" : ""}`;
  // Short and clean, the way Google shows it (owner 2026-10-11, INCIDENTS #428): one date in the title, under ~60
  // letters before « | عرب راسلنج». The ~100-letter title with the date twice and the description ending in a list of
  // spellings («ويعرف أيضا: …») read as stuffing — Google cut them and wrote its own. Other spellings of the program
  // stay in the structured data (alternateName in the layout), not in the text people read.
  // «كامل» too: «عرض سماك داون الأخير 9/10/2026 كامل مترجم» is how the site at the top of Google names it (INCIDENTS #434)
  const t = `${name}${dot ? ` ${dot}` : ""} كامل مترجم${tail}`;
  const generic = !description || /^عرض .* مترجم بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim());
  const d = generic
    ? `شاهد ${name}${dot ? ` ${dot}` : ""} مترجم بالعربي كامل وبجودة عالية، بتاريخ ${day}${en ? ` (${en})` : ""}، مع كل النزالات وروابط المشاهدة والتحميل.`
    : description;
  return { title: t, description: d, isLatest };
}

// A recap page gets the same treatment (INCIDENTS #432): its front matter says «ملخص عرض موني ان ذا بانك 10.10.2026» and
// «… بالكامل مع جميع النزالات والأحداث», which names neither the English program nor the date people search with
// («WWE Raw highlights October 5 2026», «ملخص الرو 05.10.2026 مترجم»). Head only, nothing visible on the page.
function recapSeoText({ headline, title, programName, eventDate, day, description }) {
  const base = String(headline || title || "");
  const arName = base.replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, "").replace(/\s+/g, " ").trim();
  const prog = String(programName || "").replace(/\s*highlights?\s*$/i, "").trim() || String(title || "").replace(/\(.*?\)|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|highlights?/gi, " ").replace(/\s+/g, " ").trim();
  if (!/[؀-ۿ]/.test(arName) || !day) return { title: base, description: description || "" };
  const p = partsOf(eventDate, base);
  const dot = p ? `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}` : "";
  const en = p && prog ? `${prog} Highlights ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
  const tail = prog && !arName.includes(prog) ? ` — ${prog}` : "";
  const t = `${arName}${dot ? ` ${dot}` : ""} مترجم${tail}`;
  const generic = !description || /^ملخص عرض .*بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim());
  const d = generic
    ? `شاهد ${arName}${dot ? ` ${dot}` : ""} مترجم بالعربي: أبرز لحظات ونتائج العرض كاملة، بتاريخ ${day}${en ? ` (${en})` : ""}.`
    : description;
  return { title: t, description: d };
}

module.exports = { showSeoText, recapSeoText, showNameParts };
