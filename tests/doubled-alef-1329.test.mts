import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, BLOCKING_QA_CODES, autoFix, applyCorrections } from "../scripts/news-qa.ts";

const codes = (body: string) => checkArticle("إيليا دراغونوف يؤكد أن ذراعه تكاد تكون مكسورة", body + " كلام".repeat(80), []).map((i: any) => i.code);

// INCIDENTS #1329: «مستخدما حركة أفاالانش إير رايد كراش» (Ilja Dragunov), and older «سكااي»، «تاايجي»، «اائتمانية».
test("two alefs in a row are fixed to one, and block publishing when left", () => {
  assert.ok(BLOCKING_QA_CODES.includes("doubled_alef"));
  assert.ok(codes("ونفذ عليه حركة أفاالانش إير رايد كراش.").includes("doubled_alef"));
  assert.ok(!codes("ونفذ عليه حركة أفالانش إير رايد كراش.").includes("doubled_alef"));
  assert.match(autoFix("ونفذ عليه حركة أفاالانش إير رايد كراش."), /حركة أفالانش إير/);
  assert.match(autoFix("بطاقات اائتمانية جديدة"), /بطاقات ائتمانية جديدة/);
  assert.match(autoFix("رسمياا.. انضمام ESPN"), /^رسميا\.\. انضمام/);
  assert.match(autoFix("وتاايجي إيشيموري"), /وتايجي إيشيموري/);
  // two separate words that end and start with an alef stay as they are
  assert.equal(autoFix("ذهبا ابتداء من الغد"), "ذهبا ابتداء من الغد");
});

// INCIDENTS #1329: Edmonton written «إدموند» («فرصة وصوله إلى إدموند», Trey Miguel / TNA Destination X).
test("Edmonton after a place word is corrected to «إدمونتون»", () => {
  assert.match(applyCorrections("بدا أن فرصة وصوله إلى إدموند شبه معدومة"), /إلى إدمونتون شبه/);
  assert.match(applyCorrections("العرض المقام في إدموندون الليلة"), /في إدمونتون الليلة/);
  // a person called Edmund is left alone
  assert.match(applyCorrections("قال إدموند إن"), /قال إدموند إن/);
});
