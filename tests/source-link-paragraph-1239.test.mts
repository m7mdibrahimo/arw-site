// INCIDENTS #1239: Fightful's own «Elsewhere in another interview, Paul Wight spoke about… You can read more about that
// here.» line reached Gemini as part of the news and became the story's last sentence; «طمحه» and «كنجح ناجح» went live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToPlainText } from '../scripts/fightful-watcher.ts';
import { applyCorrections } from '../scripts/news-qa.ts';

test('a paragraph that only links to another story is dropped from the source text', () => {
  const html = '<p>Jim Duggan recalled Vince McMahon banning card games.</p><p>"Skaaland said where did those cards come from."</p>'
    + '<p>Elsewhere in another interview, Paul Wight spoke about believing that Jim Duggan would get the role of Captain Insano. You can <a href="/x">read more about that here</a>.</p>';
  const text = htmlToPlainText(html);
  assert.ok(text.includes('banning card games'));
  assert.ok(text.includes('Skaaland'));
  assert.ok(!text.includes('Captain Insano'), text);
});

test('a normal paragraph that mentions reading is kept', () => {
  const text = htmlToPlainText('<p>He said he likes to read more books about history these days.</p>');
  assert.ok(text.includes('read more books'));
});

test('«طمحه» and «كنجح ناجح» are corrected', () => {
  assert.equal(applyCorrections('يظل طمحه ثابتا'), 'يظل طموحه ثابتا');
  assert.equal(applyCorrections('نظرة الجماهير إليه كنجح ناجح'), 'نظرة الجماهير إليه كنجم ناجح');
});
