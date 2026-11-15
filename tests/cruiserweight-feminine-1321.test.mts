import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1321: «يحمل حاليا بطولة الكروزرويت العالمي في AAA» — «بطولة» is feminine.
test("«بطولة الكروزرويت العالمي» is corrected to the feminine form; «بطل/لقب» stays masculine", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("يحمل حاليا بطولة الكروزرويت العالمي في AAA."), "يحمل حاليا بطولة الكروزرويت العالمية في AAA.");
  assert.equal(applyCorrections("يحمل بطولة الكروزرويت العالمية في AAA"), "يحمل بطولة الكروزرويت العالمية في AAA");
  assert.equal(applyCorrections("بطل الكروزرويت العالمي في AAA"), "بطل الكروزرويت العالمي في AAA");
  assert.equal(applyCorrections("لقب الكروزرويت العالمي"), "لقب الكروزرويت العالمي");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بطولة الكروزرويت العالمي(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
