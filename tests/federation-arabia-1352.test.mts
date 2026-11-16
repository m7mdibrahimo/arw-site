import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1352: «wwe arabia» (position 5.8, 170 impressions) lands on /federation/wwe/, whose head never named that form.
test("a federation page's CollectionPage names the Arabic-edition forms («WWE بالعربي», «WWE Arabia»)", () => {
  const njk = fs.readFileSync(new URL("../pages/federation.njk", import.meta.url), "utf8");
  const alt = njk.match(/"alternateName": \[("مصارعة حرة[^\]]*)\]/);
  assert.ok(alt, "CollectionPage alternateName exists");
  for (const f of ["{{ fed.code }} بالعربي", "{{ fed.code }} عربي", "{{ fed.code }} Arabia"]) assert.ok(alt[1].includes(`"${f}"`), f);
});
