import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCorrections, checkArticle } from '../scripts/news-qa';

// INCIDENTS #409: «حركة مونس ault» and «في صعد القمة» reached the site.
test('known broken words are corrected automatically', () => {
  assert.match(applyCorrections('تفادى محاولة حركة مونس ault من ريد'), /مونسولت/);
  assert.match(applyCorrections('نجحت في صعد القمة وتبادل الضربات'), /في الصعود إلى القمة/);
});

test('broken_word is a publish-blocking code in the Fightful pipeline', () => {
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /"broken_word", "fem_plural_kn", "glued_latin_arabic", "detached_prefix"\]\.includes/);
  const issues = checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'تفادى محاولة حركة مونس ault من ريد ' + 'كلام '.repeat(80));
  assert.ok(issues.some(i => i.code === 'broken_word'));
});

test("detached_prefix blocks publishing and «ل الليلة» is corrected (INCIDENTS #410)", async () => {
  const { checkArticle, applyCorrections } = await import("../scripts/news-qa.ts");
  assert.ok(checkArticle("شاهد العرض الكامل من Lucha Libre AAA ل الليلة", "نص طويل بما يكفي ".repeat(20), []).some(i => i.code === "detached_prefix"));
  assert.equal(applyCorrections("شاهد Lucha Libre AAA ل الليلة"), "شاهد Lucha Libre AAA الليلة");
});

// INCIDENTS #411: «اقيمت» (no hamza) and «خمسة عشر دقيقة» (wrong number agreement).
test('hamza and number-agreement slips are corrected', () => {
  assert.equal(applyCorrections('الفعالية التي اقيمت في نيو أورليانز'), 'الفعالية التي أقيمت في نيو أورليانز');
  assert.match(applyCorrections('مواجهة مدتها خمسة عشر دقيقة'), /خمس عشرة دقيقة/);
});

// INCIDENTS #412: the Mane Event team name must survive, and «اسم AEW في» is not a film title.
test('team «ذا مين إيفنت» is not rewritten to WWE Main Event', () => {
  assert.equal(applyCorrections('تغلب فريق ذا مين إيفنت على خصومه'), 'تغلب فريق ذا مين إيفنت على خصومه');
  assert.match(applyCorrections('عرض مين إيفنت الليلة'), /WWE Main Event/);
  const body = 'أكد أنه كان يتوقع ذكر اسم AEW في ذلك الوقت وفريق ذا مين إيفنت فاز.';
  const codes = checkArticle('عنوان عربي كامل للخبر هنا', body, []).map(i => i.code);
  assert.ok(!codes.includes('mixed_caps_title') && !codes.includes('known_wrong'));
});

// INCIDENTS #412: The Vision was written both «ذا فيشن» and «ذا فيجن».
test('The Vision is always «ذا فيجن»', () => {
  assert.equal(applyCorrections('هجوم فريق ذا فيشن على ريد'), 'هجوم فريق ذا فيجن على ريد');
});

// INCIDENTS #413: «زميليه» is a dual form (and Gemini named the wrong podcast).
test('«زميليه» is corrected to the plural', () => {
  assert.equal(applyCorrections('إلى جانب زميليه لانس آرتشر'), 'إلى جانب زملائه لانس آرتشر');
  assert.equal(applyCorrections('انتقد لزميليه في الاتحاد'), 'انتقد لزملائه في الاتحاد');
});

// INCIDENTS #415: the English match name was repeated in Arabic letters right after it.
test('«Call Your Shot Gauntlet غاونتلي» loses the duplicate transliteration', () => {
  assert.equal(applyCorrections('بنزال Call Your Shot Gauntlet غاونتلي، ونزال'), 'بنزال Call Your Shot Gauntlet، ونزال');
});

// INCIDENTS #415: Mecha Wolf was written «ميشا وولف»; glossary now fixes the spelling.
test('glossary spells Mecha Wolf as «ميكا وولف»', async () => {
  const { readFileSync } = await import('node:fs');
  const names = JSON.parse(readFileSync(new URL('../scripts/wrestler-names.json', import.meta.url), 'utf8'));
  assert.equal(names['Mecha Wolf'], 'ميكا وولف');
});

// INCIDENTS #422: «يقدمكن» and «الحكمة جيسيكا كار» (referee) reached the site.
test('feminine-plural «يقدمكن» is blocked and referee «الحكمة» is corrected', () => {
  assert.equal(applyCorrections('هؤلاء المصارعات يقدمكن مستويات'), 'هؤلاء المصارعات يقدمن مستويات');
  assert.equal(applyCorrections('طردهما الحكمة جيسيكا كار'), 'طردهما الحكم جيسيكا كار');
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', 'المصارعات يقدمكن مستويات ' + 'كلام '.repeat(80), []).some(i => i.code === 'fem_plural_kn'));
  assert.match(fs.readFileSync('scripts/fightful-watcher.ts', 'utf8'), /"fem_plural_kn"/);
});

// INCIDENTS #429: «لهكته» (typo for لهجته) and the filler «يسخر ساخرا».
test('«لهكته» and «يسخر ساخرا» are corrected', () => {
  assert.equal(applyCorrections('بسبب لهكته الفرنسية'), 'بسبب لهجته الفرنسية');
  assert.equal(applyCorrections('جون سينا يوضح ويسخر ساخرا'), 'جون سينا يوضح ويسخر');
});

// INCIDENTS #430: «دان hausen» (Danhausen split) blocked/leaked, and «قدما عندما» wrongly flagged as a dual verb.
test('Danhausen split is corrected and «قدما عندما» is not a dual form', () => {
  assert.equal(applyCorrections('انتهى نزال دان hausen ضد غونتر'), 'انتهى نزال دانهاوزن ضد غونتر');
  const body = 'دفع المنافسة قدما عندما كانت العروض هادئة. ' + 'كلام '.repeat(80);
  assert.ok(!checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', body).some((i) => i.code === 'dual_form'));
  assert.ok(checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'AEW قدما دعما رائعا ' + 'كلام '.repeat(80)).some((i) => i.code === 'dual_form'));
});

// INCIDENTS #431: «مواجهة فرق مختلطة ثمانية» (literal eight-person mixed tag).
test('«مواجهة فرق مختلطة ثمانية» is corrected', () => {
  assert.equal(applyCorrections('شهد العرض مواجهة فرق مختلطة ثمانية بين فريقين'), 'شهد العرض نزال فرق مختلط ثماني الأفراد بين فريقين');
});

test("winner_contradiction: prose winner differs from the «الفائز» line", async () => {
  const { checkArticle } = await import("../scripts/news-qa.ts");
  const bad = "مقدمة\n\n**المواجهة الأولى: نزال فردي**\n\nتواجه ريكي سوسا وإدي إدواردز قبل أن يحسم سوسا النتيجة لصالحه.\n\n🏆 **الفائز:** إدي إدواردز";
  const ok = bad.replace("يحسم سوسا", "يحسم إدواردز");
  assert.ok(checkArticle("عنوان تجريبي طويل بما يكفي للفحص هنا", bad).some((i) => i.code === "winner_contradiction"));
  assert.ok(!checkArticle("عنوان تجريبي طويل بما يكفي للفحص هنا", ok).some((i) => i.code === "winner_contradiction"));
});
