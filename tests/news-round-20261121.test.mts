import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isUnrelatedTopicTag } from '../scripts/fightful-watcher.ts';

test('a one-word topic tag the story never mentions is dropped (Jarrett «تطعيم», round 2026-11-21)', () => {
  assert.equal(isUnrelatedTopicTag('تطعيم', 'جيف جاريت يكشف تفاصيل أزمات سفره', 'تعليق رحلات الطيران ومساعد الطيار'), true);
  assert.equal(isUnrelatedTopicTag('تطعيم', 'فال فينيس يثير الجدل', 'بسبب ذلك التطعيم'), false);
  assert.equal(isUnrelatedTopicTag('WWE', 'x', 'y'), false);
  assert.equal(isUnrelatedTopicTag('أخبار المصارعة', 'x', 'y'), false);
});

test('corrections carry the viewership and «مهزلة» fixes (round 2026-11-21)', () => {
  const c = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf8')).corrections as { wrong: string; right: string }[];
  const get = (w: string) => c.find(e => e.wrong === w)?.right;
  assert.equal(get('نسبة مشاهدات بلغت'), 'عدد مشاهدين بلغ');
  assert.equal(get('في مهزلة التغييرات'), 'في دوامة التغييرات');
  assert.equal(get('مؤشرا ثقة'), 'مؤشر ثقة');
});
