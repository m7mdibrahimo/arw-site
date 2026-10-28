import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Two monitoring rounds (2026-10-28 09:21 and 10:25 UTC) spent their whole hour on a working tree that still had the
// markers of an unfinished `git pull --rebase`, and both ended without committing anything (INCIDENTS #926). The gate
// that runs the tests before the push would have stopped them in the first minute instead of the last.
test('no file in the repository carries the markers of an unresolved merge or rebase', () => {
  const START = '<'.repeat(7) + ' ';
  const END = '>'.repeat(7) + ' ';
  const MIDDLE = '='.repeat(7);
  // The two logs describe these markers on purpose.
  const skip = new Set(['INCIDENTS.md', 'GEMINI.md']);
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 }).split('\0').filter(Boolean);
  const bad: string[] = [];
  for (const f of files) {
    if (skip.has(f) || !/\.(?:m?[jt]s|cjs|json|njk|ya?ml|md|css|html)$/.test(f)) continue;
    let text: string;
    try { text = fs.readFileSync(f, 'utf-8'); } catch { continue; }
    if (text.length > 4_000_000) continue;
    const lines = text.split('\n');
    // «=======» alone is a Markdown rule, so only a start/end marker counts — and a start marker followed by an end
    // marker somewhere after it is a real conflict.
    const start = lines.findIndex((l) => l.startsWith(START));
    if (start > -1 && lines.some((l, n) => n > start && (l.startsWith(END) || l.trim() === MIDDLE))) bad.push(f);
  }
  assert.deepEqual(bad, [], `unresolved conflict markers in: ${bad.join(', ')} — finish the rebase before committing`);
});
