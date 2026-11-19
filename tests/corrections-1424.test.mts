import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1424: «عما إذا كان يقرب كين», «هو لست خائفا» and «ودنا نرى» reached stories.
test("«كان يقرب كين» → «قريب»; «هو لست» → «هو ليس»; «ودنا نرى» → «ولنرى»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("تسأله عما إذا كان يقرب كين حقا"), "تسأله عما إذا كان قريب كين حقا");
  assert.equal(applyCorrections("كان يقرب من الفوز"), "كان يقرب من الفوز");
  assert.equal(applyCorrections("فلم لا يكون هو؟ هو لست خائفا."), "فلم لا يكون هو؟ هو ليس خائفا.");
  assert.equal(applyCorrections("ودنا نرى أين تقف حقا"), "ولنرى أين تقف حقا");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /كان يقرب كين|هو لست|ودنا نرى/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
