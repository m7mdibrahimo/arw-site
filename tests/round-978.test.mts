// INCIDENTS #978: a news run amended another bot's commit after its own was dropped by the rebase, so all
// eight pushes were refused (fixed in scripts/cross-run-dedupe.ts — a round can't push workflow files). INCIDENTS #979: an English line inside «» closed an Arabic story, «( برفقة»,
// and «Pac» for PAC in the English edition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkArticle, autoFix, BLOCKING_QA_CODES } from '../scripts/news-qa';
import { fixEnglishNames } from '../scripts/english-edition';
import { keepOwnCommit } from '../scripts/cross-run-dedupe';

const body = (extra: string) => 'يرى بول هايمن أن مسيرة بروك ليسنر في UFC كانت ستظل خالية من الهزائم لولا الظروف الصحية التي واجهها. '.repeat(4) + '\n\n' + extra + '\n';

test('an English line wrapped in «» blocks the Arabic story', () => {
  const issues = checkArticle('بول هايمن يتحدث عن بروك ليسنر', body("«have diverticulitis, he would've never been defeated in UFC. Never. He'd still be champion today at»"));
  const hit = issues.find((i) => i.code === 'english_caption_line');
  assert.ok(hit, 'english_caption_line expected');
  assert.ok(BLOCKING_QA_CODES.includes('english_caption_line'));
});

test('an Arabic quote in «» with one English name is not an English line', () => {
  const issues = checkArticle('بول هايمن يتحدث عن بروك ليسنر', body('«أنا من يختار الجميع في رحلة Jericho Cruise بنفسي»'));
  assert.equal(issues.find((i) => i.code === 'english_caption_line'), undefined);
});

test('spaces inside brackets are removed', () => {
  assert.equal(autoFix('تغلب أوكس آدامز ( برفقة بريت رايان غوسيلين) على داتش.'), 'تغلب أوكس آدامز (برفقة بريت رايان غوسيلين) على داتش.');
  assert.equal(autoFix('فابولوس مولاه ( Fabulous Moolah ).'), 'فابولوس مولاه (Fabulous Moolah).');
});

test('PAC is written in capitals in the English edition', () => {
  assert.equal(fixEnglishNames('in memory of fellow wrestler Pac. The news of Pac\'s passing'), 'in memory of fellow wrestler PAC. The news of PAC\'s passing');
  assert.equal(fixEnglishNames('the Green Bay Packers and Pac-Man'), 'the Green Bay Packers and Pac-Man');
});

test('a run whose commit the rebase dropped gets its own commit back before the amend', () => {
  const calls: string[][] = [];
  const same = (args: string[]) => { calls.push(args); return args[0] === 'rev-parse' ? 'abc123' : ''; };
  assert.equal(keepOwnCommit(same), true);
  assert.deepEqual(calls.slice(2).map((c) => c[0]), ['add', 'commit']);
  assert.ok(calls[3].includes('--allow-empty'));
  const ahead = (args: string[]) => (args[1] === 'HEAD' ? 'mine' : 'theirs');
  assert.equal(keepOwnCommit(ahead), false);
});

test('every news watcher runs the cross-run step inside its push loop', () => {
  for (const wf of ['fightful-watcher', 'ringsidenews-watcher', 'wrestlinginc-watcher']) {
    const y = fs.readFileSync(`.github/workflows/${wf}.yml`, 'utf8');
    const loop = y.slice(y.indexOf('for i in {1..8}'));
    assert.ok(loop.indexOf('scripts/cross-run-dedupe.ts') < loop.indexOf('git commit --amend --no-edit'), wf);
  }
});
