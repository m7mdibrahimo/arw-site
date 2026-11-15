import { test } from "node:test";
import assert from "node:assert/strict";
import { fixHalfEnglishNames, applyCorrections, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS #1333: «وكسيا بروكسايد، وجادا Stone» and «مركز إدمونت إكسبو» went live in the TNA Destination X story.
test("a half-English glossary name after «و/ب/ل/ف» is completed and the prefix kept", () => {
  assert.equal(fixHalfEnglishNames("المصارعات غابي فورزا، وجادا Stone بالمصارعات"), "المصارعات غابي فورزا، وجادا ستون بالمصارعات");
  assert.equal(fixHalfEnglishNames("فازت جادا Stone"), "فازت جادا ستون");
  assert.equal(fixHalfEnglishNames("نزال لجادا Stone"), "نزال لجادا ستون");
  assert.equal(fixHalfEnglishNames("فازت جادا ستون"), "فازت جادا ستون");
});

test("the half-English check flags it before publishing", () => {
  const issues = checkArticle("تعديلات على نزال ألتيميت إكس في TNA", "تم استبدال غابي فورزا، وجادا Stone بالمصارعات هيذر باي إليغانس." + " كلام".repeat(80), []);
  assert.ok(issues.some((i: any) => i.code === "half_english_name"));
});

test("«إدمونت» becomes «إدمونتون», and «إدمونتون» stays", () => {
  assert.equal(applyCorrections("في مركز إدمونت إكسبو"), "في مركز إدمونتون إكسبو");
  assert.equal(applyCorrections("في مدينة إدمونتون"), "في مدينة إدمونتون");
});
