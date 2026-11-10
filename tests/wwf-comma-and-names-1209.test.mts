// INCIDENTS #1209: «عروض الدبليو دبليو إف» / «اتحاد دبليو دبليو إف،» stayed transliterated,
// «مكسيم كوليكشن» for MxM Collection, «قبل أن تتم الاستغناء عنه», «عمل مرتزقة».
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa.ts';
import { sanitizeWrestlingTerms } from '../scripts/fightful-watcher.ts';

test('promotion names before an Arabic comma or semicolon are put back in English', () => {
  assert.equal(sanitizeWrestlingTerms('خاض نزالات في اتحاد دبليو دبليو إف، قبل أن يعتزل'), 'خاض نزالات في WWF، قبل أن يعتزل');
  assert.match(sanitizeWrestlingTerms('شاهدت عرض سماك داون، وكان رائعا'), /WWE SmackDown،/);
});

test('corrections turn «الدبليو دبليو إف/إي» into WWF/WWE and keep a joined preposition', () => {
  assert.equal(applyCorrections('من يعمل في عروض الدبليو دبليو إف يجب'), 'من يعمل في عروض WWF يجب');
  assert.equal(applyCorrections('انضم للدبليو دبليو إي عام 2019'), 'انضم لـWWE عام 2019');
  assert.equal(applyCorrections('بعد رحيله عن الدبليو دبليو إي'), 'بعد رحيله عن WWE');
  assert.equal(applyCorrections('ملصق مصادقة من دبليو دبليو إف، ومرفقة'), 'ملصق مصادقة من WWF، ومرفقة');
});

test('names and grammar fixed for good', () => {
  assert.equal(applyCorrections('فوز إل ديسبيرادو ومكسيم كوليكشن'), 'فوز إل ديسبيرادو وإم إكس إم كوليكشن');
  assert.equal(applyCorrections('فومينوري آبي، دأنشوكو دينو'), 'فومينوري آبي، دانشوكو دينو');
  assert.equal(applyCorrections('مع كريس فان فيليت عبر'), 'مع كريس فان فليت عبر');
  assert.equal(applyCorrections('قبل أن تتم الاستغناء عنه'), 'قبل أن يتم الاستغناء عنه');
  assert.equal(applyCorrections('عندما عمل مرتزقة لصالح كريس جيريكو'), 'عندما عمل كمرتزق لصالح كريس جيريكو');
  // a real feminine subject is left alone
  assert.equal(applyCorrections('قبل أن تتم المباراة'), 'قبل أن تتم المباراة');
});
