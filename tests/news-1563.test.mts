import { test } from "node:test";
import assert from "node:assert/strict";

test("a '\"WWE SmackDown\" star' label is not an event at SmackDown (INCIDENTS #1563)", async () => {
  const { showEventFromBrandLabel } = await import("../scripts/news-qa");
  const source = `"WWE SmackDown" star Damian Priest's biggest moment of his career thus far was his Money in the Bank cash-in at WWE WrestleMania 40. Priest told the hosts of the "Complex Graps Wrestling Podcast" that even though he won the title via cash-in, his first title reign is something no one can take away from him.`;
  assert.deepEqual(showEventFromBrandLabel("تحدث النجم داميان بريست عن فترته الأولى كبطل العالم في WWE في عرض WWE SmackDown، مسترجعا ذكرياته", source), ["في عرض WWE SmackDown"]);
  assert.deepEqual(showEventFromBrandLabel("تحدث نجم عرض WWE SmackDown داميان بريست عن فترته الأولى كبطل العالم", source), []);
  const real = `${source} Priest later competed on SmackDown last Friday against Drew McIntyre in the main event of the show.`;
  assert.deepEqual(showEventFromBrandLabel("واجه بريست درو ماكنتاير في عرض WWE SmackDown", real), []);
});
