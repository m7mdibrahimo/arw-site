import { test } from "node:test";
import assert from "node:assert/strict";
import { fixEraCalledShow, fixDivasChampion, checkArticle, applyCorrections } from "../scripts/news-qa.ts";
import { metaDescription } from "../lib/meta-description.cjs";

test("«(فترة) عرض Divas Era» becomes «حقبة الديفاز» (INCIDENTS #1268)", () => {
  assert.equal(fixEraCalledShow("المصارعات خلال فترة عرض Divas Era للحصول على فرص"), "المصارعات خلال حقبة الديفاز للحصول على فرص");
  assert.equal(fixEraCalledShow("في عرض Ruthless Aggression Era"), "في حقبة Ruthless Aggression");
  assert.equal(applyCorrections("خلال فترة عرض Divas Era للحصول"), "خلال حقبة الديفاز للحصول");
  assert.equal(fixEraCalledShow("في عرض WWE RAW الليلة"), "في عرض WWE RAW الليلة");
});

test("Divas Champion is not «بطلة WWE للسيدات» (INCIDENTS #1268)", () => {
  const src = "after I came back from my injury and I was Divas Champion";
  assert.equal(fixDivasChampion("عندما عدت وكنت بطلة WWE للسيدات، تحدثت", src), "عندما عدت وكنت بطلة الديفاز، تحدثت");
  assert.equal(fixDivasChampion("كانت بطلة WWE للسيدات", "she was the WWE Women's Champion"), "كانت بطلة WWE للسيدات");
});

test("«نزالي فرق رباعي» / «نزالي ألتيميت إكس» are blocked duals (INCIDENTS #1268)", () => {
  const codes = (b: string) => checkArticle("عنوان خبر عن TNA Destination X", b, []).map((i: any) => i.code);
  assert.ok(codes("يتنافس ثمانية مصارعين من خلال نزالي فرق رباعي.").includes("dual_noun"));
  assert.ok(codes("ويشهد العرض عودة نزالي ألتيميت إكس للرجال.").includes("dual_noun"));
  assert.ok(!codes("ويشهد العرض عودة نزال ألتيميت إكس للرجال ونزال ألتيميت إكس للسيدات.").includes("dual_noun"));
});

test("an English description never stops on «that during …» (INCIDENTS #1268)", () => {
  const t = "Former WWE star Layla recalled that during her time as Divas Champion in 2012, a head writer told her that people in production meetings simply did not care about the women's division. Speaking on the Lay Talk podcast, Layla discussed it.";
  const d = metaDescription(t);
  assert.notEqual(d, "Former WWE star Layla recalled that during her time as Divas Champion in 2012.");
  assert.match(d, /head writer told her/);
});

test("a show named «Pro Era V» stays a show (INCIDENTS #1268)", () => {
  assert.equal(fixEraCalledShow("للمشاركة في عرض Pro Era V، المقرر"), "للمشاركة في عرض Pro Era V، المقرر");
});
