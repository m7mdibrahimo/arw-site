import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1464: UFC fighter Tahir Abdullayev written «طاهر عبد الله».
test("Tahir Abdullayev is never written «طاهر عبد الله»", () => {
  assert.equal(applyCorrections("فاز طاهر عبد الله على جيك ماثيوز"), "فاز طاهر عبد اللاييف على جيك ماثيوز");
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(g["Tahir Abdullaev"], "طاهر عبد اللاييف");
});
