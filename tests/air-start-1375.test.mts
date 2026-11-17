import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { airStart } = require("../lib/air-start.cjs");

test("a show's bare air date starts at the program's local evening, never midnight UTC (INCIDENTS #1375)", () => {
  // SmackDown 13.11.2026: midnight UTC was 7 pm on 12 November in New York — the wrong day
  assert.equal(airStart(new Date("2026-11-13T00:00:00Z"), "/shows/wwe-smackdown-13-11-2026/"), "2026-11-13T20:00:00-05:00");
  assert.equal(airStart("2026-07-06", "/shows/wwe-raw-06-07-2026/"), "2026-07-06T20:00:00-04:00");
  assert.equal(airStart(new Date("2026-11-13T00:00:00Z"), "/shows/cmll-viernes-espectacular-13-11-2026/"), "2026-11-13T20:30:00-06:00");
  assert.equal(airStart(new Date("2026-10-13T00:00:00Z"), "/shows/njpw-king-of-pro-wrestling-2026/"), "2026-10-13T18:30:00+09:00");
  assert.equal(airStart(new Date("2026-11-01T00:00:00Z"), "/shows/progress-chapter-190/"), "2026-11-01T19:30:00+00:00");
  // the day itself never moves, and the end still adds the duration
  const start = airStart(new Date("2026-11-13T00:00:00Z"), "/shows/wwe-smackdown-13-11-2026/");
  assert.equal(new Date(start).toISOString(), "2026-11-14T01:00:00.000Z");
  // a date with a real time is kept
  assert.equal(airStart(new Date("2026-11-13T23:30:00Z"), "/shows/x/"), "2026-11-13T23:30:00.000Z");
  assert.equal(airStart(undefined, "/shows/x/"), undefined);
  const tpl = fs.readFileSync("_includes/post-layout.njk", "utf8");
  assert.match(tpl, /\| airStart\(page\.url\) %\}"startDate": \{\{ ldStart \| jsonify \| safe \}\}\{% set ldEnd = ldStart \| eventEnd\(duration\) %\}/);
});
