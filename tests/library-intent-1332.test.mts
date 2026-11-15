import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// INCIDENTS #1332: a one-edition program's section claimed the show page's watch/download/latest searches.
const { leaveIntentToShow, libraryNameForms } = (await import("../lib/show-seo.cjs")).default;

test("a yearly section whose newest show has a page keeps only the program's names", () => {
  const names = ["عرض كراون جول", "كراون جويل", "WWE Crown Jewel مترجم", "مشاهدة عرض كراون جول", "مشاهده عرض كراون جول", "تحميل عرض كراون جول", "اخر عرض كراون جول", "عرض كراون جول الاخير", "عرض كراون جول الأخير مترجم"];
  assert.deepEqual(leaveIntentToShow(names, true), ["عرض كراون جول", "كراون جويل", "WWE Crown Jewel مترجم"]);
  assert.deepEqual(leaveIntentToShow(names, false), names);
  const lib = libraryNameForms({ arName: "عرض كراون جول", name: "WWE Crown Jewel", aliases: [], year: "", count: 1 });
  assert.ok(leaveIntentToShow(lib, true).every((n: string) => !/^(?:مشاهدة|مشاهده|تحميل)\s/.test(n)));
});

test("the library template applies it to the keywords and the TVSeries names", () => {
  const src = readFileSync(new URL("../pages/library-program.njk", import.meta.url), "utf8");
  assert.equal((src.match(/\| leaveIntentToShow\(lp\.prog\.count < 4 and lp\.prog\.latest\.url\)/g) || []).length, 2);
});
