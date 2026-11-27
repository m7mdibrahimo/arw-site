// INCIDENTS #1570: «John Travolta's famous scene from Pulp Fiction» (no «movie» word) became «عرض Pulp Fiction»;
// «الثمنينيات» and «هل يزال» reached the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixEventCalledMovie } from '../scripts/news-qa.ts';

test('#1570: a film named only by a scene or clip stays «فيلم»', () => {
  const src = "Gable responded by referencing John Travolta's famous scene from Pulp Fiction. \"You ever seen that John Travolta clip from Pulp Fiction where he walks in\"";
  assert.equal(fixEventCalledMovie('شبه وضعه بمشهد شهير للممثل جون ترافولتا في فيلم Pulp Fiction', src), 'شبه وضعه بمشهد شهير للممثل جون ترافولتا في فيلم Pulp Fiction');
});

test('#1570: a name the source never puts at an event stays «فيلم»', () => {
  assert.equal(fixEventCalledMovie('مثل فيلم Rocky Balboa', 'He trained like Rocky Balboa every day.'), 'مثل فيلم Rocky Balboa');
});

test('#1570: the spellings are in corrections.json', () => {
  const c = JSON.parse(readFileSync(new URL('../editorial/corrections.json', import.meta.url), 'utf8')).corrections;
  const has = (w: string, r: string) => c.some((e: any) => e.wrong === w && e.right === r);
  assert.ok(has('الثمنينيات', 'الثمانينيات'));
  assert.ok(has('هل يزال', 'هل لا يزال'));
});
