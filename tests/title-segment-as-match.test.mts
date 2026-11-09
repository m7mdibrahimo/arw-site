import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, titleSegmentAsMatch } from '../scripts/news-qa';

// INCIDENTS #1184: «تفاصيل وموعد نزال غير معلن… WWE RAW» over a Cody Rhodes / Rey Mysterio segment.
test('an Arabic headline «نزال» over an English «segment» headline is caught', () => {
  assert.ok(titleSegmentAsMatch('تفاصيل وموعد نزال غير معلن مسبقا ضمن عرض WWE RAW الليلة', "Details on Unannounced Segment for Tonight's WWE RAW"));
  assert.equal(titleSegmentAsMatch('تفاصيل فقرة غير معلنة مسبقا في عرض WWE RAW الليلة', "Details on Unannounced Segment for Tonight's WWE RAW"), null);
  assert.equal(titleSegmentAsMatch('نزال جديد في عرض WWE RAW', 'New Match and Segment Set for WWE RAW'), null);
  assert.equal(titleSegmentAsMatch('نزال جديد في عرض WWE RAW', null), null);
});

// INCIDENTS #1184: «بطلي العالم للفرق بينتا وجيفون إيفانز سيفتتح العرض» — a construct dual the list missed.
test('«بطلي العالم» is a blocked dual', () => {
  const issues = checkArticle('عنوان خبر عن عرض الرو', 'تشير الترتيبات إلى أن بطلي العالم للفرق بينتا وجيفون إيفانز سيفتتح العرض الليلة في عرض WWE RAW المرتقب.');
  assert.ok(issues.some(i => i.code === 'dual_form'), JSON.stringify(issues.map(i => i.code)));
});
