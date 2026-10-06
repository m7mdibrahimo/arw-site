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
    // the name without a year: the dates under it carry the year
    const name = (/[\u0600-\u06FF]/.test(g.arLabel) ? g.arLabel : g.label).replace(/\s+(19|20)\d{2}$/, "");
    const roadShows = g.shows.slice().sort(function(a, b) { return time(b) - time(a); });
    return {
      name: name, range: range(g.first, g.last),
      kind: g.road ? (g.main ? "tour" : "tour-open") : (g.shows.length > 1 ? "nights" : "single"),
      main: g.main, shows: roadShows, count: roadShows.length + (g.main ? 1 : 0),
      // the cards in page order, each with its small label: the big event first, then the tour newest first
      cards: (g.main ? [{ item: g.main, tag: "العرض الكبير", main: true }] : []).concat(roadShows.map(function(x, i) {
        // no night numbers: the site may not carry every night, so «الليلة 7» could be wrong
        return { item: x, main: false, tag: g.road ? "الطريق إلى العرض" : "" };
      })),
      first: new Date(g.first), last: new Date(g.last),
    };
  }).sort(function(a, b) { return b.last - a.last; });
}

module.exports = { tourGroups };
