import fs from 'node:fs';
const file = '_data/show-reel-state.json';
async function save() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to save publishing state.');
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || 'm7mdibrahimo/arw-site'}/contents/${file}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'arw-reel-monitor' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url + '?ref=main', { headers });
    if (!response.ok && response.status !== 404) throw new Error(`State read failed: ${response.status}`);
    const data: any = response.status === 404 ? {} : await response.json();
    const remote = data.content ? JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) : {};
    const merged = { ...remote };
    for (const [key, value] of Object.entries(local) as [string, any][]) {
      const old = remote[key];
      if (!old) { merged[key] = value; continue; }
      const latest = (value.lastAttempt || 0) >= (old.lastAttempt || 0) ? value : old;
      const entry = { ...old, ...latest, errors: { ...latest.errors } };
      for (const p of ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story']) {
        entry[p] = !!(old[p] || value[p]);
        if (entry[p]) delete entry.errors[p];
      }
      entry.reviewPlatforms = (latest.reviewPlatforms || []).filter((p: string) => !entry[p]);
      entry.needsReview = entry.reviewPlatforms.length > 0;
      const dates = [old.publishedAt, value.publishedAt].filter(Boolean);
      entry.publishedAt = dates.length ? Math.min(...dates) : null;
      merged[key] = entry;
    }
    if (JSON.stringify(remote) === JSON.stringify(merged)) { console.log('Publishing state unchanged.'); return; }
    const result = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({
      message: 'chore(reels): save publishing results [skip ci]', branch: 'main', sha: data.sha,
      content: Buffer.from(JSON.stringify(merged, null, 2)).toString('base64'),
    }) });
    if (result.ok) { console.log('Publishing results saved.'); return; }
    if (![409, 422].includes(result.status)) throw new Error(`State write failed: ${result.status}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Publishing state could not be saved after five conflicts.');
}
save().catch(error => { console.error(error.message); process.exitCode = 1; });
