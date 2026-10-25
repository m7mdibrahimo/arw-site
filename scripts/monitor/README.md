# مراقبة موقع عرب راسلنج

جولة الإصلاح الساعية يديرها **Codex** من مهمة مجدولة في تطبيق Codex. تعليمات الجولة محفوظة محليًا في `~/.codex/automation-prompts/arw-hourly-monitor.md`. الوكيل يراجع الموقع والمستودع، يصلح المشاكل من جذورها، يختبر، ويدفع الإصلاحات المصرح بها إلى `main`.

هذه المهمة تعتمد على تشغيل جهاز المالك وتطبيق Codex. لا يوجد وكيل OpenCode أو Claude في مسار التشغيل.

## المراقب التقني

`watch.ts` فحص حتمي يمكن تشغيله يدويًا للصفحات الحية، نبض بوت الأخبار، تأخر النشر، تشغيلات GitHub، الاختبارات، والبناء. يكتب نتائجه في `reports/guard/` ولا يدفع تغييرات للمستودع.

```bash
npx tsx scripts/monitor/watch.ts
npx tsx scripts/monitor/watch.ts --with-tests
npx tsx scripts/monitor/watch.ts --json
npx tsx --test tests/monitor-checks.test.mts
```

ملفات المراقب:

- `checks.ts`: قواعد الحكم على الأعطال.
- `config.json`: الصفحات والحدود الزمنية.
- `watch.ts`: جمع النتائج والتقرير المحلي.
- `install-macos.sh`: تشغيل المراقب التقني على جهاز المالك عند الحاجة.
- `.github/workflows/site-watch.yml`: تشغيل تقني على GitHub؛ معطّل ما لم يُضبط المتغير `ARW_WATCH_ENABLED=true`. لا يشغّل وكيل إصلاح.
