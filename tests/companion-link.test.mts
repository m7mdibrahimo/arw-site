import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// A show and the recap of the same episode link to each other (INCIDENTS #475): the layout calls the filter
// and every recap has a show with the same program_name + event_date to point to when one exists.
test('show/recap companion link is wired in the layout and the config', () => {
  const layout = fs.readFileSync('_includes/post-layout.njk', 'utf-8');
  const cfg = fs.readFileSync('eleventy.config.js', 'utf-8');
  assert.match(cfg, /addFilter\("companionPage"/);
  assert.match(layout, /companionPage\(program_name, event_date, collections\.allContent\)/);
});

test('every recap whose episode has a show can be matched by program and event day', () => {
  const read = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const t = fs.readFileSync(path.join(dir, f), 'utf-8');
    const g = (k: string) => (t.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '') || '';
    return { prog: g('program_name').toLowerCase(), day: g('event_date').slice(0, 10) };
  });
  const shows = read('content/shows').filter((s) => s.prog && s.day);
  const recaps = read('content/recaps').filter((r) => r.prog && r.day);
  const matched = recaps.filter((r) => shows.some((s) => s.prog === r.prog && s.day === r.day));
  assert.ok(matched.length > 0, 'at least one recap shares program + event day with a show');
});
