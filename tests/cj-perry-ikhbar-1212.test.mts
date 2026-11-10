import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1212: the CJ Perry / Liv Morgan story wrote «حاولت أخبار مورغان» (the plural of «خبر» for «إخبار»)
// and the CJ Perry agency story called her husband Miro «شريكها»; the Jasmin St. Claire English description
// stopped on «…than a wrestler getting.».
test("«أخبار» after a verb of trying/wanting becomes «إخبار»; the news word itself stays", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("أوضحت بيري أنها حاولت أخبار مورغان بترك شعرها"), "أوضحت بيري أنها حاولت إخبار مورغان بترك شعرها");
  assert.equal(applyCorrections("قرر أخبار الجماهير بالقرار"), "قرر إخبار الجماهير بالقرار");
  assert.equal(applyCorrections("تابع آخر أخبار المصارعة"), "تابع آخر أخبار المصارعة");
  assert.equal(applyCorrections("تنتظر بيري وشريكها ميرو أول طفل لهم"), "تنتظر بيري وزوجها ميرو أول طفل لهم");
});

test("an English description never stops on a participle whose predicate was cut", async () => {
  const { metaDescription } = await import("../lib/meta-description.cjs");
  const body = "Jasmin St. Claire believes that deathmatch wrestling has gone too far and that fans would rather watch a compelling love story than a wrestler getting smashed through multiple light tubes. Speaking on the November 9, 2026, episode of her Off the Rails podcast, the former ECW and XPW personality discussed weapons.";
  const d = metaDescription(body);
  assert.doesNotMatch(d, /\sgetting\.$/);
  assert.match(d, /love story\.$/);
});
