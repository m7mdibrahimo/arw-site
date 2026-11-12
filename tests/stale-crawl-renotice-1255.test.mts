import { test } from "node:test";
import assert from "node:assert/strict";
import { staleCrawlPages, STALE_RETRY_MS } from "../scripts/seo-new-shows.ts";

const H = 3600_000;
const now = Date.parse("2026-11-12T10:00:00Z");
const base = { firstSeen: "2026-11-09T04:50:47.131Z", lastmod: "2026-11-09", pinged: "2026-11-09T14:36:08.970Z", directAt: "2026-11-09T14:36:08.970Z", inspected: "2026-11-12T05:52:42.877Z" };

test("a renamed show Google last crawled before its lastmod gets the direct notice again (#1255)", () => {
  const pages = {
    "https://arab-wrestling.com/shows/gcw-rock-bottom-2026/": { ...base, crawledAt: "2026-10-22T17:21:24Z", coverage: "noindex" },
    "https://arab-wrestling.com/shows/gcw-the-score-2026/": { ...base, crawledAt: "2026-11-05T13:21:11Z" },
    // crawled after its lastmod: Google saw the current page, nothing to re-send
    "https://arab-wrestling.com/shows/gcw-20-years-of-bad-boy-2026/": { ...base, crawledAt: "2026-11-11T23:39:47Z" },
    // indexed: never
    "https://arab-wrestling.com/shows/wwe-raw-09-11-2026/": { ...base, crawledAt: "2026-11-01T00:00:00Z", indexedAt: "2026-11-10T00:00:00Z" },
    // a news story: not this path
    "https://arab-wrestling.com/news/x/": { ...base, crawledAt: "2026-11-01T00:00:00Z" },
  };
  assert.deepEqual(staleCrawlPages(pages as any, now), [
    "https://arab-wrestling.com/shows/gcw-rock-bottom-2026/",
    "https://arab-wrestling.com/shows/gcw-the-score-2026/",
  ]);
});

test("the re-notice waits 48 hours after the last one and skips pages out of the sitemap", () => {
  const u = "https://arab-wrestling.com/shows/gcw-the-score-2026/";
  const recent = { [u]: { ...base, crawledAt: "2026-11-05T13:21:11Z", directAt: new Date(now - STALE_RETRY_MS + H).toISOString() } };
  assert.deepEqual(staleCrawlPages(recent as any, now), []);
  const old = { [u]: { ...base, crawledAt: "2026-11-05T13:21:11Z" } };
  assert.deepEqual(staleCrawlPages(old as any, now, 5, () => false), []);
});
