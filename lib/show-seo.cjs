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
    ? `مشاهدة وتحميل ${name}${dot ? ` ${dot}` : ""} مترجم بالعربي كامل أونلاين وبجودة عالية، موعد العرض ${day}${en ? ` (${en})` : ""}، مع كل النزالات وروابط المشاهدة والتحميل.`
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
function showNameForms({ headline, title, programName, eventDate, aliases = [], isShow = false, archive = false }) {
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
  // The program's shorter English names (alias «ROH Wrestling» for «ROH Specials») carry the date too: «ROH Wrestling October 5 2026»
  // is how an English visitor looks for it — structured data only (INCIDENTS #512)
  const enAliases = (aliases || []).map((a) => String(a || "").trim()).filter((a) => /^[A-Za-z][A-Za-z0-9'&:.! -]*$/.test(a) && !/\btv\b/i.test(a) && a.toLowerCase() !== prog.toLowerCase());
  for (const a of enAliases.slice(0, 2)) out.push(`${a} ${EN_MONTHS[p.m - 1]} ${p.d} ${p.y}`);
  // The program's other Arabic spellings with the date («دبليو دبليو إي راو 5 أكتوبر 2026»), and the words visitors add to the
  // name of a show («تحميل عرض الرو»، «عرض الرو الاخير مترجم», «مشاهدة عرض الرو») — structured data only (INCIDENTS #472)
  const ar = (aliases || []).map((a) => String(a || "").trim()).filter((a) => /[؀-ۿ]/.test(a) && !/\d|مترجم|الاخير|الأخير/.test(a));
  for (const a of ar.slice(0, 4)) out.push(`${a} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
  if (isShow) {
    // a program without a «عرض …» alias (a nostalgia special) leads with its own Arabic name
    const lead = ar.find((a) => /^عرض\s/.test(a)) || (/^عرض\s/.test(arName) ? arName : "");
    if (lead) {
      out.push(`${lead} مترجم`, `تحميل ${lead}`, `مشاهدة ${lead}`, `مشاهده ${lead}`);
      // an archive episode (nostalgia) is never «the latest»
      if (!archive) out.push(`${lead} الاخير مترجم`, `${lead} الأخير مترجم كامل`, `${lead} الاخير مترجم كامل`, `${lead} مترجم كامل`, `${lead} الاخير كامل`, `مشاهدة ${lead} الاخير مترجم`, `مشاهدة ${lead} الاخير مترجم كامل`, `اخر ${lead}`);
      // A yearly show (Money in the Bank 2026) is searched with its year after every one of those words, and with the
      // program's English name too («تحميل عرض money in the bank 2026») — structured data only (INCIDENTS #503)
      // The year may be only in the title's brackets («WWE Money in the Bank (2026)») while the headline carries the date (INCIDENTS #517)
      const yr = (`${base} ${archive ? title || "" : ""}`.replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").match(/\b((?:19|20)\d\d)\b/) || String(title || "").match(/\(((?:19|20)\d\d)\)/) || [])[1];
      if (yr) {
        const names = [lead.replace(new RegExp(`\\s*${yr}$`), "")];
        const en = prog.replace(/^WWE\s+/i, "");
        if (/^[A-Za-z]/.test(en)) names.push(`عرض ${en}`);
        for (const n of names) {
          out.push(`${n} ${yr}`, `${n} ${yr} مترجم`, `${n} ${yr} كامل`, `تحميل ${n} ${yr}`, `مشاهدة ${n} ${yr}`, `مشاهده ${n} ${yr}`);
        }
        // …and without the year, which many visitors leave out («تحميل عرض money in the bank»)
        if (/^[A-Za-z]/.test(en)) out.push(`${en} ${yr} مترجم`, `${en} ${yr} تحميل`, `تحميل عرض ${en}`, `مشاهدة عرض ${en}`, `عرض ${en} مترجم`);
      } else if (!archive) {
        // A weekly episode (RAW, SmackDown…) is also searched without «عرض» or without «ال» («الرو الاخير», «رو مترجم»,
        // «عرض رو الاخير», «اخر عرض الرو») and by the English program name («wwe raw مترجم») — structured data only (INCIDENTS #508)
        const core = lead.replace(/^عرض\s+/, "");
        const bare = core.replace(/^ال(?=\S{2})/, "");
        const forms = [core, bare, `عرض ${bare}`];
        for (const f of new Set(forms)) out.push(`${f} الاخير`, `${f} مترجم`, `${f} الاخير مترجم`, `${f} الأخير مترجم كامل`);
        out.push(`${lead} الاخير`, `${lead} الأخير`, `${lead} مترجم عربي`, `${lead} الاخير كامل ومترجم`, `مشاهدة ${lead} الاخير مترجم`, `تحميل ${lead} الاخير`, `اخر ${bare}`);
        // Visitors spell NXT in many ways («ان اكس تي», «اكس ان تي», «ان اكس اكس», «nxt»): each one with «عرض … مترجم» (INCIDENTS #514)
        if (/\bNXT\b/i.test(prog)) for (const v of ["ان اكس تي", "اكس ان تي", "ان اكس اكس", "اكس ان اكس", "إن إكس تي", "NXT"]) out.push(`عرض ${v} مترجم`, `${v} مترجم`, `${v} الاخير مترجم`, `${v} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y} مترجم`);
        // …and the category people type when they have no program in mind («عروض المصارعة الحرة مترجم», INCIDENTS #550)
        out.push("عروض المصارعة الحرة مترجم", "عروض مصارعة حرة مترجمة");
        if (/^[A-Za-z]/.test(prog)) out.push(`${prog} مترجم`, `${prog} الاخير`, `${prog} الاخير مترجم`, `${prog} كامل مترجم`);
      }
    }
    // The program's name in Arabic letters with the federation's («دبليو دبليو إي موني إن ذا بانك»)
    const plain = ar.find((a) => !/^عرض\s/.test(a) && !/دبليو/.test(a));
    if (plain && /^WWE\b/i.test(prog)) out.push(`دبليو دبليو إي ${plain}`);  }
  // Visitors write «ان» as «إن» and «الاخير» as «الأخير» («دبليو دبليو إي موني إن ذا بانك», «عرض سماك داون الأخير مترجم»): the
  // same names with the hamza, structured data only (INCIDENTS #535)
  for (const f of [...out]) {
    if (!/[؀-ۿ]/.test(f)) continue;
    const h = f.replace(/(^|\s)ان(?=\s)/g, "$1إن").replace(/(^|\s)الاخير(?=\s|$)/g, "$1الأخير").replace(/(^|\s)اخر(?=\s)/g, "$1آخر");
    if (h !== f) out.push(h);
  }
  if (!isShow) {
    // A recap is searched as «ملخص …», «نتائج …» and «<English name> highlights/results», with the year for a yearly show
    // («ملخص موني ان ذا بانك 2026», «money in the bank 2026 highlights») — structured data only (INCIDENTS #515)
    const core = arName.replace(/^ملخص\s+/, "").replace(/^عرض\s+/, "");
    const yrRaw = (`${String(title || "").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ")}`.match(/\b((?:19|20)\d\d)\b/) || [])[1];
    const names = [core, core.replace(/^ال(?=\S{2})/, "")].filter(Boolean);
    for (const n of new Set(names)) {
      out.push(`ملخص ${n}`, `ملخص ${n} مترجم`, `نتائج ${n}`, `ملخص ${n} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
      if (yrRaw) out.push(`ملخص ${n} ${yrRaw}`, `ملخص ${n} ${yrRaw} مترجم`, `ملخص عرض ${n} ${yrRaw}`, `نتائج ${n} ${yrRaw}`);
    }
    const en = prog.replace(/\s*highlights?\s*$/i, "").trim();
    if (/^[A-Za-z]/.test(en)) {
      const y = yrRaw || p.y;
      out.push(`${en} ${y} highlights`, `${en} ${y} results`, `${en} ${y} مترجم`, `${en} highlights ${EN_MONTHS[p.m - 1]} ${p.d} ${p.y}`);
      if (/^WWE\s/i.test(en)) out.push(`${en.replace(/^WWE\s+/i, "")} ${y} highlights`);
    }
  }
  return [...new Set(out)];
}

/**
 * How visitors write a program's library page («مشاهدة عرض موني ان ذا بانك 2026», «تحميل عرض money in the bank»,
 * «wwe money in the bank 2026 مترجم», «دبليو دبليو إي موني إن ذا بانك»): the VideoObject-style extra names of the
 * TVSeries in the CollectionPage's structured data, nothing visible (INCIDENTS #503).
 */
function libraryNameForms({ arName, name, aliases = [], year, count = 0, latest = null }) {
  const ar = String(arName || "").trim();
  const en = String(name || "").trim();
  const yr = /^20\d\d$/.test(String(year || "")) ? String(year) : "";
  const out = [];
  const enShort = en.replace(/^WWE\s+/i, "");
  const arPlain = (aliases || []).map((a) => String(a || "").trim()).find((a) => /[؀-ۿ]/.test(a) && !/^عرض\s/.test(a) && !/دبليو|\d|مترجم/.test(a));
  for (const n of [ar, /^[A-Za-z]/.test(enShort) ? `عرض ${enShort}` : ""].filter(Boolean)) {
    out.push(`مشاهدة ${n}`, `مشاهده ${n}`, `تحميل ${n}`, `${n} كامل`);
    // a weekly program (RAW, SmackDown, Dynamite…) is searched as «عرض الرو الاخير مترجم», «اخر عرض الرو», «تحميل عرض الرو الاخير» (INCIDENTS #505)
    if (count >= 4) out.push(`${n} مترجم`, `${n} الاخير`, `${n} الأخير`, `${n} الاخير مترجم`, `${n} الأخير مترجم`, `${n} الاخير مترجم عربي`, `${n} الاخير كامل ومترجم`, `${n} الأخير مترجم كامل`, `${n} الاخير مترجم كامل`, `${n} مترجم كامل`, `${n} الاخير كامل`, `مشاهدة ${n} الاخير مترجم كامل`, `اخر ${n}`, `تحميل ${n} الاخير`, `مشاهدة ${n} الاخير مترجم`);
    if (yr) out.push(`${n} ${yr}`, `${n} ${yr} مترجم`, `${n} ${yr} كامل`, `مشاهدة ${n} ${yr}`, `مشاهده ${n} ${yr}`, `تحميل ${n} ${yr}`);
  }
  if (en && /^[A-Za-z]/.test(en)) {
    out.push(`${en} مترجم`, ...(yr ? [`${en} ${yr} مترجم`, `${en} ${yr} تحميل`] : []));
  }
  // A weekly program's page answers «عرض دايناميت 7/10/2026» and «AEW Dynamite October 7 2026» for its newest episode (INCIDENTS #515)
  const lp = count >= 4 ? partsOf(latest, "") : null;
  if (lp) {
    for (const n of [ar, /^[A-Za-z]/.test(enShort) ? `عرض ${enShort}` : ""].filter(Boolean)) out.push(`${n} ${lp.d}/${lp.m}/${lp.y}`, `${n} ${lp.d} ${AR_MONTHS[lp.m - 1]} ${lp.y}`, `${n} ${String(lp.d).padStart(2, "0")}.${String(lp.m).padStart(2, "0")}.${lp.y} مترجم`);
    if (/^[A-Za-z]/.test(en)) out.push(`${en} ${EN_MONTHS[lp.m - 1]} ${lp.d} ${lp.y}`, `${en} ${lp.m}/${lp.d}/${lp.y}`, `${en} ${EN_MONTHS[lp.m - 1]} ${lp.d} ${lp.y} مترجم`);
  }
  if (arPlain && /^WWE\b/i.test(en)) out.push(`دبليو دبليو إي ${arPlain}`, ...(yr ? [`دبليو دبليو إي ${arPlain} ${yr}`] : []));
  return [...new Set(out)];
}

module.exports = { showSeoText, recapSeoText, showNameParts, showNameForms, libraryNameForms };
