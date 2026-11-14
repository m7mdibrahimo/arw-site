// INCIDENTS #1293: «ري ميستيريو يقدم العضو الجديد لفريق المكسيك» hid who joined (Rey Fénix), and the CMLL
// results wrote «هومبرء بالا»، «كيمنيتو»، «كيمليتو» and «نزال من جولات ثلاث».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkArticle } from '../scripts/news-qa.ts';

const body = 'أعلن ري ميستيريو عن انضمام ري فينيكس إلى فريق المكسيك قبل نزال Survivor Series. '.repeat(4);
const codes = (t: string) => checkArticle(t, body).map(i => i.code);

test('a headline with «العضو الجديد» and no name is blocked', () => {
  assert.ok(codes('ري ميستيريو يقدم العضو الجديد لفريق المكسيك في عرض WWE SmackDown').includes('unnamed_person_title'));
});

test('the headline that names him passes', () => {
  assert.ok(!codes('ري ميستيريو يقدم ري فينيكس عضوا جديدا في فريق المكسيك بعرض WWE SmackDown').includes('unnamed_person_title'));
});

test('glossary and corrections carry the CMLL names', () => {
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Hombre Bala Jr.'], 'هومبري بالا جونيور');
  assert.equal(names['KeMonito'], 'كيمونيتو');
  assert.equal(names['KeMalito'], 'كيماليتو');
  const wrong = JSON.parse(fs.readFileSync('editorial/corrections.json', 'utf8')).corrections.map((c: any) => c.wrong);
  for (const w of ['هومبرء بالا', 'كيمنيتو', 'كيمليتو', 'من جولات ثلاث']) assert.ok(wrong.includes(w), w);
});
