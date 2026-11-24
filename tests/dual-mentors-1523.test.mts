import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, BLOCKING_QA_CODES } from '../scripts/news-qa';

const codes = (title: string, body = 'نص عادي.') => checkArticle(title, body).map((i) => i.code);

// INCIDENTS #1523: «معلمتيها» / «نجمتي WWE» / «أسطورتين» reached the site in the Zoey Serrano story.
test('construct and plain duals of mentor/star/legend are blocked', () => {
  assert.ok(codes('زوي سيرانو تؤكد استمرار تواصلها مع معلمتيها في WWE').includes('dual_noun'));
  assert.ok(codes('عنوان', 'ما زالت على تواصل مع نجمتي WWE بيكي لينش وتريش ستراتوس.').includes('dual_noun'));
  assert.ok(codes('عنوان', 'منحتها فرصة التعلم من أسطورتين في المصارعة.').includes('dual_noun'));
  assert.ok(BLOCKING_QA_CODES.has ? BLOCKING_QA_CODES.has('dual_noun') : (BLOCKING_QA_CODES as any).includes('dual_noun'));
});

test('plural and singular forms stay allowed', () => {
  const c = codes('زوي سيرانو تؤكد استمرار تواصلها مع بيكي لينش وتريش ستراتوس', 'تعلمت من أساطير المصارعة ومن معلمتها ومن نجمات WWE.');
  assert.ok(!c.includes('dual_noun'));
});
