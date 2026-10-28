# مراقبة موقع عرب راسلنج

المراقبة الساعية بيعملها **مراقب «كلود» المحلي** (مهمة مجدولة على جهاز المالك، في نسخة
`~/arw-monitor` الخاصة بيها). حارس «أوبن كود» على GitHub (`hourly-guard.yml` و
`guard-heartbeat.yml` و`run-round.sh` و`.opencode/`) **اتشال نهائيًا بطلب المالك في
2026-10-28** — مايرجعش، ومفيش أي وكيل تاني يتضاف للمراقبة.

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
`ARW_WATCH_ENABLED=true` (مراقب «كلود» المحلي الساعي بيغطّي نفس الفحوصات).

## الملفات

| الملف | إيه فيه |
|---|---|
| `scripts/monitor/checks.ts` | قواعد الحكم على الأعطال (حتمية) |
| `scripts/monitor/watch.ts` | جمع النتائج والتقرير |
| `scripts/monitor/config.json` | الصفحات والحدود الزمنية |
| `tests/monitor.test.mts` | بيقفل حماية البناء وملف خدمة الماك، وإن حارس «أوبن كود» مايرجعش |
| `tests/monitor-checks.test.mts` | بيقفل منطق الفحص الحتمي |

