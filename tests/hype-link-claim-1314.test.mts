import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

const pad = "كشف اتحاد AEW عن تفاصيل جديدة تخص العرض المقبل في مدينة فينيكس بولاية أريزونا، حيث يستعد عدد من النجوم للمشاركة في نزالات قوية على عدة بطولات، وسط متابعة كبيرة من الجماهير التي تنتظر الحدث منذ أسابيع طويلة. ";

test("#1314: invented hype closer blocks publishing", () => {
  const body = pad + "\n\nومن المتوقع أن تضفي هذه الأسماء الإضافية مزيدا من الإثارة على هذا النزال الذي يعد واحدا من أبرز أحداث العرض.";
  const codes = checkArticle("مشاركون إضافيون في نزال Anarchy in the Arena", body).map(i => i.code);
  assert.ok(codes.includes("hype_closing"));
  assert.ok(BLOCKING_QA_CODES.includes("hype_closing"));
});

test("#1314: «check the lineup on the official site» from a source link blocks publishing", () => {
  for (const s of ["يذكر أن الجماهير يمكنها الاطلاع على قائمة النزالات المقررة للعرض عبر الموقع الرسمي للاتحاد.", "يمكنكم متابعة التغطية الكاملة والنتائج التفصيلية لجميع نزالات العرض عبر موقعنا."]) {
    const codes = checkArticle("اتحاد AEW يحصل على حقوق أغان مرخصة لعرض AEW Full Gear", pad + s).map(i => i.code);
    assert.ok(codes.includes("reader_link_claim"), s);
  }
  assert.ok(BLOCKING_QA_CODES.includes("reader_link_claim"));
});

test("#1314: viewing guides that name a channel are not flagged", () => {
  const body = pad + "ويمكن للجماهير متابعة العرض عبر قنوات AMC وAMC+ في تمام الساعة التاسعة مساء.";
  const codes = checkArticle("دليل مشاهدة عرض AEW Collision", body).map(i => i.code);
  assert.ok(!codes.includes("reader_link_claim"));
  assert.ok(!codes.includes("hype_closing"));
});

test("#1314: the city after a venue is «في فينيكس», the wrestler Rey Fenix stays", () => {
  const fixed = applyCorrections("قبل ساعات من العرض في صالة Mortgage Matchup Center ري فينيكس بولاية أريزونا، ودافع ري فينيكس عن لقبه.");
  const out = typeof fixed === "string" ? fixed : (fixed as any).text;
  assert.match(out, /Mortgage Matchup Center في فينيكس/);
  assert.match(out, /ودافع ري فينيكس عن لقبه/);
});
