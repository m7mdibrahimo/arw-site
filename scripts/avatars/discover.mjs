// Where each wrestler's official picture is (WWE.com superstar pages, AEW's roster): prints what each page offers, so
// the right one can be written into wrestlers.json. Run by .github/workflows/avatars-discover.yml.
import fs from 'node:fs';
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, redirect: 'follow' }); return { status: r.status, url: r.url, html: r.ok ? await r.text() : '' }; } catch (e) { return { status: 0, html: '', url: u }; } };
for (const s of ['cm-punk', 'punk', 'cmpunk', 'c-m-punk']) {
  const r = await get(`https://www.wwe.com/superstars/${s}`);
  const p = (r.html.match(/\/f\/styles\/talent_champion_xl\/public\/[^"\s,]+/) || [])[0];
  console.log(`WWE ${s} ${r.status} ${p || ''}`);
}
const r = await get('https://www.allelitewrestling.com/aew-roster');
const h = r.html;
console.log('AEW roster', r.status, h.length);
for (const w of list.filter((x) => x.fed === 'AEW')) {
  const names = [w.en, w.en.toUpperCase(), w.en.replace('Hangman ', ''), w.en.replace('é', 'e')];
  let at = -1, used = '';
  for (const n of names) { at = h.indexOf(n); if (at >= 0) { used = n; break; } }
  if (at < 0) { console.log(`AEW ${w.slug}: name not found`); continue; }
  const around = h.slice(Math.max(0, at - 6000), at + 6000);
  const imgs = [...around.matchAll(/https:\/\/static\.wixstatic\.com\/media\/[^"\s)]+?~mv2\.(?:png|jpe?g|webp)/g)].map((m) => ({ u: m[0], d: Math.abs(m.index - 6000) }));
  imgs.sort((a, b) => a.d - b.d);
  console.log(`AEW ${w.slug} («${used}» ×${h.split(used).length - 1}):`);
  for (const i of [...new Map(imgs.map((x) => [x.u, x])).values()].slice(0, 4)) console.log(`   ${i.d} ${i.u}`);
  const alt = [...h.matchAll(new RegExp(`alt="([^"]*${used.split(' ').pop()}[^"]*)"`, 'gi'))].slice(0, 3).map((m) => m[1]);
  if (alt.length) console.log('   alt: ' + alt.join(' | '));
}
