// The BroadcastEvent's startDate of a show page. A show's event_date is a bare date («2026-11-13»), which YAML reads as
// midnight UTC — that is 7 pm Eastern the evening BEFORE, so the structured data put every US show on the wrong day for
// the Americas (and SmackDown 13.11 «started» on 12 November in New York). A bare date now becomes the program's usual
// local air time in its home time zone, with the right offset (daylight saving included): US promotions 8 pm New York,
// Japanese ones 6:30 pm Tokyo, Mexican ones 8:30 pm Mexico City, British ones 7:30 pm London. A date that already
// carries a real time is kept as it is. Head only (INCIDENTS #1375).
"use strict";

const ZONES = [
  { re: /^(njpw|ajpw|stardom|marigold|tjpw|noah|ddt|dragongate|dragon-gate)\b/, tz: "Asia/Tokyo", time: "18:30" },
  { re: /^(cmll|aaa|lucha|lucha-libre-aaa)\b/, tz: "America/Mexico_City", time: "20:30" },
  { re: /^(progress|revpro|rev-pro)\b/, tz: "Europe/London", time: "19:30" },
];
const DEFAULT = { tz: "America/New_York", time: "20:00" };

function offsetOf(tz, at) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName");
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part ? part.value : "");
  return m ? `${m[1]}${m[2]}:${m[3] || "00"}` : "+00:00";
}

function airStart(date, url) {
  if (date === undefined || date === null || date === "") return date;
  const raw = date instanceof Date ? date : new Date(String(date));
  if (isNaN(raw.getTime())) return date;
  const bare = typeof date === "string" ? /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
    : raw.getUTCHours() === 0 && raw.getUTCMinutes() === 0 && raw.getUTCSeconds() === 0 && raw.getUTCMilliseconds() === 0;
  if (!bare) return raw.toISOString();
  const slug = String(url || "").replace(/\/+$/, "").split("/").pop() || "";
  const zone = ZONES.find((z) => z.re.test(slug)) || DEFAULT;
  const day = raw.toISOString().slice(0, 10);
  // the offset at noon UTC of that day: daylight saving never changes at noon
  return `${day}T${zone.time}:00${offsetOf(zone.tz, new Date(`${day}T12:00:00Z`))}`;
}

module.exports = { airStart };
