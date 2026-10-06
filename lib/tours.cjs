// Tours for programs that run as tours, not a weekly show (NJPW, owner 2026-10-06; INCIDENTS #309): the library
// page shows the big event with the «Road To» shows that built to it, a multi-night event's nights together, and a
// one-off event alone.
/** The tours of a program, newest first: each big event with the «Road To» shows that led to it, a multi-night
 *  event's nights together, and a one-off event alone. Built from the English titles («NJPW Road To Destruction
 *  05.09.2026», «NJPW Destruction in Kobe (2026)», «NJPW G1 Climax 36 09.08.2026»), so it holds whatever the
 *  Arabic headline says. */
function tourGroups(shows, arPrefix) {
  const core = function(t) { return String(t || "").replace(/^NJPW\s+/i, "").replace(/\(\s*\d{4}\s*\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s+/g, " ").trim(); };
  const arCore = function(h) {
    let x = String(h || "").replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, "");
    if (arPrefix) x = x.replace(new RegExp("^\\s*" + arPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*"), "");
    return x.replace(/\s+/g, " ").trim();
  };
  const DAY = 86400000, time = function(e) { return new Date(e.eventDate || e.timestamp).getTime(); };
  const groups = [];
  shows.slice().sort(function(a, b) { return time(a) - time(b); }).forEach(function(s) {
    const c = core(s.title), road = /^Road\s+To\s+/i.test(c), target = (road ? c.replace(/^Road\s+To\s+/i, "") : c).toLowerCase();
    const t = time(s);
    if (road) {
      let g = groups.find(function(x) { return x.road && !x.main && x.key === target && t - x.last <= 21 * DAY; });
      if (!g) { g = { key: target, road: true, main: null, shows: [], first: t, last: t, label: c, arLabel: arCore(s.headline) }; groups.push(g); }
      g.shows.push(s); g.last = t;
      return;
    }
    // the big event a tour built to: «Destruction in Kobe» closes the open «Road To Destruction» tour
    const tour = groups.find(function(x) { return x.road && !x.main && target.indexOf(x.key) === 0 && t >= x.last && t - x.last <= 21 * DAY; });
    if (tour) { tour.main = s; tour.last = t; tour.label = c; tour.arLabel = arCore(s.headline) || tour.arLabel; return; }
    // another night of the same event (G1 Climax 36 night after night)
    let g = groups.find(function(x) { return !x.road && x.key === target && t - x.last <= 45 * DAY; });
    if (!g) { g = { key: target, road: false, main: null, shows: [], first: t, last: t, label: c, arLabel: arCore(s.headline) }; groups.push(g); }
    g.shows.push(s); g.last = t;
  });
  const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  // «5 – 27 سبتمبر 2026», «28 أغسطس – 3 سبتمبر 2026», or one day
  const range = function(a, b) {
    const x = new Date(a), y = new Date(b);
    const d1 = x.getUTCDate(), m1 = x.getUTCMonth(), y1 = x.getUTCFullYear(), d2 = y.getUTCDate(), m2 = y.getUTCMonth(), y2 = y.getUTCFullYear();
    if (d1 === d2 && m1 === m2 && y1 === y2) return d1 + " " + MONTHS[m1] + " " + y1;
    if (m1 === m2 && y1 === y2) return d1 + " – " + d2 + " " + MONTHS[m1] + " " + y1;
    if (y1 === y2) return d1 + " " + MONTHS[m1] + " – " + d2 + " " + MONTHS[m2] + " " + y1;
    return d1 + " " + MONTHS[m1] + " " + y1 + " – " + d2 + " " + MONTHS[m2] + " " + y2;
  };
  return groups.map(function(g) {
    // the event's own English name, with its year (owner, 2026-10-06): «Destruction in Kobe 2026»,
    // «G1 Climax 36 (2026)» — a name that already ends in a number takes the year in brackets
    const year = new Date(g.last).getUTCFullYear();
    const en = String(g.label || "").replace(/\s+(19|20)\d{2}$/, "").trim();
    const nameEn = /\d$/.test(en) ? en + " (" + year + ")" : en + " " + year;
    const name = (/[\u0600-\u06FF]/.test(g.arLabel) ? g.arLabel : g.label).replace(/\s+(19|20)\d{2}$/, "");
    const roadShows = g.shows.slice().sort(function(a, b) { return time(b) - time(a); });
    // the tour's shows in date order are its nights: «الليلة الأولى», «الليلة الثانية»…
    const night = {};
    g.shows.slice().sort(function(a, b) { return time(a) - time(b); }).forEach(function(x, i) { night[x.url || i] = nightLabel(i + 1); });
    const nightOf = function(x) { return g.shows.length > 1 || g.main ? night[x.url] || "" : ""; };
    return {
      name: name, nameEn: nameEn, nameEnShort: en, year: year, range: range(g.first, g.last),
      kind: g.road ? (g.main ? "tour" : "tour-open") : (g.shows.length > 1 ? "nights" : "single"),
      main: g.main, shows: roadShows, count: roadShows.length + (g.main ? 1 : 0), nightOf: nightOf,
      // the cards in page order: the big event first, then its nights newest first
      cards: (g.main ? [{ item: g.main, tag: "العرض الكبير", main: true }] : []).concat(roadShows.map(function(x) {
        return { item: x, main: false, tag: nightOf(x) };
      })),
      first: new Date(g.first), last: new Date(g.last),
    };
  }).sort(function(a, b) { return b.last - a.last; });
}

const ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة",
  "الحادية عشرة", "الثانية عشرة", "الثالثة عشرة", "الرابعة عشرة", "الخامسة عشرة", "السادسة عشرة", "السابعة عشرة",
  "الثامنة عشرة", "التاسعة عشرة", "العشرون"];
/** «الليلة الأولى» … «الليلة العشرون», then «الليلة 21». */
function nightLabel(n) { return "الليلة " + (ORDINALS[n - 1] || n); }

/** Tour federations: a show whose program starts with one of these gets its tour's own program — «NJPW Destruction
 *  in Kobe 2026», «NJPW G1 Climax 36 (2026)» — so each tour is its own section in the library, in the breadcrumb and
 *  in the show page's list (owner, 2026-10-06). The dashboard keeps saving «NJPW»; the site works out the tour. */
const TOUR_FEDERATIONS = ["NJPW"];
let tourCache = null;
function tourProgramOf(fileName, programName, dir) {
  const fed = TOUR_FEDERATIONS.find(function(f) { return new RegExp("^" + f + "(\\s|$)", "i").test(String(programName || "").trim()); });
  if (!fed) return null;
  const fs = require("fs"), path = require("path"), matter = require("gray-matter");
  dir = dir || path.join(__dirname, "..", "content", "shows");
  if (!tourCache || tourCache.dir !== dir) {
    const shows = [];
    for (const f of fs.readdirSync(dir).filter(function(x) { return x.endsWith(".md"); })) {
      try {
        const d = matter(fs.readFileSync(path.join(dir, f), "utf8")).data;
        if (!new RegExp("^" + fed + "(\\s|$)", "i").test(String(d.program_name || "").trim())) continue;
        const date = d.event_date || d.date;
        shows.push({ url: f, title: d.title || "", headline: d.headline || "", eventDate: date instanceof Date ? date.toISOString().slice(0, 10) : String(date || ""), timestamp: new Date(date).getTime() });
      } catch (e) {}
    }
    const map = {};
    tourGroups(shows, "").forEach(function(t) {
      const name = fed + " " + t.nameEn;
      (t.main ? [t.main] : []).concat(t.shows).forEach(function(x) { map[x.url] = name; });
    });
    tourCache = { dir: dir, map: map };
  }
  return tourCache.map[fileName] || null;
}

module.exports = { tourGroups, nightLabel, tourProgramOf };
