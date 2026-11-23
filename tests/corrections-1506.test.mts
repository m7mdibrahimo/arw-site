import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1506: the Daniel Garcia story wrote «قبل أن يقام بإيقاف النزال» (passive verb with a doer).
test("«يقام بإيقاف» becomes «يقوم بإيقاف»; a match that «يقام» (is held) stays", () => {
  assert.equal(applyCorrections("قبل أن يقام بإيقاف النزال فورا"), "قبل أن يقوم بإيقاف النزال فورا");
  assert.equal(applyCorrections("النزال سيقام بمجرد حصولها على التصريح"), "النزال سيقام بمجرد حصولها على التصريح");
  assert.equal(applyCorrections("النزال يقام بين الفريقين"), "النزال يقام بين الفريقين");
});
