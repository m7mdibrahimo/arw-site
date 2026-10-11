// «عن العرض» under a show's download links (owner 2026-10-11, INCIDENTS #435): a few true sentences and the show's
// facts, so the page says in words what it is. The site at the top of Google has ~800 words about each show; ours had
// the player and the links only, and Google had nothing to read. Everything comes from the show's own fields and its
// results story — nothing is made up, nothing repeats keywords — and the results link warns that it spoils.
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** «01:35:55» → «ساعة و35 دقيقة» (Modern Standard Arabic, the site's UI language). */
function durationWords(duration) {
  const parts = String(duration || "").trim().split(":").map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return "";
  const [h, m] = parts.length === 3 ? parts : [0, parts[0]];
  const hours = h === 0 ? "" : h === 1 ? "ساعة" : h === 2 ? "ساعتان" : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
  const mins = m === 0 ? "" : m === 1 ? "دقيقة" : m === 2 ? "دقيقتان" : m <= 10 ? `${m} دقائق` : `${m} دقيقة`;
  return [hours, mins].filter(Boolean).join(" و");
}

function serversWords(n) {
  if (!n) return "";
  if (n === 1) return "سيرفر واحد";
  if (n === 2) return "سيرفرين";
  return n <= 10 ? `${n} سيرفرات` : `${n} سيرفرًا`;
}

// Each Latin item («720p») in its own direction island (FSI…PDI): unwrapped, «360p و480p و720p» came out reordered
const iso = (x) => /[A-Za-z0-9]/.test(x) ? `\u2068${x}\u2069` : x;
const joinAr = (list) => { const l = list.map(iso); return l.length <= 1 ? (l[0] || "") : `${l.slice(0, -1).join(" و")} و${l[l.length - 1]}`; };

function weekdayOf(eventDate) {
  const d = eventDate instanceof Date ? eventDate : new Date(String(eventDate || "").slice(0, 10) + "T12:00:00Z");
  return isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()];
}

/** The results story the news bots wrote for this show: «نتائج عرض WWE SmackDown (9 أكتوبر 2026): …». */
function findResults(news, programName, day) {
  const prog = String(programName || "").toLowerCase().trim();
  if (!prog || !day) return null;
  for (const item of news || []) {
    const t = String((item.data && item.data.title) || "");
    if (t.includes("نتائج") && t.toLowerCase().includes(prog) && t.includes(day)) return { url: item.url, title: t };
  }
  return null;
}

/**
 * Everything the section shows, or null when the show has too little to say (no date or no name).
 * `name` is the Arabic name without date («عرض سماك داون»), `day` the written date («9 أكتوبر 2026»).
 */
function showAbout({ name, dot, programName, federation, eventDate, day, duration, servers, qualities, description, results }) {
  if (!name || !day) return null;
  const weekday = weekdayOf(eventDate);
  const when = `${weekday ? `${weekday} ` : ""}${day}`;
  const dur = durationWords(duration);
  const srv = serversWords(servers || 0);
  const q = joinAr(qualities || []);
  const prog = String(programName || "").trim();
  const own = description && !/^عرض .* مترجم بالكامل مع جميع النزالات والأحداث\.?$/.test(String(description).trim()) ? String(description).trim() : "";
  const lead = `يقدّم عرب راسلنج ${name}${prog && !name.includes(prog) ? ` (${prog})` : ""} الذي أقيم يوم ${when} مترجمًا إلى العربية كاملًا${dur ? `، ومدته ${dur}` : ""}.`;
  const watch = srv || q ? `شاهد العرض أونلاين${srv ? ` عبر ${srv}` : ""}${q ? `${srv ? "، أو" : " أو"} حمّله بجودة ${q}` : ""}.` : "";
  const facts = [
    federation && ["الاتحاد", federation],
    prog && ["البرنامج", prog],
    ["تاريخ العرض", when],
    dur && ["المدة", dur],
    srv && ["المشاهدة", `أونلاين عبر ${srv}`],
    q && ["التحميل", q],
  ].filter(Boolean);
  return {
    heading: `عن ${name}${dot ? ` ${dot}` : ""} كامل مترجم`,
    paragraphs: [own, `${lead} ${watch}`.trim()].filter(Boolean),
    facts,
    results: results || null,
  };
}

module.exports = { showAbout, findResults, durationWords };
