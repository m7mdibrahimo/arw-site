import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle } from "../scripts/news-qa.ts";

test("a long number spelled in words in the TITLE is blocked (INCIDENTS #520: «ألف وثلاثمائة وستة عشر يوما»)", () => {
  const issues = checkArticle("رومان رينز يكشف صعوبة تصديق نهاية فترة احتفاظه بلقبه لمدة ألف وثلاثمائة وستة عشر يوما", "نص الخبر هنا.");
  assert.ok(issues.some((i) => i.code === "spelled_number" && i.field === "title"));
  assert.ok(!checkArticle("رومان رينز يحتفظ بلقبه لمدة 1316 يوما", "نص.").some((i) => i.code === "spelled_number"));
});

test("a sentence ending on «وقال.» and the duals «الاثنتين» / «ليلتا» are blocked (INCIDENTS #535)", () => {
  const body = "تحدث رويس كيز عن انضمام هايز، مشيرا إلى أن هايز يمتلك جانبا عدوانيا لم يره الجمهور بعد، وقال.\n\nنص آخر طويل بما يكفي.";
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", body).some((i) => i.code === "dangling_speech"));
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وقال كيز إن الفريق قوي جدا.").some((i) => i.code === "dangling_speech"));
  // a colon before a blockquote is a normal way to introduce a quote, not a lost quote
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\n> لا أعرف حقا.\n\nنص آخر.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\nنص آخر طويل.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("عنوان", "المواجهة بين الاثنتين مهمة.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "ليلتا العرض كانتا ممتازتين.").some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle("عنوان", "في يوم الاثنين أقيم العرض.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "بينما كان طفلان يقفان بجانبها وتواصل والد الطفلين معها.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "اثنان من الأطفال يقفون بجانبها وتواصل والد الأطفال معها.").every((i) => i.code !== "dual_noun"));
});

test("dual verbs «يعرفان / الاثنان» and a bold heading line opening the story are blocked (INCIDENTS #558)", () => {
  const t = "جيفون إيفانز يتحدث عن علاقته بجاكوب فاتو";
  assert.ok(checkArticle(t, "بدأ الاثنان مسيرتهم في الاتحادات المستقلة ويعرفان حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(!checkArticle(t, "بدأ كل منهم مسيرته في الاتحادات المستقلة ويعرف حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(checkArticle(t, "**المواجهة الأولى: نزال فرق للسيدات**\n\nأعلن اتحاد AEW عن نزال جديد.").some((i) => i.code === "stray_heading"));
  assert.ok(!checkArticle(t, "أعلن اتحاد AEW عن نزال جديد في **عرض كبير** قريبا.").some((i) => i.code === "stray_heading"));
});

test("the names glossary has no dual-form champion titles (INCIDENTS #559)", async () => {
  const fs = await import("node:fs");
  const names = JSON.parse(fs.readFileSync(new URL("../scripts/wrestler-names.json", import.meta.url), "utf8")) as Record<string, string>;
  const dual = Object.entries(names).filter(([, v]) => /(?:بطلتا|بطلا|العالميتان|العالميان)(?![ء-ي])/.test(String(v)));
  assert.deepEqual(dual, []);
});

test("a tatweel before an ARABIC name is removed and blocked (INCIDENTS #564)", async () => {
  const { autoFix } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("إعلان ضخم لـبيكي لينش ورد بـتايتشي"), "إعلان ضخم لبيكي لينش ورد بتايتشي");
  const t = "ساتوشي كوجيما مطالب بتحقيق شرط الوزن لمواجهة يوه في عرض NJPW الخاص بـتايتشي";
  assert.ok(checkArticle(t, "نص الخبر هنا طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic" && i.field === "title"));
  assert.ok(!checkArticle(t.replace("بـتايتشي", "بتايتشي"), "نص الخبر هنا.").some((i) => i.code === "tatweel_before_arabic"));
});

test("a tatweel followed by a space before an Arabic name is fixed and blocked", async () => {
  const { autoFix } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("أطاحت بها وبـ إيجنت زيرو"), "أطاحت بها وبإيجنت زيرو");
  assert.ok(checkArticle("عنوان", "نص الخبر وبـ إيجنت زيرو طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic"));
  assert.ok(!checkArticle("عنوان", "نص الخبر لـ ذا روك طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic"));
});

test("no published Arabic story has a tatweel before an Arabic letter (INCIDENTS #564)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../content/news/", import.meta.url);
  const bad = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && /\u0640(?=[\u0621-\u064A])/.test(fs.readFileSync(new URL(f, dir), "utf8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

test("dual_form: «تزوجا» is blocked, but the name «بي جي فازا» (PJ Vasa) is not a dual verb (INCIDENTS #570)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("تمت خطبة الثنائي ثم تزوجا رسميا في جامايكا خلال يونيو 2026 وسط حضور كبير من الأصدقاء والعائلة.").includes("dual_form"));
  assert.ok(!codes("وطلب بي جي فازا منها أن تجرب ذلك معه في الأسبوع القادم بعد انتهاء النزال الرئيسي في العرض.").includes("dual_form"));
});

test("«ى» for «ي» in nisba words and a dropped show name are blocked (INCIDENTS #594)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("سيناقش الثنائى مسيرتهم العالمية وماضي ومستقبل المصارعة مع تلقي أسئلة الجماهير المتابعة.").includes("alif_maqsura_ya"));
  assert.ok(codes("عن نزالهم التاريخى السابق في الاتحاد وكواليس تروى لأول مرة للجمهور المتابع.").includes("alif_maqsura_ya"));
  assert.ok(!codes("سيناقش الثنائي مسيرتهم العالمية وأعلى مستوى وصلوا إليه في الاتحاد.").includes("alif_maqsura_ya"));
  assert.ok(codes("أوضحت كيتلين خلال استضافتها في برنامج أن المخطط الأصلي كان يقضي بخروجها مبكرا من النزال.").includes("dropped_show_name"));
  assert.ok(!codes("أوضحت كيتلين خلال استضافتها في برنامج Insight مع كريس فان فليت أن المخطط الأصلي كان خروجها مبكرا.").includes("dropped_show_name"));
});

test("a wrestler teaming with himself is blocked (INCIDENTS #602: «فليتشر … سيتعاون مع كايل فليتشر»)", () => {
  const bad = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع كايل فليتشر لمواجهة فريق ذا يانغ باكس.";
  assert.ok(checkArticle("عنوان واضح للخبر هنا", bad).some((i) => i.code === "self_partner"));
  const ok = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع مارك ديفيس لمواجهة فريق ذا يانغ باكس.";
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", ok).some((i) => i.code === "self_partner"));
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "يتعاون كوفي كينغستون مع أوستن كريد في الحلبة.").some((i) => i.code === "self_partner"));
});

test("«الحدف» is corrected to «الهدف» (INCIDENTS #602)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("لتحقيق هذا الحدف"), "لتحقيق هذا الهدف");
});

test("a relative with the same surname is not a self-partner (INCIDENTS #602)", () => {
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "ويدافع نيك نيميث عن لقبه، قبل أن يتحد مع شقيقه رايان نيميث في النزال القادم.").some((i) => i.code === "self_partner"));
});

test("an English quote left untranslated in the Arabic story blocks publishing (INCIDENTS #614: John Cena's blockquote)", async () => {
  const { BLOCKING_QA_CODES } = await import("../scripts/news-qa.ts");
  const body = "تحدث سينا عن اعتزاله.\n\n> When I retired from WWE, everybody's like, 'Man, you're doing it on your own terms.' I want to do it forever.\n\nنص آخر.";
  assert.ok(checkArticle("جون سينا يتحدث عن اعتزاله", body).some((i) => i.code === "english_quote"));
  assert.ok(BLOCKING_QA_CODES.includes("english_quote"));
});

test("«العدواة» and the broken «ريكي سكر وصا» are corrected (INCIDENTS #622)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("العدواة المشتعلة"), "العداوة المشتعلة");
  assert.equal(applyCorrections("ريكي سكر وصا وإلياس"), "ريكي سوسا وإلياس");
});

test("a draw / no-contest is never a «🏆 الفائز» line (INCIDENTS #635: «الفائز: انتهى النزال بالتعادل»)", async () => {
  const { noWinnerLines } = await import("../scripts/news-qa.ts");
  const bad = "**الحدث الرئيسي**\n\nنزال.\n\n🏆 **الفائز:** انتهى النزال بالتعادل لانتهاء الوقت\n\n🏆 **الفائز:** لا يوجد (تعادل بالعد خارج الحلبة)\n\n🏆 **الفائز:** ديونا بورازو\n";
  assert.ok(checkArticle("نتائج عرض ROH TV", bad + "x".repeat(300)).some((i) => i.code === "draw_as_winner"));
  const fixed = noWinnerLines(bad);
  assert.match(fixed, /🤝 \*\*النتيجة:\*\* انتهى النزال بالتعادل لانتهاء الوقت/);
  assert.match(fixed, /🤝 \*\*النتيجة:\*\* تعادل بالعد خارج الحلبة/);
  assert.match(fixed, /🏆 \*\*الفائز:\*\* ديونا بورازو/);
  assert.ok(!checkArticle("نتائج عرض ROH TV", fixed + "x".repeat(300)).some((i) => i.code === "draw_as_winner"));
  const { readdirSync, readFileSync } = await import("node:fs");
  const left = readdirSync("content/news").filter((f) => f.endsWith(".md") && noWinnerLines(readFileSync(`content/news/${f}`, "utf-8")) !== readFileSync(`content/news/${f}`, "utf-8"));
  assert.deepEqual(left, []);
});

test("«المصارعيم» and «حمل للقلب» are corrected (INCIDENTS #635)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("أكثر المصارعيم على فترتي حمل للقلب"), "أكثر المصارعين على فترتي حمل اللقب");
});

test("a finished match told in the present tense («تواجه ار تروث وداميان بريست») is blocked in results, not in previews (INCIDENTS #645)", () => {
  const result = "نتائج عرض.\n\n**المواجهة الثالثة: نزال فردي**\n\nتواجه ار تروث وداميان بريست في نزال فردي، وانتهى النزال بتوقف المواجهة.\n\n🏆 **الفائز:** داميان بريست";
  assert.ok(checkArticle("نتائج عرض WWE SmackDown", result).some((i) => i.code === "result_present_tense"));
  const fixed = result.replace("تواجه ار تروث وداميان بريست", "واجه ار تروث داميان بريست");
  assert.ok(!checkArticle("نتائج عرض WWE SmackDown", fixed).some((i) => i.code === "result_present_tense"));
  const preview = "يعلن الاتحاد عن العرض القادم.\n\nتواجه ار تروث وداميان بريست في نزال فردي في العرض القادم.";
  assert.ok(!checkArticle("نزال قادم", preview).some((i) => i.code === "result_present_tense"));
});

test("«الركلة القاضية / الركلة المباشرة» for a Punt Kick is blocked, «ركلة البانت» passes (INCIDENTS #646)", () => {
  const t = "كودي رودز يوجه ركلة البانت إلى بارون كوربين";
  assert.ok(checkArticle("كودي رودز يسحق بارون كوربين بالركلة القاضية", "نص طويل بما يكفي للخبر.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(checkArticle(t, "وجه كودي رودز ضربة قاضية باستخدام الركلة المباشرة إلى بارون كوربين.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(checkArticle(t, "أطاح كودي رودز بخصمه بركلة البانت القاضية في ختام العرض.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(!checkArticle(t, "أنهى كودي رودز العرض بتوجيه ركلة البانت إلى بارون كوربين.").some((i) => i.code === "punt_kick_wording"));
});

test("«Lighting Match» (source typo) becomes «Lightning Match» (INCIDENTS #648)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("**المواجهة الثانية: نزال سريع (Lighting Match)**"), "**المواجهة الثانية: نزال سريع (Lightning Match)**");
  assert.equal(applyCorrections("Lightning Match"), "Lightning Match");
});

test("«نزال فردي» above a «الفائز: فريق …» line is blocked (INCIDENTS #672)", () => {
  const bad = "نتائج عرض.\n\n**المواجهة الرابعة: نزال فردي**\n\nحقق فريق موتور سيتي ماشين غانز الفوز على فريق إف تي آر.\n\n🏆 **الفائز:** فريق موتور سيتي ماشين غانز";
  assert.ok(checkArticle("نتائج عرض AEW WrestleDream", bad).some((i) => i.code === "singles_label_team_winner"));
  assert.ok(!checkArticle("نتائج عرض AEW WrestleDream", bad.replace("نزال فردي", "نزال فرق")).some((i) => i.code === "singles_label_team_winner"));
  assert.ok(!checkArticle("نتائج عرض AEW WrestleDream", bad.replace("فريق موتور", "إدي إدواردز").replace("**الفائز:** فريق", "**الفائز:**")).some((i) => i.code === "singles_label_team_winner"));
});

// INCIDENTS #673: «بفوز فريقي ديث رايدرز وذا دوجز» (dual construct of «فريق») reached the site.
test('«فريقي X وY» is a blocked dual noun', () => {
  const body = 'وانتهى النزال بفوز فريقي ديث رايدرز وذا دوجز في عرض AEW. '.repeat(8);
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', body, []).some(i => i.code === 'dual_noun'));
});

test("«نزال فرق سداسي» with four winners is blocked (INCIDENTS #689)", () => {
  const bad = "نتائج عرض.\n\n**الحدث الرئيسي (Main Event): نزال فرق سداسي**\n\nفاز الفريق الأول.\n\n🏆 **الفائز:** كيفن أوينز وتوني دي أنجيلو وشايلو هيل وكيندال غراي";
  assert.ok(checkArticle("نتائج عرض WWE NXT Live", bad).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض WWE NXT Live", bad.replace("سداسي", "ثماني")).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض WWE NXT Live", bad.replace("وكيندال غراي", "").replace("وشايلو هيل", "")).some((i) => i.code === "team_size_label"));
});

test("a stray «وة» fragment («هانك وة تانك») is blocked as a broken word (INCIDENTS #725)", () => {
  assert.ok(checkArticle("عنوان", "نزال بين فريق ذا كريد برذرز وفريق هانك وة تانك في ربع النهائي.").some((i) => i.code === "broken_word"));
  assert.ok(!checkArticle("عنوان", "نزال بين فريق ذا كريد برذرز وفريق هانك وتانك في ربع النهائي.").some((i) => i.code === "broken_word"));
});

// INCIDENTS #777: «2 عرض متتاليين» (a dual in disguise) and a sportsbook advert («odds courtesy of MyBookie») reached the site.
test('masked duals (2 عرض / متتاليين) and betting-site adverts are blocked', async () => {
  const { checkArticle, BLOCKING_QA_CODES } = await import('../scripts/news-qa');
  const a = checkArticle('عنوان', 'سيشهد ذلك اليوم إقامة 2 عرض متتاليين في الصالة.').map(i => i.code);
  assert.ok(a.includes('dual_noun'));
  assert.ok(!checkArticle('عنوان', 'يقام العرض يوم 2 نوفمبر القادم في بروكلين.').some(i => i.code === 'dual_noun'));
  const b = checkArticle('جدول نزالات UFC 333 برعاية MyBookie', 'الاحتمالات من MyBookie.').map(i => i.code);
  assert.ok(b.includes('betting_promo') && BLOCKING_QA_CODES.includes('betting_promo'));
});

test("a raw «المواجهة …:» result line left at the end of a story is blocked (INCIDENTS #826)", () => {
  const body = "توج لويس مانتي بلقب بطولة GHC الوطنية بعد فوزه.\n\nالمواجهة الثانية: نزال على بطولة GHC الوطنية\nلويس مانتي يهزم ناوميتشي ماروفوجي";
  assert.ok(checkArticle("لويس مانتي يتوج ببطولة GHC", body).some((i) => i.code === "stray_result_block"));
  assert.ok(!checkArticle("لويس مانتي يتوج ببطولة GHC", "**المواجهة الأولى: نزال فرق**\n\nفاز فريق أ.").some((i) => i.code === "stray_result_block"));
});

// INCIDENTS #836: an image caption in English («In 2019, Kofi defeated …») stayed as its own line in an Arabic story.
test('a whole English caption line inside an Arabic story is blocked', () => {
  const body = 'تحدث كوفي كينغستون عن فترته في WWE.\n\nIn 2019, Kofi defeated Bryan Danielson at WrestleMania 35 to become WWE Champion\n\nوأضاف أنها كانت حلم طفولة.';
  assert.ok(checkArticle('عنوان', body).some((i) => i.code === 'english_caption_line'));
  assert.ok(!checkArticle('عنوان', 'تحدث كوفي كينغستون عن فترته في WWE.\n\n> "I really believed it was my time to win the title that night"\n\nوأضاف أنها حلم.').some((i) => i.code === 'english_caption_line'));
  assert.ok(!checkArticle('عنوان', 'عرض AEW Dynamite الليلة\n\nWWE Raw').some((i) => i.code === 'english_caption_line'));
});
