# المراقب الساعي لموقع عرب راسلنج

لفة كل ساعة على **سيرفرات GitHub** — مش على جهاز المالك، فمش محتاجة الماك يكون شغّال.
كل ساعة في الدقيقة ٥: وكيل `site-guard` بيفحص الموقع (الصحة والنشر، العروض، جودة الأخبار
عربي وإنجليزي، جوجل والترتيب)، بيصلّح المشاكل **من جذرها**، **وبيعمل commit** — والدفع
بيحصل بعد بوابة فحص مستقلة.

## المسار

```
GitHub Actions (cron 5 * * * *)
   └─ .github/workflows/hourly-guard.yml
        ├─ npm ci (المشروع + worker)          ← الاختبارات محتاجة الاتنين
        ├─ opencode run --agent site-guard    ← اللفة الكاملة (٦ خطوات) + commit
        ├─ البوابة: npx tsx --test tests/*.test.mts + npm run build
        │     ├─ نجحت  → git rebase + push origin main
        │     └─ فشلت  → مفيش دفع، والتشغيل بيفشل (إيميل) + الـdiff في artifact
        └─ artifact: reports/guard/*.log
```

**ليه البوابة؟** `site-branch.yml` بينقل فرع `site` فورًا من غير ما يفحص البناء، وCloudflare
بيبني منه. يعني أي كوميت مكسور على `main` بيوقف تحديث الموقع كله. البوابة دي هي اللي
بتمنع ده: الوكيل نفسه **مش قادر يدفع** (في `pre-push` hook بيقفل الدفع جواه)، والدفع
بيحصل بس بعد ما الاختبارات (٩٥٥+) والبناء ينجحوا.

## حارس الحارس — الضمانة إنه ميقفش ساكت

`.github/workflows/guard-heartbeat.yml` بيشتغل كل ساعة في الدقيقة ٣٥ وبيسأل:
«آخر لفة ناجحة كانت امتى؟». لو بقالها أكتر من ٣ ساعات — أو المفتاح `ARW_GUARD_ENABLED`
مقفول — **بيفشل**، وGitHub بيبعت إيميل. يعني لو اللفة وقفت لأي سبب (التوثيق باظ، الجدول
اتلغى، الـworkflow اتقفل) هتعرف في نفس الساعة، مش بعد أسبوع.

## التشغيل والإيقاف

```bash
# تشغيل
gh variable set ARW_GUARD_ENABLED -R m7mdibrahimo/arw-site --body true

# إيقاف مؤقت
gh variable set ARW_GUARD_ENABLED -R m7mdibrahimo/arw-site --body false
```

السرّ `OPENCODE_AUTH` لازم يكون موجود (توثيق OpenCode، بيتقرا من stdin ومابيتطبعش أبدًا):

```bash
"/Applications/OpenCode.app/Contents/Resources/opencode-cli" auth export "OpenCode Console" \
  | gh secret set OPENCODE_AUTH -R m7mdibrahimo/arw-site
```

مفتاح اختياري: `ARW_GUARD_MODEL` (مثل `opencode/deepseek-v4.1-flash-free`). من غيره
بيجرّب قايمة الموديلات المجانية بالترتيب لحد ما واحد ينجح.

## تشغيل لفة يدويًا (على أي جهاز)

```bash
# من GitHub
gh workflow run hourly-guard.yml -R m7mdibrahimo/arw-site

# محليًا
bash scripts/monitor/run-round.sh              # لفة كاملة
bash scripts/monitor/run-round.sh --dry-run     # الأوامر بس
ARW_GUARD_MODEL=opencode/deepseek-v4.1-flash-free bash scripts/monitor/run-round.sh
```

محليًا السكربت بيعمل commit بس ومابيدفعش — الدفع يدوي أو من الـworkflow.

## المراقب التقني (احتياطي، بدون AI)

فحص حتمي سريع للصفحات الحية، نبض بوت الأخبار، تأخر النشر، تشغيلات GitHub، الاختبارات
والبناء. **قراءة فقط**، بيكتب في `reports/guard/`، وبيفشل لو لقى عطل.

```bash
npx tsx scripts/monitor/watch.ts
npx tsx scripts/monitor/watch.ts --with-tests
npx tsx scripts/monitor/watch.ts --json
npx tsx scripts/monitor/install-macos.sh --print    # ملف launchd للماك
```

`.github/workflows/site-watch.yml` بيشغّله على GitHub، ومعطّل ما لم يُضبط
`ARW_WATCH_ENABLED=true` (المراقب الساعي بيغطّي نفس الفحوصات، فمش لازم يتشغّل الاتنين).

## الملفات

| الملف | إيه فيه |
|---|---|
| `.opencode/agents/site-guard.md` | تعليمات اللفة كاملة + الصلاحيات والممنوعات |
| `scripts/monitor/run-round.sh` | تشغيل الوكيل + تجهيز الحزم + تسجيل اللوج |
| `scripts/monitor/checks.ts` | قواعد الحكم على الأعطال (حتمية) |
| `scripts/monitor/watch.ts` | جمع النتائج والتقرير |
| `scripts/monitor/config.json` | الصفحات والحدود الزمنية |
| `tests/monitor.test.mts` | بيقفل الصلاحيات والجدول والبوابة وحماية البناء |
| `tests/monitor-checks.test.mts` | بيقفل منطق الفحص الحتمي |

## لو اللفة وقفت

الـheartbeat بيبعتلك إيميل في نفس الساعة. الأسباب المعتادة والحل:

| السبب في رسالة الفشل | الحل |
|---|---|
| `التوثيق باظ` أو `401` | أعد تصدير التوثيق: `opencode auth export "OpenCode Console" \| gh secret set OPENCODE_AUTH -R m7mdibrahimo/arw-site` |
| `حصة الموديلات المجانية خلصت` | حدّد موديل مدفوع: `gh variable set ARW_GUARD_MODEL -R m7mdibrahimo/arw-site --body opencode/<model>` |
| `اللفة عدّت المهلة` | ارفع `ARW_GUARD_TIMEOUT` أو اختار موديل أسرع |
| المفتاح مقفول | `gh variable set ARW_GUARD_ENABLED -R m7mdibrahimo/arw-site --body true` |

**التوثيق صلاحيته ~١٨ يوم**: التوكن المصدَّر بيُستخدم زي ما هو على السيرفر (واتجدد تلقائيًا
من الـrefresh token). لو اللفة رجّعت خطأ توثيق، الأمر اللي فوق بيرجّعها في دقيقة.

## ملاحظات تشغيلية

- **البناء بيتأثر بأي ملف `.md` في المستودع**: Eleventy بيقرا أي `frontmatter` غير سليم
  ويكسّر البناء كله. `.opencode/` و`reports/` و`scripts/` و`tests/` في `.eleventyignore`،
  و`tests/monitor.test.mts` بيتأكد من كده في كل تشغيل.
- **الوكيل مايلمسش أي حاجة المتابع شايفها** — لا روابط ولا أقسام ولا نصوص. لو صفحة
  محتاجة تغيير ظاهر عشان تترتب، بيتكتب في الملخّص كاقتراح للمالك.
- **ممنوع** الدفع بالقوة، حذف أخبار أو عروض، لمس الأسرار، النشر على السوشيال، وصرف
  طلبات Gemini — دي مرفوضة على مستوى الأدوات مش مجرد تعليمات.
- اللوجات: `reports/guard/round-*.log` محليًا، وفي **artifacts** كل تشغيل على GitHub.
