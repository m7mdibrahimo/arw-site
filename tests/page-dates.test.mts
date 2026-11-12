import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pageTimes, pageDates, isoZoned } = require("../lib/page-dates.cjs");
const iso = (ms: number) => new Date(ms).toISOString();
const none = () => "";

// INCIDENTS #1257: AEW Dynamite 11.11.2026 went up on 12 November at 13:07 Cairo time and Google showed it as «قبل يوم
// واحد» minutes later: the VideoObject's datePublished was the air date (2026-11-11T00:00:00Z).
test("a show added from the panel is published when it was saved, not when it aired or when the form opened", () => {
  const t = pageTimes("./content/shows/x.md", new Date("2026-11-12T13:03:05+02:00"), { created_at: "2026-11-12T11:07:19.000Z" }, none);
  assert.equal(iso(t.published), "2026-11-12T11:07:19.000Z");
  assert.equal(iso(t.modified), "2026-11-12T11:07:19.000Z");
  // dated later in the panel («مجدول»): it goes public at its date
  const later = pageTimes("x", new Date("2026-11-13T20:00:00Z"), { created_at: "2026-11-12T11:07:19.000Z" }, none);
  assert.equal(iso(later.published), "2026-11-13T20:00:00.000Z");
});

test("a news story is published when it reached the site; a live-results update is its last change, not a new publication", () => {
  // the bot's published_at never changes; scripts/live-results-updater.ts re-stamps `date` on every update
  const t = pageTimes("x", new Date("2026-11-12T03:40:00Z"), { published_at: "2026-11-12T01:05:00.000Z" }, none);
  assert.equal(iso(t.published), "2026-11-12T01:05:00.000Z");
  assert.equal(iso(t.modified), "2026-11-12T03:40:00.000Z");
  // a source dated hours before it reached the site
  const late = pageTimes("x", new Date("2026-11-11T20:00:00Z"), { published_at: "2026-11-12T01:05:00.000Z" }, none);
  assert.equal(iso(late.published), "2026-11-12T01:05:00.000Z");
});

test("a page with no stamp falls back to its first commit when that is later than its date, else its date", () => {
  const map = (p: string) => (p === "content/news-en/a.md" ? "2026-10-08T05:00:00.000Z" : "");
  assert.equal(iso(pageTimes("./content/news-en/a.md", new Date("2026-10-07T21:00:00Z"), {}, map).published), "2026-10-08T05:00:00.000Z");
  assert.equal(iso(pageTimes("./content/news/b.md", new Date("2026-10-07T21:00:00Z"), {}, map).published), "2026-10-07T21:00:00.000Z");
  // the real map: an English story written hours after its Arabic twin
  const real = JSON.parse(fs.readFileSync("lib/first-commit.json", "utf8"));
  const [file, when] = Object.entries(real).find(([f]) => f.startsWith("content/news-en/"))! as [string, string];
  const date = (fs.readFileSync(file, "utf8").match(/^date:\s*(.+)$/m) || [])[1];
  assert.ok(Date.parse(when) - Date.parse(date) > 30 * 60_000);
  assert.equal(pageDates("./" + file, new Date(date), {}).published, isoZoned(when));
});

test("an edit or a new address moves only the last change", () => {
  const t = pageTimes("x", new Date("2026-09-27T05:22:00Z"), { created_at: "2026-09-27T05:30:00Z", url_changed: "2026-11-09T04:33:25Z", edited_at: "2026-11-10T08:00:00Z" }, none);
  assert.equal(iso(t.published), "2026-09-27T05:30:00.000Z");
  assert.equal(iso(t.modified), "2026-11-10T08:00:00.000Z");
});

test("head times carry the Cairo offset, winter and summer", () => {
  assert.equal(isoZoned("2026-11-12T11:07:19.000Z"), "2026-11-12T13:07:19+02:00");
  assert.equal(isoZoned(new Date("2026-07-01T09:00:00Z")), "2026-07-01T12:00:00+03:00");
  assert.equal(isoZoned(""), "");
});

test("the page head never dates the page or its video by the air date; the air date stays on the BroadcastEvent", () => {
  const tpl = fs.readFileSync("_includes/post-layout.njk", "utf8");
  assert.match(tpl, /\{% set pd = page\.inputPath \| pageDates\(page\.date, \{ published_at: published_at, created_at: created_at, edited_at: edited_at, url_changed: url_changed \}\) %\}/);
  assert.match(tpl, /<meta property="article:published_time" content="\{\{ pd\.published \}\}">/);
  assert.match(tpl, /<meta property="article:modified_time" content="\{\{ pd\.modified \}\}">/);
  assert.match(tpl, /<meta property="og:updated_time" content="\{\{ pd\.modified \}\}">/);
  assert.match(tpl, /"datePublished": \{\{ pd\.published \| jsonify \| safe \}\},\n\s*"dateModified": \{\{ pd\.modified \| jsonify \| safe \}\},/);
  assert.match(tpl, /"uploadDate": \{\{ pd\.published \| jsonify \| safe \}\}/);
  // no date signal is ever the event date, except the broadcast's own start (and end)
  for (const line of tpl.split("\n").filter((l) => /event_date|eventDate/.test(l))) {
    assert.doesNotMatch(line, /"(datePublished|dateModified|uploadDate|dateCreated)"\s*:\s*\{\{\s*\(?\s*(eventDate|event_date)/, line.slice(0, 120));
  }
  assert.match(tpl, /"startDate": \{\{ \(eventDate or event_date\) \| jsonify \| safe \}\}/);
  assert.doesNotMatch(tpl, /page\.date\.toISOString\(\)/);
  assert.match(fs.readFileSync("pages/sitemap.njk", "utf8"), /<lastmod>\{\{ \(item\.inputPath \| pageDates\(item\.date, item\.data\)\)\.modifiedMs \| isoDay \}\}<\/lastmod>/);
});

test("the panel stamps created_at on a new page and edited_at on a real edit", async () => {
  const { stampPageTimes } = await import("../worker/src/studio");
  const file = "---\ntitle: AEW Dynamite 11.11.2026\nevent_date: 2026-11-11\ndate: 2026-11-12T13:03:05.000+02:00\n---\n\nbody\n";
  const created = stampPageTimes(null, file, "2026-11-12T11:07:19.000Z");
  assert.match(created, /^created_at: 2026-11-12T11:07:19\.000Z$/m);
  assert.ok(created.endsWith("---\n\nbody\n"));
  // the same text saved again changes nothing
  assert.equal(stampPageTimes(created, created, "2026-11-12T12:00:00.000Z"), created);
  // a real edit: edited_at, created_at untouched; a later edit replaces edited_at
  const edited = stampPageTimes(created, created.replace("body", "body + servers"), "2026-11-12T12:00:00.000Z");
  assert.match(edited, /^edited_at: 2026-11-12T12:00:00\.000Z$/m);
  assert.match(edited, /^created_at: 2026-11-12T11:07:19\.000Z$/m);
  const again = stampPageTimes(edited, edited.replace("servers", "more servers"), "2026-11-12T13:00:00.000Z");
  assert.equal(again.match(/^edited_at:/gm)!.length, 1);
  assert.match(again, /^edited_at: 2026-11-12T13:00:00\.000Z$/m);
  // the editor still open after the first save sends the file without created_at: the stamp stays
  const kept = stampPageTimes(created, file.replace("body", "body 2"), "2026-11-12T12:30:00.000Z");
  assert.match(kept, /^created_at: 2026-11-12T11:07:19\.000Z$/m);
  // wired into the save route, for every page collection
  assert.match(fs.readFileSync("worker/src/studio.ts", "utf8"), /if \(collection !== 'nostalgia_series'\) body\.content = stampPageTimes\(existing \? existing\.content : null, body\.content, new Date\(\)\.toISOString\(\)\);/);
});

test("a new English story carries the time it was written; a rewrite keeps its first stamp", () => {
  const src = fs.readFileSync("scripts/english-edition.ts", "utf8");
  assert.match(src, /\.\.\.\(createdAt \? \[`created_at: \$\{createdAt\}`\] : \[\]\),/);
  assert.match(src, /const createdAt = existing \? \(\(fs\.readFileSync\(existing, "utf-8"\)\.match\(\/\^created_at:/);
});
