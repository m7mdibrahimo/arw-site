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
  const enName = prog && /^[A-Za-z0-9'&:.!/ -]+$/.test(enTitle) && enTitle.length > prog.length && enTitle.toLowerCase().startsWith(prog.toLowerCase()) ? enTitle : prog;
  const en = p && enName ? `${enName} ${EN_MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
  const tail = prog && !arName.includes(prog) ? ` — ${prog}` : "";
  // A yearly event is searched with its year («عرض موني ان ذا بانك 2026», «موعد … 2026»): when the front-matter title
  // carries it («WWE Money in the Bank (2026)») and the Arabic name doesn't, the name does, once, before the dotted date.
  const yr = /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/.test(String(title || "")) ? "" : (String(title || "").match(/\b(20\d\d)\b/) || [])[1];
  const yearName = yr && p && String(p.y) === yr && !arName.includes(yr) ? `${arName} ${yr}` : arName;
  // Two parts of one event on the same day («(العرض الاول)» / «(العرض الثاني)») would otherwise get the same title and
  // description, and Google folds such twins into one canonical (INCIDENTS #690): the part's own mark stays in the head
  const partMark = (base.match(/\(\s*((?:العرض|الجزء|الليلة|الحلقة|الجولة)\s+[^)\d]{2,20}?)\s*\)/) || [])[1] || "";
  const name = `${yearName}${partMark ? ` (${partMark})` : ""}${isLatest ? " الأخير" : ""}`;
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
    ? `شاهد ${yearName}${dot ? ` ${dot}` : ""} مترجم بالعربي أونلاين: أبرز لحظات ونتائج العرض كاملة، بتاريخ ${day}${en ? ` (${en})` : ""}.`
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
  // …and with the dotted / slashed date («دبليو دبليو إي راو 19.10.2026», «الرو 19/10/2026»), how a visitor copies the date from the schedule (rank 9.5 in Search Console for «دبليو دبليو إي راو 19 أكتوبر 2026»). Structured data only.
  for (const a of ar.slice(0, 4)) out.push(`${a} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`, `${a} ${p.d}/${p.m}/${p.y}`);
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
          // «موعد عرض موني ان ذا بانك 2026» — the date people ask for a yearly show (rank 8.7 in Search Console, INCIDENTS #715); structured data only
          out.push(`موعد ${n} ${yr}`, `موعد ${n} ${yr} مترجم`);
          // …and «مباشر» («عرض موني ان ذا بانك 2026 مباشر»), still outside the first 3 in Search Console (INCIDENTS #785); structured data only
          out.push(`${n} ${yr} مباشر`, `مشاهدة ${n} ${yr} مباشر`);
        }
        // …and the Arabic name without «عرض» («موني ان ذا بانك 2026», «موني ان ذا بانك 2026 مترجم») and with WWE in front (INCIDENTS #626)
        const bareName = lead.replace(/^عرض\s+/, "").replace(new RegExp(`\\s*${yr}$`), "");
        out.push(`${bareName} ${yr}`, `${bareName} ${yr} مترجم`, `${bareName} ${yr} كامل`, `مشاهدة ${bareName} ${yr}`, `تحميل ${bareName} ${yr}`, `عرض ${bareName} ${yr} كامل مترجم`);
        // «wwe …» only for a WWE program: «wwe AEW WrestleDream 2026 مترجم» named an AEW show as WWE (INCIDENTS #690)
        if (/^[A-Za-z]/.test(en)) out.push(...(/^WWE\s/i.test(prog) ? [`wwe ${en} ${yr} مترجم`] : []), `${en} ${yr}`);
        // …and without the year, which many visitors leave out («تحميل عرض money in the bank»)
        if (/^[A-Za-z]/.test(en)) out.push(`${en} ${yr} مترجم`, `${en} ${yr} تحميل`, `تحميل عرض ${en}`, `مشاهدة عرض ${en}`, `عرض ${en} مترجم`);
        // «aew مترجم» — a yearly show is also searched by its federation alone (7.5 in Search Console for AEW WrestleDream, INCIDENTS #776). Structured data only.
        if (!archive) out.push(...federationForms(prog));
        // …and the category people type with no show in mind («تحميل عروض مصارعة», «عروض المصارعة الحرة مترجم»), and the part of a
        // sub-event's name after the show («tailgate مترجم» for «AEW WrestleDream Tailgate Brawl») — Search Console (INCIDENTS #800).
        // Structured data only.
        if (!archive) {
          out.push("تحميل عروض مصارعة", "تحميل عروض المصارعة", "عروض المصارعة الحرة مترجم", "عروض مصارعة مترجمة", "عروض المصارعة مترجم");
          const full = String(title || "").replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
          const tail = (full.toLowerCase().startsWith(prog.toLowerCase()) ? full.slice(prog.length) : prog.split(/\s+/).slice(2).join(" ")).trim().split(/\s+/).filter(Boolean);
          if (tail.length) for (const t of new Set([tail[0], tail.join(" ")])) if (/^[A-Za-z]{4,}/.test(t)) out.push(`${t} مترجم`, `${t} ${yr}`, `مشاهدة ${t}`);
        }
      } else if (!archive) {
        // A weekly episode (RAW, SmackDown…) is also searched without «عرض» or without «ال» («الرو الاخير», «رو مترجم»,
        // «عرض رو الاخير», «اخر عرض الرو») and by the English program name («wwe raw مترجم») — structured data only (INCIDENTS #508)
        const core = lead.replace(/^عرض\s+/, "");
        const bare = core.replace(/^ال(?=\S{2})/, "");
        const forms = [core, bare, `عرض ${bare}`];
        for (const f of new Set(forms)) out.push(`${f} الاخير`, `${f} مترجم`, `${f} الاخير مترجم`, `${f} الأخير مترجم كامل`);
        out.push(`${lead} الاخير`, `${lead} الأخير`, `${lead} مترجم عربي`, `${lead} الاخير كامل ومترجم`, `مشاهدة ${lead} الاخير مترجم`, `تحميل ${lead} الاخير`, `اخر ${bare}`,
          // «تحميل عرض الرو الاخير مترجم», «مشاهدة عرض الرو مترجم» — still in Search Console's problem list after the forms above
          `تحميل ${lead} الاخير مترجم`, `تحميل ${lead} مترجم`, `مشاهدة ${lead} مترجم`, `مشاهدة ${lead} الاخير`,
          // …with the hamza and «شاهد» («عرض سماك داون الأخير مترجم», «شاهد عرض الرو») — Search Console, INCIDENTS #759
          `${lead} الأخير مترجم`, `مشاهدة ${lead} الأخير مترجم`, `شاهد ${lead}`, `شاهد ${lead} مترجم`);
        // …with the year («عرض سماك داون الأخير 2026»), «الجديد» and «اون لاين» — still in Search Console's problem list (INCIDENTS #625)
        for (const f of new Set([core, bare, `عرض ${bare}`])) out.push(`${f} الاخير ${p.y}`, `${f} ${p.y} مترجم`, `${f} الجديد مترجم`, `${f} اون لاين`);
        out.push(`${lead} الاخير ${p.y}`, `${lead} ${p.y} مترجم`, `${lead} الجديد`, `${lead} اون لاين`, `${lead} الاخير اون لاين`, `${lead} الاخير مترجم ${p.y}`);
        // Visitors spell NXT in many ways («ان اكس تي», «اكس ان تي», «ان اكس اكس», «nxt»): each one with «عرض … مترجم» (INCIDENTS #514)
        if (/\bNXT\b/i.test(prog)) for (const v of ["ان اكس تي", "اكس ان تي", "ان اكس اكس", "اكس ان اكس", "اكس اكس ان", "ان ان اكس", "إن إكس تي", "NXT"]) out.push(`عرض ${v} مترجم`, `${v} مترجم`, `${v} الاخير مترجم`, `${v} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y} مترجم`);
        // …and the category people type when they have no program in mind («عروض المصارعة الحرة مترجم», INCIDENTS #550)
        out.push("عروض المصارعة الحرة مترجم", "عروض مصارعة حرة مترجمة");
        // …and its shorter spellings («عروض مصارعة مترجم», «عروض المصارعة مترجم»), still at 6–9 in Search Console (INCIDENTS #733)
        out.push("عروض مصارعة مترجم", "عروض المصارعة مترجم", "عروض المصارعة الاخيرة مترجم", "اخر عروض المصارعة مترجم");
        // …and without «مترجم» or with the ه spelling («عروض المصارعة» 7.3, «مصارعه مترجم» 10.7 in Search Console, INCIDENTS #769). Structured data only.
        // «الرو», «رو» and «عرض الرو» alone (positions 9.0–9.4 in Search Console for the 19.10 episode, INCIDENTS #778), and the name with the
        // dotted date. Structured data only.
        out.push(core, bare, lead, `${core} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`, `${core} ${p.d}/${p.m}/${p.y}`, `${core} ${p.y}`);
        // «عروض المصارعة الحرة» (8.9) and «اخر عرض الرو» (7.1) in Search Console for the 19.10 episode — structured data only.
        out.push("عروض المصارعة الحرة", "عروض المصارعة الحرة الاخيرة", `اخر ${lead}`, `آخر ${lead}`, `اخر ${lead} مترجم`, `اخر حلقة ${core}`);
        // «عرض الرو كامل» (5.0), «عرض الرو الاخير مترجم نتفلكس» (10.1) in Search Console for the 12.10 episode: «كامل» without «مترجم»
        // and the Netflix spelling people add to WWE's weekly shows (INCIDENTS #801). Structured data only.
        for (const f of new Set([core, bare, lead])) out.push(`${f} كامل`, `${f} كامل مترجم`, `مشاهدة ${f} كامل`, `تحميل ${f} كامل`);
        if (/^WWE\b/i.test(prog)) out.push(`${lead} نتفلكس`, `${lead} مترجم نتفلكس`, `${lead} الاخير مترجم نتفلكس`, `${lead} الاخير نتفلكس`, `${lead} على نتفلكس`);
        out.push("عروض المصارعة", "عروض المصارعه مترجم", "مصارعه مترجم", "مصارعة مترجمة", "مصارعة مترجم");
        // «عروض المصارعة الحرة مترجمة» (6.4, 10 impressions for the 19.10 episode in Search Console) — the feminine spelling of the category, INCIDENTS #828.
        out.push("عروض المصارعة الحرة مترجمة", "مشاهدة عروض المصارعة الحرة", "تحميل عروض المصارعة الحرة");
        if (/^[A-Za-z]/.test(prog)) out.push(`${prog} مترجم`, `${prog} الاخير`, `${prog} الاخير مترجم`, `${prog} كامل مترجم`);
        // «عرض aew dynamite الأخير» — «عرض» in front of the English program name, still in Search Console's problem list (INCIDENTS #710)
        if (/^[A-Za-z]/.test(prog)) out.push(`عرض ${prog}`, `عرض ${prog} الاخير`, `عرض ${prog} مترجم`, `عرض ${prog} الاخير مترجم`);
        out.push(...federationForms(prog));
        // «aew dynamite مشاهدة», «تحميل aew dynamite», «عرض aew dynamite 2026 مترجم» — the full English name with the words people add (INCIDENTS #754). Structured data only.
        if (/^[A-Za-z]/.test(prog)) out.push(`مشاهدة ${prog}`, `تحميل ${prog}`, `مشاهدة ${prog} مترجم`, `مشاهدة عرض ${prog}`, `تحميل عرض ${prog}`, `${prog} ${p.y} مترجم`, `عرض ${prog} ${p.y} مترجم`, `عرض ${prog} كامل مترجم`, `${prog} اون لاين`);
        // «smackdown مترجم», «raw مترجم» — the program's English name without the federation in front, still in Search Console's problem list (INCIDENTS #728)
        const shortProg = prog.replace(/^[A-Z]{2,5}\s+(?=[A-Za-z])/, "");
        if (shortProg !== prog && /^[A-Za-z]/.test(shortProg)) out.push(`${shortProg} مترجم`, `${shortProg} الاخير`, `${shortProg} الاخير مترجم`, `${shortProg} كامل مترجم`, `مشاهدة ${shortProg}`, `تحميل ${shortProg}`, `مشاهدة ${shortProg} مترجم`, `${shortProg} ${p.y} مترجم`);
        // «مشاهده عرض سماك داون الاخير كامل» and «عرض السماك داون الاخير» — still in Search Console's problem list for the 09.10 and 16.10 episodes (INCIDENTS #713)
        // «ملخص عرض سماك داون الاخير مترجم», «نتائج عرض سماك داون الاخير مترجم» — a weekly episode's page is also searched as its recap/results; still at 5–8 in Search Console (INCIDENTS #748). Structured data only.
        out.push(`ملخص ${lead} الاخير مترجم`, `نتائج ${lead} الاخير مترجم`, `ملخص ${lead} الاخير`, `نتائج ${lead} الاخير`, `نتائج ${lead} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
        out.push(`مشاهده ${lead} الاخير كامل`, `مشاهدة ${lead} الاخير كامل`, `${lead} الاخير كامل مترجم`, `عرض ال${bare} الاخير`, `عرض ال${bare} الاخير مترجم`);
        // «عرض ماين ايفنت 2026 مترجم», «عرض الرو الاخير 2026 مترجم» — the Arabic name with the year, the way people search a weekly program; Main Event/Dynamite/NXT were at 9–12 in Search Console (INCIDENTS #810). Structured data only.
        out.push(`${lead} ${p.y} مترجم`, `${lead} الاخير ${p.y}`, `${lead} الاخير ${p.y} مترجم`, `اخر ${lead} ${p.y}`);
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
    const names = [core, core.replace(/^ال(?=\S{2})/, "")].map((n) => (yrRaw ? n.replace(new RegExp(`\\s*${yrRaw}$`), "") : n)).filter(Boolean);
    for (const n of new Set(names)) {
      out.push(`ملخص ${n}`, `ملخص ${n} مترجم`, `نتائج ${n}`, `ملخص ${n} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`);
      if (yrRaw) out.push(`ملخص ${n} ${yrRaw}`, `ملخص ${n} ${yrRaw} مترجم`, `ملخص عرض ${n} ${yrRaw}`, `نتائج ${n} ${yrRaw}`);
      // …and the words that go with it («مشاهدة ملخص عرض موني ان ذا بانك 2026», «ملخص عرض … 2026 مترجم كامل»), structured data only (INCIDENTS #621)
      out.push(`مشاهدة ملخص ${n}`, `تحميل ملخص ${n}`, `ملخص ${n} كامل مترجم`, `ملخص عرض ${n} مترجم`);
      // A weekly program's recap is searched as «the latest»: «ملخص الرو الاخير», «اخر ملخص عرض الرو» (INCIDENTS #719)
      if (!yrRaw) out.push(`ملخص ${n} الاخير`, `ملخص ${n} الاخير مترجم`, `اخر ملخص ${n}`, `ملخص عرض ${n} الاخير`);
      if (yrRaw) out.push(`ملخص عرض ${n} ${yrRaw} مترجم`, `مشاهدة ملخص ${n} ${yrRaw}`, `تحميل ملخص ${n} ${yrRaw}`, `ملخص ${n} ${yrRaw} كامل مترجم`);
    }
    const en = prog.replace(/\s*highlights?\s*$/i, "").trim();
    if (/^[A-Za-z]/.test(en)) {
      const y = yrRaw || p.y;
      out.push(`${en} ${y} highlights`, `${en} ${y} results`, `${en} ${y} مترجم`, `${en} highlights ${EN_MONTHS[p.m - 1]} ${p.d} ${p.y}`);
      if (/^WWE\s/i.test(en)) out.push(`${en.replace(/^WWE\s+/i, "")} ${y} highlights`);
      // A yearly show's recap is also found by the show's own words («عرض موني ان ذا بانك 2026 مترجم», «money in the bank 2026 مترجم»,
      // «تحميل عرض money in the bank 2026») — it sat at 6–14 for them in Search Console (INCIDENTS #641). Structured data only.
      if (yrRaw) {
        const enBare = en.replace(/^WWE\s+/i, "");
        for (const n of new Set(names)) out.push(`عرض ${n} ${yrRaw}`, `عرض ${n} ${yrRaw} مترجم`);
        out.push(`${enBare} ${yrRaw} مترجم`, `عرض ${enBare} ${yrRaw}`, `تحميل عرض ${enBare} ${yrRaw}`);
        // …and with «مشاهدة / تحميل» in front of the Arabic name («مشاهدة عرض موني ان ذا بانك 2026», rank 4–9 for the library and recap pages in Search Console, INCIDENTS #796). Structured data only.
        for (const n of new Set(names)) out.push(`مشاهدة عرض ${n} ${yrRaw}`, `تحميل عرض ${n} ${yrRaw}`, `مشاهدة عرض ${n} ${yrRaw} مترجم`, `${n} ${yrRaw} مترجم`);
        out.push(`مشاهدة عرض ${enBare}`, `${enBare} ${yrRaw} تحميل`, `${enBare} ${yrRaw} كامل مترجم`);
      }
      out.push(`${en} ${y} full show highlights`, `${en} ${y} highlights مترجم`);
    }
  }
  // The page's names (the program's aliases) are already in the structured data: a form that repeats one is dropped, so the list has no duplicates (INCIDENTS #704)
  const have = new Set((aliases || []).map((a) => String(a || "").trim()));
  return withSpellingVariants([...new Set(out)]).filter((f) => !have.has(f));
}

/**
 * Visitors also write the program names joined or with the other vowel spelling: «عرض سماكداون الاخير مترجم» (the library page
 * was at 8.6 for it), «عرض الراو مترجم». Every Arabic form that carries the usual spelling gets the other one too — structured
 * data only, nothing visible (INCIDENTS #628).
 */
function withSpellingVariants(forms) {
  const out = [...forms];
  for (const f of forms) {
    if (!/[؀-ۿ]/.test(f)) continue;
    const j = f.replace(/سماك داون/g, "سماكداون");
    if (j !== f) out.push(j);
    const r = f.replace(/(^|\s)(ال)?رو(?=\s|$)/g, "$1$2راو");
    if (r !== f) out.push(r);
    // «عرض مونى ان ذا بانك … كامل مترجم» — Money in the Bank written with a final alef maqsura, a query Search Console showed at rank 3.5 (INCIDENTS #734)
    const mo = f.replace(/(^|\s)موني(?=\s)/g, "$1مونى");
    if (mo !== f) out.push(mo);
    // «عرض ماين ايفنت الاخير» / «مين ايفنت» and «ايفلوف» — the other common ways to write Main Event and Evolve (INCIDENTS #735)
    const me = f.replace(/ما?ين ايفنت/g, (m) => (m.startsWith("ما") ? "مين ايفنت" : "ماين ايفنت"));
    if (me !== f) out.push(me);
    const ev = f.replace(/ايفولف/g, "ايفلوف");
    if (ev !== f) out.push(ev);
  }
  return [...new Set(out)];
}

// Visitors name a weekly program by its federation alone («عرض aew الاخير», «تي إن إيه»): the federation in Latin letters and
// in the Arabic letters people type it with, plus the words that go with a show — structured data only (INCIDENTS #642).
const FEDERATION_AR = {
  WWE: ["دبليو دبليو اي", "دبليو دبليو إي"],
  AEW: ["ايه اي دبليو", "إيه إي دبليو"],
  TNA: ["تي ان ايه", "تي إن إيه"],
  ROH: ["ار او اتش", "آر أو إتش"],
  NJPW: ["نيو جابان", "نيو جاپان"],
  NWA: ["ان دبليو ايه", "إن دبليو إيه"],
  MLW: ["ام ال دبليو", "إم إل دبليو"],
};
function federationForms(programName) {
  const parts = String(programName || "").trim().split(/\s+/);
  const fed = parts.length >= 2 && /^[A-Z]{2,5}$/.test(parts[0]) ? parts[0] : "";
  if (!fed) return [];
  const names = [fed, ...(FEDERATION_AR[fed] || [])];
  const out = [];
  for (const n of names) out.push(`عرض ${n} الاخير`, `عرض ${n} الأخير مترجم`, `عرض ${n} مترجم`, `${n} مترجم`, `عروض ${n} مترجم`, `${n} مترجم كامل`,
    // «wwe مشاهدة», «تحميل wwe» — the federation with the words people add (4.9–8.3 in Search Console, INCIDENTS #818). Structured data only.
    `${n} مشاهدة`, `مشاهدة ${n}`, `${n} تحميل`, `تحميل ${n}`, `${n} مشاهدة مترجم`);
  for (const n of names.slice(1)) out.push(n, `عرض ${n}`);
  return out;
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
    if (yr) out.push(`${n} ${yr}`, `${n} ${yr} مترجم`, `${n} ${yr} كامل`, `مشاهدة ${n} ${yr}`, `مشاهده ${n} ${yr}`, `تحميل ${n} ${yr}`, `مشاهدة ${n} ${yr} مترجم`, `تحميل ${n} ${yr} مترجم`, `${n} ${yr} كامل مترجم`);
  }
  // A yearly program's library page is also searched with the year first and the verb last («money in the bank 2026 تحميل», «عرض موني ان ذا بانك 2026 اون لاين»)
  // — still at 4–14 in Search Console (INCIDENTS #753). Structured data only.
  if (yr) for (const n of [ar, /^[A-Za-z]/.test(enShort) ? `عرض ${enShort}` : "", /^[A-Za-z]/.test(enShort) ? enShort : ""].filter(Boolean)) out.push(`${n} ${yr} تحميل`, `${n} ${yr} مشاهدة`, `${n} ${yr} اون لاين`, `${n} ${yr} مترجم اون لاين`);
  // …and the Arabic name without «عرض» («موني ان ذا بانك 2026», «موني ان ذا بانك 2026 مترجم») (INCIDENTS #626)
  const arBare = ar.replace(/^عرض\s+/, "");
  if (yr && arBare && arBare !== ar) out.push(`${arBare} ${yr}`, `${arBare} ${yr} مترجم`, `${arBare} ${yr} كامل`, `مشاهدة ${arBare} ${yr}`, `تحميل ${arBare} ${yr}`);
  if (en && /^[A-Za-z]/.test(en)) {
    out.push(`${en} مترجم`, `مشاهدة عرض ${en}`, `تحميل عرض ${en}`, ...(yr ? [`${en} ${yr} مترجم`, `${en} ${yr} تحميل`, `تحميل عرض ${en} ${yr}`, `مشاهدة عرض ${en} ${yr}`, `${en} ${yr} full show`] : []));
  }
  // A weekly program's page answers «عرض دايناميت 7/10/2026» and «AEW Dynamite October 7 2026» for its newest episode (INCIDENTS #515)
  const lp = count >= 4 ? partsOf(latest, "") : null;
  if (lp) {
    for (const n of [ar, /^[A-Za-z]/.test(enShort) ? `عرض ${enShort}` : ""].filter(Boolean)) out.push(`${n} ${lp.d}/${lp.m}/${lp.y}`, `${n} ${lp.d} ${AR_MONTHS[lp.m - 1]} ${lp.y}`, `${n} ${String(lp.d).padStart(2, "0")}.${String(lp.m).padStart(2, "0")}.${lp.y} مترجم`);
    if (/^[A-Za-z]/.test(en)) out.push(`${en} ${EN_MONTHS[lp.m - 1]} ${lp.d} ${lp.y}`, `${en} ${lp.m}/${lp.d}/${lp.y}`, `${en} ${EN_MONTHS[lp.m - 1]} ${lp.d} ${lp.y} مترجم`);
  }
  if (count >= 4) out.push(...federationForms(en));
  if (arPlain && /^WWE\b/i.test(en)) out.push(`دبليو دبليو إي ${arPlain}`, ...(yr ? [`دبليو دبليو إي ${arPlain} ${yr}`] : []));
  // a name that already ends with the year («NJPW King Of Pro Wrestling 2026») must not get it twice
  return withSpellingVariants([...new Set(out.map((f) => f.replace(/\b(20\d\d) \1\b/g, "$1")))]);
}

module.exports = { showSeoText, recapSeoText, showNameParts, showNameForms, libraryNameForms };
