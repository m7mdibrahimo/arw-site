import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCorrections, checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa';

// INCIDENTS #409: «حركة مونس ault» and «في صعد القمة» reached the site.
test('known broken words are corrected automatically', () => {
  assert.match(applyCorrections('تفادى محاولة حركة مونس ault من ريد'), /مونسولت/);
  assert.match(applyCorrections('نجحت في صعد القمة وتبادل الضربات'), /في الصعود إلى القمة/);
});

test('broken_word is a publish-blocking code in the Fightful pipeline', () => {
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /BLOCKING_QA_CODES\.includes\(i\.code\)/);
  for (const c of ['broken_word', 'fem_plural_kn', 'glued_latin_arabic', 'detached_prefix', 'number_word_digits', 'mixed_script_word']) assert.ok(BLOCKING_QA_CODES.includes(c), c);
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
  assert.ok(BLOCKING_QA_CODES.includes('fem_plural_kn'));
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

test('INCIDENTS #438: mixed-script words and noun duals are blocked', () => {
  const pad = ' كلام عادي كثير '.repeat(40);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);
  assert.ok(codes('ودفاع يOH عن بطولة IWGP للوزن الخفيف.').includes('mixed_script_word'));
  assert.ok(codes('أنبوند كو (يوتو آيس وديكي نagai).').includes('mixed_script_word'));
  assert.ok(!codes('عرض AEW وCollision وبـWWE والـNXT وبAEW.').includes('mixed_script_word'));
  assert.ok(codes('إضافة نزالين للفرق إلى العرض.').includes('dual_noun'));
  assert.ok(codes('وستشهد مواجهتين على اللقب.').includes('dual_noun'));
  assert.ok(!codes('إضافة نزالات جديدة للفرق إلى العرض.').includes('dual_noun'));
});

// INCIDENTS #439: «ايه جيه ستايلز» (AJ without the hamza) reached five stories.
test('INCIDENTS #439: AJ names always get the hamza', () => {
  assert.match(applyCorrections('نجل المصارع ايه جيه ستايلز'), /إيه جيه ستايلز/);
  assert.match(applyCorrections('بين تراي ميجيل وايه جيه ستايلز'), /وإيه جيه ستايلز/);
});

// INCIDENTS #440: «سوير» for Sawyer, «syX» glued into Arabic, «الأخوين/الطاولتين» (dual) reached a story.
test('INCIDENTS #440: Sawyer spelling, syX and more dual nouns', () => {
  assert.match(applyCorrections('منح فريق سيكس المكون من سوير وصامويل شو'), /ساير وصامويل/);
  assert.match(applyCorrections('سوير ريك يفوز'), /سوير ريك/);
  assert.match(applyCorrections('ويساعد فريق syX على الفوز'), /فريق سيكس/);
  const pad = ' كلام عادي كثير '.repeat(40);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);
  assert.ok(codes('لمهاجمة الأخوين مات وجيف هاردي.').includes('dual_noun'));
  assert.ok(codes('عبر الطاولتين المخصصتين.').includes('dual_noun'));
  assert.ok(!codes('عبر الطاولات المخصصة لهم.').includes('dual_noun'));
});

// INCIDENTS #442: «سايرز» (Sawyer as a plural) and dual verbs «عرفا / كشفا» reached the site.
test('INCIDENTS #442: «سايرز» is corrected and dual verbs are blocked', () => {
  assert.match(applyCorrections('سبق له العمل مع سايرز وشو'), /ساير وشو/);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' كلام'.repeat(80)).map((i) => i.code);
  assert.ok(codes('الذين عرفا سابقا باسم آخر').includes('dual_form'));
  assert.ok(codes('حيث كشفا عن نفسيهما في العرض').includes('dual_form'));
  assert.ok(codes('صعوبة التنفس وفقدان صوته دفعاه للعودة إلى الطوارئ').includes('dual_form'));
  assert.ok(codes('اتحاد WWE ومونتيز فورد يمتلكان موقفا دفاعيا قويا').includes('dual_form'));
  assert.ok(codes('عرضا AEW Dynamite وCollision يحققان متوسط مشاهدة جيدا').includes('dual_form'));
  assert.ok(codes('قدم الثنائي نزالا قويا واستغل كليكما الوقت').includes('dual_form'));
  assert.ok(!codes('وصل الخبر الساعة الثانية ظهرا بالتوقيت المحلي').includes('dual_form'));
});

// Round 2026-10-12: «Juggalo Championship Wrestling» is a promotion name, not a title.
test('english_title_name does not flag «Championship Wrestling» promotion names', () => {
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' كلام'.repeat(80)).map((i) => i.code);
  assert.ok(!codes('حيث تصارع لصالح اتحادات مثل Juggalo Championship Wrestling وغيرها').includes('english_title_name'));
  assert.ok(codes('وفاز ببطولة World Heavyweight Championship أمس').includes('english_title_name'));
});

// INCIDENTS #445: a scrubbed source left «من منصة *تقارير صحفية*» in the story.
test('a scrubbed source name never stays as «منصة *تقارير صحفية*»', () => {
  const out = applyCorrections('كشفت تقارير صحفية حديثة من منصة *تقارير صحفية* أن النجم وقع، وقال موقع تقارير صحفية كذلك');
  assert.doesNotMatch(out, /(?:منصة|موقع|شبكة)\s+\*?تقارير صحفية/);
  assert.match(out, /حديثة أن النجم وقع/);
});

// INCIDENTS #448: «بيته الشعري» for a rap line, «ويظهر رسالة» with a feminine subject.
test('corrections fix rap-line wording and verb agreement', () => {
  const out = applyCorrections('بسبب بيته الشعري المسيء، وتنطفئ الأضواء ويظهر رسالة مصورة');
  assert.match(out, /مقطعه الغنائي المسيء/);
  assert.match(out, /وتظهر رسالة مصورة/);
});

// INCIDENTS #456: «أنفقت أكثر من أحد عشر 1000 دولار» — a number word glued to digits.
test('number word followed by digits blocks publishing', () => {
  const body = 'أنفقت أكثر من أحد عشر 1000 دولار على الأحذية. ' + 'كلام '.repeat(80);
  assert.ok(checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', body).some(i => i.code === 'number_word_digits'));
  assert.ok(!checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'دفع 2400 دولار وفاز في 3 نزالات ' + 'كلام '.repeat(80)).some(i => i.code === 'number_word_digits'));
});

// INCIDENTS #461: «شingo تاكاغي» and a story that named El Hijo del Vikingo for what the source says about El Hijo de Fishman.
test('mixed_script_word and name_not_in_source block publishing', async () => {
  const { wrestlerNotInSource, checkArticle } = await import('../scripts/news-qa.ts');
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /name_not_in_source/);
  assert.match(src, /RETRYABLE_QA_CODES\.includes\(i\.code\)/);
  assert.ok(RETRYABLE_QA_CODES.includes('mixed_script_word') && RETRYABLE_QA_CODES.includes('name_not_in_source'));
  assert.ok(checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'بدأ العرض بنزال فاز فيه شingo تاكاغي ودايكي ' + 'كلام '.repeat(80)).some(i => i.code === 'mixed_script_word'));
  const gl = { 'El Hijo del Vikingo': 'إل هيخو ديل فيكينجو' };
  const source = 'El Hijo de Fishman has reached a financial restitution agreement with the family of late referee Gerardo Pineda. '.repeat(3);
  assert.deepEqual(wrestlerNotInSource('تجنب إل هيخو ديل فيكينجو الاتهامات. وافق إل هيخو ديل فيكينجو على الدفع.', source, gl), ['El Hijo del Vikingo']);
  assert.deepEqual(wrestlerNotInSource('تجنب إل هيخو ديل فيكينجو الاتهامات. وافق إل هيخو ديل فيكينجو على الدفع.', source + ' Vikingo', gl), []);
});

test('dual forms the first list missed are caught, «تدخلا» (a noun) is not (INCIDENTS #463)', async () => {
  const { checkArticle } = await import('../scripts/news-qa.ts');
  const codes = (body: string) => checkArticle('عنوان واضح لخبر عن المصارعة', body).filter(i => i.code === 'dual_form').length;
  for (const bad of ['عاد الثنائي ليقحما نفسيهما في المنافسة', 'يتساءل الجميع هل سيرتديان ملابس متشابهة', 'خاضا تلك المواجهة في يوليو', 'وبعد مواجهتهما الثنائية في العرض', 'وأعلنتا أنهما ستواجهان خصما', 'كلاهما يريد اللقب'])
    assert.ok(codes(bad + ' ' + 'كلمات كثيرة '.repeat(30)) > 0, bad);
  assert.equal(codes('شهد النزال تدخلا لاحقا من شينسوكي ناكامورا ' + 'كلمات كثيرة '.repeat(30)), 0);
});

test('a glossary wrestler named once whose name is nowhere in the source is blocked (INCIDENTS #463)', async () => {
  const { wrestlerNotInSource } = await import('../scripts/news-qa.ts');
  const gl = { 'Yoshiki Inamura': 'يوشيكي إينامورا', 'Yuki Iino': 'يوكي إيينو', 'Manabu Soya': 'مانابو سويا' };
  const source = 'GHC Tag Team Championship Three-Way Tag Team Match: Manabu Soya & Yuki Iino (c) vs. T.M.D.K. '.repeat(4);
  assert.deepEqual(wrestlerNotInSource('ضد حامل اللقب فريق يوشيكي إينامورا ومانابو سويا', source, gl), ['Yoshiki Inamura']);
  assert.deepEqual(wrestlerNotInSource('ضد حامل اللقب فريق يوكي إيينو ومانابو سويا', source, gl), []);
});

test('dual pronouns «-هما» become plural; agreeing words are left alone; no published story keeps one (INCIDENTS #463)', async () => {
  const { dualPronounsToPlural, loadNews } = await import('../scripts/news-qa.ts');
  assert.equal(dualPronounsToPlural('علاقتهما وبينهما ومنهما وعليهما ولديهما'), 'علاقتهم وبينهم ومنهم وعليهم ولديهم');
  for (const keep of ['مهما كانت النتيجة', 'وهما يتنافسان', 'لأنهما', 'أنهما مرتبطان', 'كلاهما', 'لقبيهما'])
    assert.equal(dualPronounsToPlural(keep), keep);
  const left = loadNews().filter(n => dualPronounsToPlural(n.body) !== n.body).map(n => n.file);
  assert.deepEqual(left, []);
});

test('«ال الليلة» never comes out of tonightInTitle and «ثمنية» is corrected (INCIDENTS #466)', async () => {
  const { tonightInTitle, applyCorrections } = await import('../scripts/news-qa');
  const us = new Date('2026-10-12T20:00:00-04:00').getTime();
  assert.equal(tonightInTitle('بينتا يفتتح عرض WWE RAW ال 12 أكتوبر وفقا للتقارير', us), 'بينتا يفتتح عرض WWE RAW الليلة وفقا للتقارير');
  assert.equal(tonightInTitle('الكشف عن عرض WWE RAW يوم 12 أكتوبر', us), 'الكشف عن عرض WWE RAW الليلة');
  assert.ok(!/ثمنية/.test(applyCorrections('رقم مئة وثمنية وثلاثين رطلا')));
});

test('a week/month date is not turned into «الليلة» (INCIDENTS #467)', async () => {
  const { tonightInTitle } = await import('../scripts/news-qa');
  const us = Date.parse('2026-10-12T23:00:00Z');
  assert.equal(tonightInTitle('أبرز الفائزين والخاسرين لهذا الأسبوع 12 أكتوبر 2026', us), 'أبرز الفائزين والخاسرين لهذا الأسبوع 12 أكتوبر 2026');
  assert.equal(tonightInTitle('الكشف عن خطط عرض WWE RAW يوم 12 أكتوبر', us), 'الكشف عن خطط عرض WWE RAW الليلة');
});

// INCIDENTS #469: «بطولة جون سينا الكلاسيكية لن يكون/لن يقام» (verb did not agree with the feminine noun)
test('feminine «بطولة … الكلاسيكية» takes a feminine verb', () => {
  assert.equal(applyCorrections('بطولة جون سينا الكلاسيكية لن يكون جزءا من العرض'), 'بطولة جون سينا الكلاسيكية لن تكون جزءا من العرض');
  assert.equal(applyCorrections('بطولة سينا الكلاسيكية لن يقام في العرض'), 'بطولة سينا الكلاسيكية لن تقام في العرض');
});

test('a quote marker in the middle of a sentence moves to its own line; «يوتوتا» is corrected; no story keeps either (INCIDENTS #470)', async () => {
  const { autoFix, applyCorrections, loadNews } = await import('../scripts/news-qa.ts');
  assert.equal(autoFix('وقال بيشوف في هذا الصدد: > نعم، أعتقد ذلك.'), 'وقال بيشوف في هذا الصدد:\n\n> نعم، أعتقد ذلك.');
  assert.equal(autoFix('> اقتباس عادي'), '> اقتباس عادي');
  assert.ok(!/يوتوتا/.test(applyCorrections('يوتوتا تسوجي')));
  const left = loadNews().filter(n => /^[^>\n][^\n]*?[:：،][ \t]+>[ \t]+\S/m.test(n.body) || /يوتوتا/.test(n.body)).map(n => n.file);
  assert.deepEqual(left, []);
});

test('India Sioux is always «إنديا سيوكس», in the rules, the glossary and every story (INCIDENTS #472)', async () => {
  const { applyCorrections, loadNews } = await import('../scripts/news-qa.ts');
  assert.equal(applyCorrections('تحدثت إنديا سيو وإنديا سيوك وإنديا سيوكس'), 'تحدثت إنديا سيوكس وإنديا سيوكس وإنديا سيوكس');
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['India Sioux'], 'إنديا سيوكس');
  const bad = loadNews().filter(n => /إنديا\s+سيو(?![ء-ي])|سيوك(?![ء-ي])/.test(n.title + n.body)).map(n => n.file);
  assert.deepEqual(bad, []);
});

// INCIDENTS #482: «وادي ميتال» (Lady Metal with a glued waw) and «فيغو» (Fuego) in a CMLL results story.
test('corrections fix Lady Metal and Fuego spellings', () => {
  const out = applyCorrections('أستوريث وادي ميتال وديابيليتا روخا وفولكانو وفيغو');
  assert.match(out, /وليدي ميتال/);
  assert.match(out, /وفويغو/);
});

test('corrections fix verb agreement and a misspelt word (INCIDENTS #493)', () => {
  const out = applyCorrections('كشف التقارير أن السبب، بعد أمضائه خمس سنوات، في نزال استعراضي تقام يوم 17');
  assert.match(out, /كشفت تقارير أن/);
  assert.match(out, /قضائه/);
  assert.match(out, /نزال استعراضي يقام/);
});

test('INCIDENTS #499: prefixed number word before digits, dropped alef after ال, touchdown dual', () => {
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' كلام'.repeat(80)).map((i) => i.code);
  assert.ok(codes('يعتمد على ردود فعل لعشرين 1000 متفرج في الصالة.').includes('number_word_digits'));
  assert.ok(!codes('يعتمد على ردود فعل لعشرين ألف متفرج في الصالة.').includes('number_word_digits'));
  assert.ok(codes('الصدق والقتناع بما يقوله المصارع أساس النجاح.').includes('dropped_alef'));
  assert.ok(!codes('الصدق والاقتناع بما يقوله المصارع أساس النجاح.').includes('dropped_alef'));
  assert.ok(codes('احتفاله بتسجيل تاتشداونين خلال المواجهة.').includes('dual_noun'));
  assert.ok(BLOCKING_QA_CODES.includes('dropped_alef'));
});

// INCIDENTS #521: «كللا من» (doubled lam) reached the Rashmore story.
test('«كللا» is corrected to «كلا»', () => {
  assert.equal(applyCorrections('واختار رينز كللا من هالك هوجان'), 'واختار رينز كلا من هالك هوجان');
});

test('corrections fix ضآلة, مشيرا إلى and performing arts (INCIDENTS #525)', () => {
  const out = applyCorrections('رغم ضئالة حجمه، مشير إلى زميله، في مجالات الفنون الأدبية');
  assert.match(out, /ضآلة/);
  assert.match(out, /مشيرا إلى/);
  assert.match(out, /الفنون الأدائية/);
});

test('dual: past/present dual verbs and «ليلتين» are caught (INCIDENTS #540)', () => {
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' ' + 'كلام '.repeat(80)).map((i) => i.code);
  assert.ok(codes('كوفي وأوستن كريد ظهرا للمرة الأولى في AEW.').includes('dual_form'));
  assert.ok(codes('حيث تحالفا مع سويرف ستريكلاند.').includes('dual_form'));
  assert.ok(codes('الثنائي يتأهلان إلى النهائي.').includes('dual_form'));
  assert.ok(codes('على مدى ليلتين في ملعب أليجيانت.').includes('dual_noun'));
  assert.ok(!codes('يبدأ العرض الساعة 2 ظهرا في لاس فيغاس.').includes('dual_form'));
  assert.ok(!codes('ظهر كوفي للمرة الأولى في AEW وتحالف مع سويرف.').includes('dual_form'));
});

test('dual: «تنافسا قويا» / «تحالفا جديدا» are nouns, not dual verbs', () => {
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' ' + 'كلام '.repeat(80)).map((i) => i.code);
  assert.ok(!codes('شهد النزال تنافسا قويا وتحالفا جديدا بين الفريقين.').includes('dual_form'));
  assert.ok(codes('الاثنان تنافسا على اللقب.').includes('dual_form'));
});

// INCIDENTS #541: «نظم اتحادا ريف برو ودرام غيت» (dual noun) and «درام غيت» / «تواجهم» reached the site.
test('dual «اتحادا X وY» is blocked; «درام غيت» and «تواجهم» are corrected (INCIDENTS #541)', () => {
  const body = 'كلام '.repeat(80);
  assert.ok(checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'نظم اتحادا ريف برو ودراغون غيت تحية ' + body).some(i => i.code === 'dual_form'));
  assert.ok(!checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'شكل اتحادا قويا ' + body).some(i => i.code === 'dual_form'));
  assert.ok(!checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'ليس اتحادا حقيقيا وأن الجميع هناك سيئون ' + body).some(i => i.code === 'dual_form'));
  assert.match(applyCorrections('نظم اتحاد درام غيت'), /دراغون غيت/);
  assert.match(applyCorrections('خلال فترة تواجهم في الجامعة'), /تواجدهم/);
});

test('«WWE العالمية للفرق للسيدات» becomes «WWE للفرق للسيدات» (INCIDENTS #550)', () => {
  assert.equal(applyCorrections('بطلات WWE العالمية للفرق للسيدات'), 'بطلات WWE للفرق للسيدات');
  assert.match(applyCorrections('بطولة AEW العالمية للفرق للسيدات'), /AEW العالمية للفرق للسيدات/);
});

// INCIDENTS #551: feminine duals «النجمتان / المصارعتين / البطلتان» and «ترتبطان / تستعدان» passed the checker in ~70 stories.
test('feminine noun duals and «ترتبطان» are blocked (INCIDENTS #551)', () => {
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + ' ' + 'كلام '.repeat(80)).map((i) => i.code);
  assert.ok(codes('قدمت النجمتان عرضا قويا.').includes('dual_noun'));
  assert.ok(codes('بين المصارعتين ندية كبيرة.').includes('dual_noun'));
  assert.ok(codes('عائلاتهم ترتبطان بروابط قديمة.').includes('dual_form'));
  assert.ok(!codes('قدمت النجمات عرضا قويا وترتبط العائلات بروابط قديمة.').some((c) => c === 'dual_noun' || c === 'dual_form'));
});

// INCIDENTS #553: «جايك دويل», «AEW العالمية للقارات», «تسببت نزال» reached the Moxley and Copeland stories.
test('corrections fix Doyle spelling, AEW Continental title and نزال agreement (INCIDENTS #553)', () => {
  assert.equal(applyCorrections('نجح جايك دويل في التثبيت'), 'نجح جيك دويل في التثبيت');
  assert.equal(applyCorrections('بطولة AEW العالمية للقارات'), 'بطولة AEW القارية');
  assert.equal(applyCorrections('حيث تسببت نزال الطاولات في كسر'), 'حيث تسبب نزال الطاولات في كسر');
});

test('dual date phrase «يومي 13 و14» and «تسجيلين» are blocked and corrected (INCIDENTS #637)', () => {
  const pad = ' كلام عادي كثير '.repeat(40);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);
  assert.ok(codes('أقام الاتحاد تسجيلين متتاليين.').includes('dual_noun'));
  assert.ok(codes('العروض يومي 13 و14 أكتوبر.').includes('dual_noun'));
  assert.ok(!codes('حديث يومي عن المصارعة.').includes('dual_noun'));
  assert.match(applyCorrections('العروض يومي 13 و14 أكتوبر'), /العروض في 13 و14 أكتوبر/);
  assert.match(applyCorrections('قاعة مشاهير تروس/ثيز'), /جورج تراغوس\/ثيز/);
  assert.match(applyCorrections('قاعة مشاهير جورج تروس ولوي ثيز'), /جورج تراغوس ولوي ثيز/);
});

// INCIDENTS #641: «لحلقتين» (dual behind a ل prefix), «بWWE» and «هذا الجمعة» reached the site.
test('INCIDENTS #641: prefixed duals and one-letter prefixes glued to Latin are blocked', () => {
  const pad = ' كلام عادي كثير '.repeat(40);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);
  assert.ok(codes('أقام الاتحاد تسجيلا لحلقتين متتاليتين.').includes('dual_noun'));
  assert.ok(codes('وفاز بلقبين في ليلة واحدة.').includes('dual_noun'));
  assert.ok(!codes('أقام الاتحاد تسجيلا لحلقات متتالية.').includes('dual_noun'));
  assert.ok(codes('قراري في قمة مسيرتي بWWE كان صعبا.').includes('glued_latin_arabic'));
  assert.ok(!codes('قراري في قمة مسيرتي في WWE كان صعبا.').includes('glued_latin_arabic'));
  assert.ok(!codes('تنافس بين AEW وWWE وTNA في السوق.').includes('glued_latin_arabic'), '«وWWE» (و العطف) سليمة');
  assert.match(applyCorrections('نزال هذا الجمعة'), /هذه الجمعة/);
});

// INCIDENTS #650: «ما أحببناها» (الموصولة مذكر) in a "three things we loved" review.
test('INCIDENTS #650: «ما أحببناه / ما كرهناه» agreement is corrected', () => {
  assert.equal(applyCorrections('**ما أحببناها**'), '**ما أحببناه**');
  assert.equal(applyCorrections('**ما كرهناها**'), '**ما كرهناه**');
  assert.equal(applyCorrections('ثلاثة أمور أحببناها'), 'ثلاثة أمور أحببناها');
});

// INCIDENTS #651: «ستانكس», «فرق سداسي وثمانية», «الاتحادات والتعليقات» and «Will OSDAY» reached the site.
test('INCIDENTS #651: corrections fix Stacks, eight-man tag and الاتهامات; English fixes Ospreay', async () => {
  assert.equal(applyCorrections('كان ستانكس يشارك'), 'كان ستاكس يشارك');
  assert.equal(applyCorrections('في نزال فرق سداسي وثمانية إلى جانب'), 'في نزال فرق من ثمانية مصارعين إلى جانب');
  assert.equal(applyCorrections('على الاتحادات والتعليقات التي'), 'على الاتهامات والتعليقات التي');
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('defends against Will OSDAY'), 'defends against Will Ospreay');
});

// INCIDENTS #656: «واغنر/فاغنر» in one story, «تتوسط دعوى», «نيل لوكاس», «بطل AEW العالمية».
test('INCIDENTS #656: corrections fix Wagner, lawsuit phrase, Noel Lucas and champion gender', () => {
  assert.equal(applyCorrections('إل هيخو دي الدكتور واغنر جونيور'), 'إل هيخو دي الدكتور فاغنر جونيور');
  assert.equal(applyCorrections('فريق واجنر برذرز'), 'فريق فاغنر برذرز');
  assert.equal(applyCorrections('الواقعة التي تتوسط دعوى قضائية'), 'الواقعة التي تدور حولها دعوى قضائية');
  assert.equal(applyCorrections('الحارس نيل لوكاس'), 'الحارس نويل لوكاس');
  assert.equal(applyCorrections('كوني بطل AEW العالمية مسؤولية'), 'كوني بطل AEW العالمي مسؤولية');
  assert.equal(applyCorrections('بطل AEW العالمية للفرق'), 'بطل AEW العالمية للفرق');
});

test('INCIDENTS #660: «الدرجتين» is a dual noun and is blocked', () => {
  const pad = ' كلام عادي كثير '.repeat(40);
  const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);
  assert.ok(codes('أصيبت بحروق من الدرجتين الثانية والثالثة.').includes('dual_noun'));
  assert.ok(!codes('أصيبت بحروق من الدرجة الثانية والثالثة.').includes('dual_noun'));
});
