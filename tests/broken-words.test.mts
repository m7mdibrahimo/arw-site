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
  assert.match(src, /"broken_word", "glued_latin_arabic", "detached_prefix"\]\.includes/);
  const issues = checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', 'تفادى محاولة حركة مونس ault من ريد ' + 'كلام '.repeat(80));
  assert.ok(issues.some(i => i.code === 'broken_word'));
});

test("detached_prefix blocks publishing and «ل الليلة» is corrected (INCIDENTS #410)", async () => {
  const { checkArticle, applyCorrections } = await import("../scripts/news-qa.ts");
  assert.ok(checkArticle("شاهد العرض الكامل من Lucha Libre AAA ل الليلة", "نص طويل بما يكفي ".repeat(20), []).some(i => i.code === "detached_prefix"));
  assert.equal(applyCorrections("شاهد Lucha Libre AAA ل الليلة"), "شاهد Lucha Libre AAA الليلة");
});
