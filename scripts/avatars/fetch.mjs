// The wrestlers' pictures a visitor can pick for a comment (owner 2026-10-14). One look for all of them (owner: «يهمني ان
// الصور تكون استايل واحد»), no title belts (titles change, the pictures stay):
//   WWE: the superstar's official profile cut-out on WWE.com;
//   AEW: the wrestler's free, recent photo on Wikimedia Commons (the one on their Wikipedia page; AEW's own roster cards
//        carry the site's design and the belts), its background taken away by scripts/avatars/cutout.py.
// Step 1 (this file): download each one to tmp/avatars/raw/ and write tmp/avatars/list.json with its credit.
// Step 2 (cutout.py): the face found, the same framing for everyone, on the promotion's colours → assets/avatars/.
// Run by .github/workflows/avatars.yml (those sites can't be reached from everywhere).
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'tmp/avatars/raw';
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ArabWrestlingAvatars/2.0', 'Accept-Language': 'en-US,en;q=0.9' };
const FREE = /^(cc[ -]?by(-sa)?|cc0|public domain|pd)/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
fs.mkdirSync(RAW, { recursive: true });

async function wwe(w) {
  const h = await (await fetch(w.page, { headers: UA })).text();
  const p = (h.match(/\/f\/styles\/talent_champion_xl\/public\/[^"\s,]+?\.png/) || [])[0];
  if (!p) throw new Error(`no profile picture on ${w.page}`);
  return { url: `https://www.wwe.com${p}`, credit: { owner: 'WWE', source: w.page, year: (p.match(/\/(20\d\d)\/\d\d\//) || [])[1] || '' } };
}
async function commons(w) {
  const sum = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.wiki)}`, { headers: UA })).json();
  const parts = String((sum.originalimage && sum.originalimage.source) || '').split('?')[0].split('/');
  const file = w.file || decodeURIComponent(parts.includes('thumb') ? parts[parts.length - 2] : parts[parts.length - 1]);
  if (!file) throw new Error('no picture on the Wikipedia page');
  const info = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1600&titles=${encodeURIComponent('File:' + file)}`, { headers: UA })).json();
  const ii = (Object.values(info.query.pages)[0].imageinfo || [])[0];
  if (!ii) throw new Error(`${file} is not on Commons`);
  const m = ii.extmetadata || {};
  const license = strip(m.LicenseShortName && m.LicenseShortName.value);
  if (!FREE.test(license)) throw new Error(`${file}: licence «${license}»`);
  const date = strip(m.DateTimeOriginal && m.DateTimeOriginal.value) || strip(m.DateTime && m.DateTime.value);
  return { url: ii.thumburl || ii.url, credit: { owner: strip(m.Artist && m.Artist.value) || 'Wikimedia Commons', license, source: ii.descriptionurl, year: (date.match(/20\d\d/) || [])[0] || '' } };
}

const out = [];
for (const w of list) {
  try {
    const { url, credit } = w.fed === 'WWE' ? await wwe(w) : await commons(w);
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const file = path.join(RAW, `${w.slug}${path.extname(url.split('?')[0]).toLowerCase() || '.jpg'}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    out.push({ ...w, file, ...credit });
    console.log(`✓ ${w.slug} ${credit.year} ${url}`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
fs.writeFileSync('tmp/avatars/list.json', JSON.stringify(out, null, 1));
if (out.length < list.length) { console.log(`${list.length - out.length} missing`); process.exit(1); }
