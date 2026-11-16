import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1366: the source was about «Women's United States Champion Jacy Jayne» facing Stephanie Vaquer; the story
// wrote «جايد كارغيل» (named once in the same source) everywhere, title included. name_not_in_source passed it.
const source = `WWE has an unadvertised match planned for tonight's episode of WWE RAW. WWE Women's United States Champion Jacy Jayne is scheduled to face Stephanie Vaquer in a singles match. Jayne and Vaquer have a significant history from their time in NXT. During that segment, Jayne attempted to attack Vaquer but missed her kick. Vaquer is aligned with Charlotte Flair as they prepare to face Jade Cargill at Survivor Series. Tonight's match would allow Jayne and Vaquer to address their rivalry.`;
const gl = { "Jacy Jayne": "جايسي جاين", "Jade Cargill": "جايد كارغيل", "Stephanie Vaquer": "ستيفاني فاكير", "Usman Nurmagomedov": "عثمان نورماغوميدوف", "Umar Nurmagomedov": "عمر نورمحمدوف" };

test("the wrestler a source is about, swapped for another it names, blocks the story", async () => {
  const { mainWrestlerMissing } = await import("../scripts/news-qa.ts");
  assert.deepEqual(mainWrestlerMissing("جايد كارغيل تواجه ستيفاني فاكير في عرض WWE RAW الليلة\nستواجه بطلة الولايات المتحدة للسيدات جايد كارغيل ستيفاني فاكير.", source, gl), ["Jacy Jayne"]);
  assert.deepEqual(mainWrestlerMissing("جايسي جاين تواجه ستيفاني فاكير في عرض WWE RAW الليلة\nستواجه بطلة الولايات المتحدة للسيدات جايسي جاين ستيفاني فاكير.", source, gl), []);
  // one part of the name is enough; another wrestler sharing the surname doesn't make a passing mention the subject
  assert.deepEqual(mainWrestlerMissing("ستواجه جاين ستيفاني فاكير الليلة في نزال فردي.", source, gl), []);
  const ufc = "Usman Nurmagomedov was attacked. Usman Nurmagomedov said. Usman Nurmagomedov and his cousin Umar Nurmagomedov. Later Usman Nurmagomedov left the arena after the incident with his team and friends.";
  assert.deepEqual(mainWrestlerMissing("تعرض عثمان نورماغوميدوف لاعتداء.", ufc, gl), []);
});

test("«لياش الكلاب» becomes «مقاود الكلاب»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("كان يمسك بلياش الكلاب"), "كان يمسك بمقاود الكلاب");
  assert.equal(applyCorrections("واجه أم دبة غاضبة"), "واجه دبة غاضبة");
});
