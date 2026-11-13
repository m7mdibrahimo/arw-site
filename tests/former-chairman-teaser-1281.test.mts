// INCIDENTS #1281: «رئيس WWE فينس مكمان» (source: former chairman) went live in the JBL story, and Fightful's
// «Elsewhere in the interview… Check out his full comments by clicking here.» line got the main story's claim pinned on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { htmlToPlainText } from '../scripts/fightful-watcher.ts';
import { applyCorrections } from '../scripts/news-qa.ts';

test('Vince McMahon is never the current WWE chairman', () => {
  assert.equal(applyCorrections('بأن رئيس WWE فينس مكمان كان سيتصرف'), 'بأن رئيس WWE السابق فينس مكمان كان سيتصرف');
  assert.equal(applyCorrections('قدمها لرئيس اتحاد WWE فينس مكمان'), 'قدمها لرئيس اتحاد WWE السابق فينس مكمان');
  for (const s of ['رئيس WWE السابق فينس مكمان', 'الرئيس السابق لـWWE فينس مكمان', 'رئيس WWE نيك خان']) assert.equal(applyCorrections(s), s);
  assert.equal(applyCorrections('أكدت تقارير صحفية رسمية أن'), 'أكدت تقارير صحفية أن');
});

test('a «check out his full comments by clicking here» teaser is dropped from the source', () => {
  const t = htmlToPlainText('<p>Page proposed running three events first.</p><p>Elsewhere in the interview, Ethan Page criticized the format of the John Cena Classic. Check out his full comments by <a href="/x">clicking here</a>.</p>');
  assert.ok(t.includes('three events'));
  assert.ok(!t.includes('John Cena Classic'), t);
});

test('no published story calls Vince McMahon the current chairman', () => {
  for (const f of fs.readdirSync('content/news')) {
    const t = fs.readFileSync(`content/news/${f}`, 'utf-8');
    assert.ok(!/رئيس (?:مجلس إدارة )?(?:اتحاد )?WWE فينس مكمان/.test(t), f);
  }
});
