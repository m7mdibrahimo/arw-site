// The time a page really went up on the site and the time it last really changed — for its head only:
// datePublished / dateModified (JSON-LD), article:published_time / article:modified_time / og:updated_time, the
// VideoObject's uploadDate and the sitemap's <lastmod>. Nothing visible reads this.
//
// Why (INCIDENTS #1257): AEW Dynamite 11.11.2026 went up on 12 November at 13:07 Cairo time, and minutes later Google
// showed it as «قبل يوم واحد»: the VideoObject said `datePublished: 2026-11-11T00:00:00Z` — the night it aired, not when
// the page was published. The air date now lives only where it belongs: the BroadcastEvent's startDate/endDate.
//
// Where the real times come from, best first:
//   published_at  stamped by the news bots when a story reaches the site; never changes afterwards. A live-results
//                 report re-stamps `date` on every update (scripts/live-results-updater.ts), so for news `date` can be
//                 LATER than the first publication: published_at wins, and the later `date` is the last change.
//   created_at    stamped by the panel (worker/src/studio.ts) and the English edition when the file is first written.
//                 A page dated later than that («مجدول») goes public at its date, so the later of the two.
//   first commit  pages written before either stamp existed: lib/first-commit.json (scripts/first-commit-map.mjs) holds
//                 the first git commit of every file that reached the repo more than 30 minutes after its own date
//                 (an English story written hours after its Arabic twin keeps the Arabic date in `date`). Read from a
//                 file, never from git at build time: the build's clone may be shallow, where every file would look
//                 «added» by the newest commit.
//   date          everything else — for nearly every page it is within minutes of the first commit.
// The last change is the latest of all of these plus `url_changed` (a title edit that moved the page) and `edited_at`
// (stamped by the panel on every real edit).

const path = require("path");

let firstCommit = null;
function firstCommitOf(inputPath) {
  if (!firstCommit) {
    try { firstCommit = require("./first-commit.json"); } catch { firstCommit = {}; }
  }
  return firstCommit[inputPath] || "";
}

const time = (v) => {
  if (v == null || v === "") return NaN;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
};

/** { published, modified } in ms for one page. `data` holds its front matter (published_at, created_at, edited_at, url_changed). */
function pageTimes(inputPath, date, data = {}, commitOf = firstCommitOf) {
  const d = time(date), pub = time(data.published_at), created = time(data.created_at);
  let published;
  if (Number.isFinite(pub)) published = pub;
  else if (Number.isFinite(created)) published = Number.isFinite(d) ? Math.max(created, d) : created;
  else {
    const first = time(commitOf(String(inputPath || "").replace(/^\.\//, "").split(path.sep).join("/")));
    published = Number.isFinite(d) ? (Number.isFinite(first) ? Math.max(first, d) : d) : (Number.isFinite(first) ? first : Date.now());
  }
  const modified = Math.max(published, ...[d, time(data.url_changed), time(data.edited_at)].filter(Number.isFinite));
  return { published, modified };
}

const TZ = "Africa/Cairo";
const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** «2026-11-12T13:07:19+02:00»: an ISO time with the site's own offset (Cairo, summer time included). */
function isoZoned(v) {
  const t = time(v);
  if (!Number.isFinite(t)) return "";
  const ms = Math.floor(t / 1000) * 1000;
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((local - ms) / 60000);
  const sign = off < 0 ? "-" : "+";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0"), mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/** Both times as ISO strings with the Cairo offset, for the head. */
function pageDates(inputPath, date, data) {
  const { published, modified } = pageTimes(inputPath, date, data || {});
  return { published: isoZoned(published), modified: isoZoned(modified), modifiedMs: modified };
}

module.exports = { pageTimes, pageDates, isoZoned };
