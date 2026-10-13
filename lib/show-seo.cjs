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
  const prog = String(programName || "").trim().replace(/^(\S+)\s+\1(?=\s)/i, "$1");
  if (!/[؀-ۿ]/.test(arName) || !day) return { title: base, description: description || "", isLatest };
  const p = partsOf(eventDate, base);
  const dot = p ? `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}` : "";
  // The English name people type for a special event is the front-matter title («GCW Fight Club The Art Of War Games Night One»),
  // not just the program («GCW») — it goes in the description's English date line (INCIDENTS #461).
  const enTitle = String(title || "").replace(/\(.*?\)|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s+/g, " ").trim();
  const enName = prog && /^[A-Za-z0-9'&:.! -]+$/.test(enTitle) && enTitle.length > prog.length && enTitle.toLowerCase().startsWith(prog.toLowerCase()) ? enTitle : prog;
  const en = p && enName ? `${enName} ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
  const tail = prog && !arName.includes(prog) ? ` — ${prog}` : "";
  // A yearly event is searched with its year («عرض موني ان ذا بانك 2026», «موعد … 2026»): when the front-matter title
  // carries it («WWE Money in the Bank (2026)») and the Arabic name doesn't, the name does, once, before the dotted date.
  const yr = /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/.test(String(title || "")) ? "" : (String(title || "").match(/\b(20\d\d)\b/) || [])[1];
  const yearName = yr && p && String(p.y) === yr && !arName.includes(yr) ? `${arName} ${yr}` : arName;
  const name = `${yearName}${isLatest ? " الأخير" : ""}`;
  // Short and clean, the way Google shows it (owner 2026-10-11, INCIDENTS #428): one date in the title, under ~60
  // letters before « | عرب راسلنج». The ~100-letter title with the date twice and the description ending in a list of
  // spellings («ويعرف أيضا: …») read as stuffing — Google cut them and wrote its own. Other spellings of the program
  // stay in the structured data (alternateName in the layout), not in the text people read.
  // «كامل» too: «عرض سماك داون الأخير 9/10/2026 كامل مترجم» is how the site at the top of Google names it (INCIDENTS #434)
  const t = `${name}${dot ? ` ${dot}` : ""} كامل مترجم${tail}`;
  const generic = !description || /^عرض .* مترجم بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim());
  const d = generic
    ? `شاهد ${name}${dot ? ` ${dot}` : ""} مترجم بالعربي كامل وبجودة عالية، موعد العرض ${day}${en ? ` (${en})` : ""}، مع كل النزالات وروابط المشاهدة والتحميل.`
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
  // The yearly show's recap is searched with the year too («ملخص موني ان ذا بانك 2026»): same rule as the show (INCIDENTS #463)
  const yr = /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/.test(String(title || "")) ? "" : (String(title || "").match(/\b(20\d\d)\b/) || [])[1];
  const yearName = yr && p && String(p.y) === yr && !arName.includes(yr) ? `${arName} ${yr}` : arName;
  const t = `${yearName}${dot ? ` ${dot}` : ""} مترجم${tail}`;
  const generic = !description || /^ملخص عرض .*بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim());
  const d = generic
    ? `شاهد ${yearName}${dot ? ` ${dot}` : ""} مترجم بالعربي: أبرز لحظات ونتائج العرض كاملة، بتاريخ ${day}${en ? ` (${en})` : ""}.`
    : description;
  return { title: t, description: d };
}

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/**
 * The other ways a visitor writes THIS episode («عرض الرو 5/10/2026», «عرض الرو 5 أكتوبر 2026»,
 * «WWE RAW October 5 2026», «WWE RAW 10/5/2026»), for the VideoObject's alternateName only: structured data in the
 * head, nothing visible (INCIDENTS #466). The dotted date and the written Arabic date are already in the title and
 * description; these are the spellings they don't carry.
 */
function showNameForms({ headline, title, programName, eventDate, aliases = [], isShow = false }) {
  const base = String(headline || title || "");
  const { arName } = showNameParts(headline, title, eventDate);
  const p = partsOf(eventDate, base);
  if (!p) return [];
  const prog = String(programName || "").trim().replace(/^(\S+)\s+\1(?=\s)/i, "$1");
  const out = [];
  if (arName) {
    out.push(`${arName} ${p.d}/${p.m}/${p.y}`, `${arName} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
  }
  if (prog && /^[A-Za-z0-9'&:.! -]+$/.test(prog)) {
    out.push(`${prog} ${EN_MONTHS[p.m - 1]} ${p.d} ${p.y}`, `${prog} ${p.m}/${p.d}/${p.y}`);
  }
  // The program's other Arabic spellings with the date («دبليو دبليو إي راو 5 أكتوبر 2026»), and the words visitors add to the
  // name of a show («تحميل عرض الرو»، «عرض الرو الاخير مترجم», «مشاهدة عرض الرو») — structured data only (INCIDENTS #472)
  const ar = (aliases || []).map((a) => String(a || "").trim()).filter((a) => /[؀-ۿ]/.test(a) && !/\d|مترجم|الاخير|الأخير/.test(a));
  for (const a of ar.slice(0, 4)) out.push(`${a} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
  if (isShow) {
    const lead = ar.find((a) => /^عرض\s/.test(a));
    if (lead) {
      out.push(`${lead} مترجم`, `${lead} الاخير مترجم`, `${lead} الأخير مترجم كامل`, `تحميل ${lead}`, `مشاهدة ${lead}`, `اخر ${lead}`);
    }
  }
  return [...new Set(out)];
}

module.exports = { showSeoText, recapSeoText, showNameParts, showNameForms };
