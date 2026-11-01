# نقل الموقع من Cloudflare Pages إلى Workers Static Assets (حد الملفات)

**ليه:** Pages بيرفض أكتر من ٢٠٠٠٠ ملف في النشر، والموقع قرب منه (١٨٤٠٠ وبيزيد ~٢٦٠ في اليوم). Worker بأصول ثابتة بياخد لحد ١٠٠٠٠٠ ملف على الخطة المدفوعة (الحساب عليه Workers Paid)، من غير تكلفة زيادة. التفاصيل: INCIDENTS #1005.

**اللي اتجرب محليا (wrangler 4.34، على `_site` المبني):** الصفحات بتتفتح، `/x` بيتحول لـ`/x/`، الصفحة الغلط 404 بصفحة `404.html`، و`_redirects` (٢٠٩٨ قاعدة) و`_headers` (٢٥ قاعدة) بيتقروا ويشتغلوا. **لسه ماتجربش:** النشر الحقيقي، والـDomain، وتداخل المسارات مع Worker الصور `arw-media`.

## الخطوات (من لوحة Cloudflare، والموقع الحالي بيفضل شغال طول الوقت)
1. Workers & Pages ← Create ← Import a repository ← `arw-site`. اسم الـWorker لازم يكون **`arw-site-static`** (زي `name` في `wrangler.static.jsonc`). الفرع: **`site`**. أمر البناء: نفس أمر مشروع Pages الحالي. أمر النشر: `npx wrangler@4.34.0 deploy --config wrangler.static.jsonc` (لازم ٤.٣٤ أو أحدث عشان حد الـ١٠٠٠٠٠ ملف).
2. افتح عنوان `arw-site-static.<account>.workers.dev` وقارنه بالموقع الحي: الرئيسية، عرض، خبر، `/en/`، `/sitemap.xml`، صفحة غلط (404)، تحويل قديم، الـheaders.
3. بص على عدد الملفات في `/build.json`.
4. لو تمام: شيل الدومين من مشروع Pages، وضيفه للـWorker من Settings ← Domains & Routes ← Add ← Custom Domain (نفس الشيء لـ`www`). **اتأكد إن صور `/content/images/*` و`/videos/*` و`/img/*` لسه بتتخدم من `arw-media`** (الـroutes بتاعته على نفس الدومين).
5. بعدها قولي، وأنا أعدّل `PAGES_FILE_LIMIT` في `eleventy.config.js` لـ١٠٠٠٠٠ وأظبط انتظار علامة «Cloudflare Pages» في `.github/workflows/site-branch.yml` على علامة Workers Builds.
6. للرجوع: ارجّع الدومين لمشروع Pages (لسه موجود).
