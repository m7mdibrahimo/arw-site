import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1527: Royce Keys «أراقب ما حولني» / «كما اعتادنا»; Ken Anderson «يعتقد الجماهير» / «أزمة الصيدليات».
test("Royce Keys and Ken Anderson wording is corrected", () => {
  assert.equal(applyCorrections("أنا شخص هادئ وأراقب ما حولني."), "أنا شخص هادئ وأراقب ما حولي.");
  assert.equal(applyCorrections("أشاهد الأشرطة كما اعتادنا."), "أشاهد الأشرطة كما اعتدنا.");
  assert.equal(applyCorrections("الواقعة التي يعتقد الجماهير أنها السبب"), "الواقعة التي تعتقد الجماهير أنها السبب");
  assert.equal(applyCorrections("مثل أزمة الصيدليات والإصابات"), "مثل مشكلات تتعلق بالأدوية والإصابات");
});
