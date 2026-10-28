import test from "node:test";
import assert from "node:assert/strict";
import { stuckLibraryPages, inspectionQueue } from "../scripts/seo-new-shows.ts";

const H = 3600 * 1000;
const D = 24 * H;
const now = Date.parse("2026-10-27T22:30:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("a library page that got its one direct notice a week ago gets it again (INCIDENTS #895)", () => {
  const pages: any = {
    // noticed on 2026-10-20 and Google never came: it used to be dropped for good after one notice
    "https://arab-wrestling.com/library/mlp-northern-rising/": { firstSeen: ago(21 * D), pinged: ago(21 * D), inspected: ago(2 * H), directAt: ago(7 * D + H), coverage: "تم اكتشاف الصفحة - لم تتم فهرستها حتى الآن" },
    // noticed two days ago: too soon to knock again
    "https://arab-wrestling.com/library/revpro/": { firstSeen: ago(21 * D), pinged: ago(21 * D), inspected: ago(2 * H), directAt: ago(2 * D) },
    // never noticed, and Google has not crawled it: first in line
    "https://arab-wrestling.com/library/njpw-special-events/": { firstSeen: ago(6 * D), pinged: ago(6 * D), inspected: ago(1 * H), coverage: "لم يتعرّف محرّك بحث Google على عنوان URL." },
    // already indexed: nothing to do
    "https://arab-wrestling.com/library/wwe-raw/": { firstSeen: ago(21 * D), pinged: ago(21 * D), inspected: ago(1 * H), indexedAt: ago(20 * D) },
  };
  const out = stuckLibraryPages(pages, now, 5);
  assert.deepEqual(out, [
    "https://arab-wrestling.com/library/njpw-special-events/",
    "https://arab-wrestling.com/library/mlp-northern-rising/",
  ]);
  // three days is still the minimum: a page Google has not had time to crawl is left alone
  assert.deepEqual(stuckLibraryPages({ "https://arab-wrestling.com/library/new/": { firstSeen: ago(1 * D), pinged: ago(1 * D), inspected: ago(1 * H) } } as any, now, 5), []);
});

test("the inspection queue asks about pages Google never looked at before the ones asked about every 6 hours (INCIDENTS #895)", () => {
  const pages: any = {
    // created yesterday, never inspected: it was starving behind pages of two weeks ago
    "https://arab-wrestling.com/shows/new-show/": { firstSeen: ago(1 * D), pinged: ago(1 * D) },
    // old page, inspected three hours ago: not due yet
    "https://arab-wrestling.com/shows/just-inspected/": { firstSeen: ago(8 * D), pinged: ago(8 * D), inspected: ago(3 * H) },
    // old page, inspected eight hours ago: due
    "https://arab-wrestling.com/shows/due-again/": { firstSeen: ago(8 * D), pinged: ago(8 * D), inspected: ago(8 * H) },
    // not in the live sitemap any more
    "https://arab-wrestling.com/shows/gone/": { firstSeen: ago(2 * D), pinged: ago(2 * D) },
    // older than ten days: the report stops following it
    "https://arab-wrestling.com/shows/too-old/": { firstSeen: ago(12 * D), pinged: ago(12 * D) },
  };
  const has = (u: string) => !u.endsWith("/gone/");
  assert.deepEqual(inspectionQueue(pages, now, has, 40), [
    "https://arab-wrestling.com/shows/new-show/",
    "https://arab-wrestling.com/shows/due-again/",
  ]);
});

test("library pages out of the sitemap never take the direct-notice places of listed ones (INCIDENTS #903)", () => {
  const now = Date.parse("2026-10-28T00:00:00Z");
  const old = { firstSeen: "2026-10-10T00:00:00Z", lastmod: "2026-10-10", inspected: "2026-10-27T00:00:00Z", crawledAt: "" };
  const pages: Record<string, any> = {};
  for (const s of ["njpw", "roh", "cmll", "aaa", "mlw", "wwe"]) pages[`https://arab-wrestling.com/library/${s}/`] = { ...old };
  pages["https://arab-wrestling.com/library/njpw-special-events/"] = { ...old, firstSeen: "2026-10-21T07:31:08Z" };
  const listed = (u: string) => u.endsWith("/njpw-special-events/");
  assert.deepEqual(stuckLibraryPages(pages, now, 5, listed), ["https://arab-wrestling.com/library/njpw-special-events/"]);
});
