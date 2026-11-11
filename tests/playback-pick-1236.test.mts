// INCIDENTS #1236: show pages now start their server list with a locked «سيرفر مميز» row that has no data-srv in
// the HTML. The checker clicked servers by their place in the HTML list, so every check played the server before
// it, and a hidden server was put on the locked row — «no stream seen» kept working servers hidden for good.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickServerScript } from '../scripts/check-playback.ts';

function page(rows: { srv?: string; locked?: boolean }[]) {
  const clicked: string[] = [];
  const els = rows.map((r, i) => ({
    dataset: { ...(r.srv ? { srv: r.srv } : {}) } as Record<string, string>,
    classList: { contains: (c: string) => c === 'is-locked' && !!r.locked },
    click() { clicked.push(`${i}:${this.dataset.srv || ''}`); },
  }));
  const document = { querySelectorAll: () => els, getElementById: () => null };
  return { run: (code: string) => new Function('document', `return ${pickServerScript(code)}`)(document), clicked };
}

test('a server on the page is clicked by its own link, not by its place behind the locked premium row', () => {
  const p = page([{ locked: true }, { srv: 'AAA' }, { srv: 'BBB' }, { srv: 'CCC' }]);
  assert.equal(p.run('BBB'), 'own');
  assert.deepEqual(p.clicked, ['2:BBB']);
});

test('a hidden server is put on the first button a visitor can press, never on the locked one', () => {
  const p = page([{ locked: true, srv: 'PREM' }, { srv: 'AAA' }, { srv: 'CCC' }]);
  assert.equal(p.run('HIDDEN'), 'borrowed');
  assert.deepEqual(p.clicked, ['1:HIDDEN']);
});
