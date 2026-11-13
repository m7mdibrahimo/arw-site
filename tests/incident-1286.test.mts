import test from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1286: the SmackDown card story ended a sentence on «… عرض WWE SmackDown المقرر إقامته.», the Destination X
// travel story wrote «إدموندون» (Edmonton) and carried the tag «تيم عرض TNA iMPACT», and the Drew McIntyre story wrote
// «ومشخصا إياه بالشخصيات الخطيرة».
test("«المقرر إقامته.» with no day blocks publishing; with a day it passes (INCIDENTS #1286)", async () => {
  const { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } = await import("../scripts/news-qa");
  assert.ok(BLOCKING_QA_CODES.includes("dangling_scheduled") && RETRYABLE_QA_CODES.includes("dangling_scheduled"));
  const bad = checkArticle("إضافة نزال إلى عرض WWE SmackDown", "أعلن اتحاد WWE رسميا عن إضافة مواجهات جديدة إلى بطاقة عرض WWE SmackDown المقرر إقامته. وستشهد المواجهات دفاع الأبطال عن اللقب.");
  assert.ok(bad.some(i => i.code === "dangling_scheduled"));
  const ok = checkArticle("إضافة نزال إلى عرض WWE SmackDown", "أعلن اتحاد WWE رسميا عن إضافة مواجهات جديدة إلى بطاقة عرض WWE SmackDown المقرر إقامته يوم الجمعة 13 نوفمبر. وستشهد المواجهات دفاع الأبطال عن اللقب.");
  assert.ok(!ok.some(i => i.code === "dangling_scheduled"));
});

test("a «تيم/فريق عرض …» tag is dropped as junk; real team and show tags stay (INCIDENTS #1286)", async () => {
  const { isJunkTag } = await import("../scripts/news-qa");
  assert.equal(isJunkTag("تيم عرض TNA iMPACT"), true);
  assert.equal(isJunkTag("فريق عرض WWE RAW"), true);
  for (const t of ["TNA iMPACT", "عرض TNA iMPACT", "تيم بوزبي", "تيم 2000 إكس", "فريق ذا جادجمنت داي", "تسريبات عرض WWE SmackDown"]) assert.equal(isJunkTag(t), false, t);
});

test("Edmonton is «إدمونتون» and «مشخصا إياه» becomes «واصفا إياه» (INCIDENTS #1286)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("في صالة إدموندون إكسبو سنتر بمدينة ادموندون."), "في صالة إدمونتون إكسبو سنتر بمدينة إدمونتون.");
  assert.equal(applyCorrections("تحدث عنه بقسوة، ومشخصا إياه بالسوء."), "تحدث عنه بقسوة، وواصفا إياه بالسوء.");
});
