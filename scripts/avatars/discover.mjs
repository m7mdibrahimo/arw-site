// Where each wrestler's official picture is (WWE.com superstar pages, AEW's roster): prints what each page offers, so
// the right one can be written into wrestlers.json. Run by .github/workflows/avatars-discover.yml.
import fs from 'node:fs';
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, redirect: 'follow' }); return { status: r.status, url: r.url, html: r.ok ? await r.text() : '' }; } catch (e) { return { status: 0, html: '', url: u, err: e.message }; } };
const imgs = (html) => [...new Set([...html.matchAll(/(?:src|data-src|srcset|content|href)="([^"]+\.(?:jpe?g|png|webp)[^"\s]*)/gi)].map((m) => m[1]))];
for (const w of list.filter((x) => x.fed === 'WWE')) {
  const r = await get(`https://www.wwe.com/superstars/${w.slug}`);
  const og = (r.html.match(/property="og:image" content="([^"]+)"/) || [])[1];
  console.log(`\n=== ${w.slug} ${r.status} ${r.url}\nog: ${og}`);
  for (const u of imgs(r.html).filter((u) => /talent|superstar|profile|headshot|bio/i.test(u)).slice(0, 8)) console.log('  ' + u);
}
for (const u of ['https://www.allelitewrestling.com/roster', 'https://www.allelitewrestling.com/aew-roster', 'https://www.allelitewrestling.com/']) {
  const r = await get(u);
  console.log(`\n=== AEW ${u} ${r.status} ${r.url} (${r.html.length} bytes)`);
  const links = [...new Set([...r.html.matchAll(/href="([^"]*(?:roster|wrestler|talent)[^"]*)"/gi)].map((m) => m[1]))];
  console.log('links: ' + links.slice(0, 60).join(' '));
  for (const i of imgs(r.html).slice(0, 60)) console.log('  ' + i);
}
for (const w of list.filter((x) => x.fed === 'AEW')) {
  for (const u of [`https://www.allelitewrestling.com/roster/${w.slug}`, `https://www.allelitewrestling.com/${w.slug}`]) {
    const r = await get(u);
    if (!r.html) { console.log(`--- ${w.slug} ${u} ${r.status}`); continue; }
    const og = (r.html.match(/property="og:image" content="([^"]+)"/) || [])[1];
    console.log(`=== ${w.slug} ${u} ${r.status} og: ${og}`);
    for (const i of imgs(r.html).slice(0, 10)) console.log('  ' + i);
    break;
  }
}
