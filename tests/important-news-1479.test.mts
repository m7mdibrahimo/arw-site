// INCIDENTS #1479: the owner — «الاخبار عندي كتير ملهاش لازمة ومحدش بيشوفها خليك في المهم ال ممكن يتشاف فقط». The site's
// own statistics (8–20 Nov): "high" stories 4.2 views each, WWE/AEW "normal" 2.5, the rest 0.3–1.6 with a third unopened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newsWorthPublishing } from '../scripts/fightful-watcher';

test('INCIDENTS #1479: results reports and big stories always; normal only from WWE/AEW; low never', () => {
  assert.equal(newsWorthPublishing('low', 'WWE', true), true, 'a show results report is always published');
  assert.equal(newsWorthPublishing('high', 'TNA', false), true);
  assert.equal(newsWorthPublishing('high', 'INDIE', false), true);
  assert.equal(newsWorthPublishing('normal', 'WWE', false), true);
  assert.equal(newsWorthPublishing('normal', 'AEW', false), true);
  assert.equal(newsWorthPublishing('normal', 'TNA', false), false);
  assert.equal(newsWorthPublishing('normal', 'INDIE', false), false);
  assert.equal(newsWorthPublishing('low', 'WWE', false), false);
  assert.equal(newsWorthPublishing('low', 'AEW', false), false);
});

test('INCIDENTS #1479: an unrated story (the rating call failed) counts as normal, so a bad hour never empties the site', () => {
  assert.equal(newsWorthPublishing(undefined, 'WWE', false), true);
  assert.equal(newsWorthPublishing(undefined, 'INDIE', false), false);
});

test('INCIDENTS #1479: only automatic runs skip; the panel\'s manual publish and a kept address always go through, and the skip is remembered', () => {
  const src = fs.readFileSync('scripts/fightful-watcher.ts', 'utf8');
  assert.match(src, /if \(!options\.manual && !options\.keepUrl && !newsWorthPublishing\(socialVerdict\?\.priority, rewritten\.federation \|\| "WWE", isShowResultsArticle\(rawTitle, plainText\)\)\) \{/);
  const block = src.slice(src.indexOf('!newsWorthPublishing(socialVerdict'), src.indexOf('!newsWorthPublishing(socialVerdict') + 600);
  assert.match(block, /noteOutcome\(postUrl, "خبر مش مهم كفاية: الموقع بينشر الأخبار المهمة بس"\);\n    return false;/);
  assert.doesNotMatch(block, /lastPostRetryable = true/, 'not retried next run');
});
