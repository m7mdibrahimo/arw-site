import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseDuplicateAnswer, duplicatePrompt } = await import('../scripts/editorial');
const candidates = [{ file: 'a.md', title: 't', body: 'b', tags: [] }] as any;

test('a duplicate verdict whose reason says «not a duplicate» is not a duplicate (#1206)', () => {
  const road = '{"duplicate_of":0,"reason":"الخبر الجديد يعتبر رداً وتفنيداً مباشراً للشائعة التي تناولها الخبر المنشور مسبقاً، وهو يندرج تحت بند \'رد صاحب الشأن أو نفي الشائعة\' الذي لا يعتبر تكراراً وفقاً للقواعد المذكورة."}';
  assert.equal(parseDuplicateAnswer(road, candidates), null);
  assert.equal(parseDuplicateAnswer('{"duplicate_of":0,"reason":"هذا الخبر ليس تكرارا"}', candidates), null);
  assert.equal(parseDuplicateAnswer('{"duplicate_of":0,"reason":"not a duplicate: new statement"}', candidates), null);
});

test('real duplicate reasons still skip the story', () => {
  const r = '{"duplicate_of":0,"reason":"الخبر الجديد يغطي نفس واقعة وفاة والد ار تروث، والتفاصيل الإضافية لا تشكل تطوراً جوهرياً في الحدث الأساسي."}';
  assert.equal(parseDuplicateAnswer(r, candidates)?.file, 'a.md');
  assert.equal(parseDuplicateAnswer('{"duplicate_of":0,"reason":"الخبر ليس إلا تكرارا لنفس الإعلان"}', candidates)?.file, 'a.md');
  assert.equal(parseDuplicateAnswer('{"duplicate_of":0,"reason":"نفس الخبر"}', candidates)?.file, 'a.md');
});

test('the duplicate prompt tells the model to answer null when it concludes the story is new', () => {
  assert.match(duplicatePrompt({ title: 'x', body: 'y', tags: [] } as any, candidates), /فاجعل duplicate_of قيمته null/);
});
