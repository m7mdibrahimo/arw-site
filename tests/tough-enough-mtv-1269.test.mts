import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// «قبل انطلاق عرض WWE تاف إنف» and «قناة إم تي في»: show and channel names stay in English (Eric Bischoff story, INCIDENTS #1269)
test("«تاف إنف» and «إم تي في» are written in English", () => {
  const out = applyCorrections("قبل انطلاق برنامج WWE تاف إنف على قناة إم تي في، وبرنامج مليون دولار تاف إنف و دبليو دبليو إف تاف إنف");
  assert.ok(!/تاف|إم تي في/.test(out), out);
  assert.match(out, /WWE Tough Enough/);
  assert.match(out, /قناة MTV/);
  assert.match(out, /Million Dollar Tough Enough/);
  assert.match(out, /WWF Tough Enough/);
});

test("the names glossary never turns «Tough Enough» into Arabic letters", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8")) as Record<string, string>;
  const bad = Object.entries(g).filter(([k, v]) => /Tough Enough/.test(k) && /تاف/.test(v));
  assert.deepEqual(bad, []);
});
