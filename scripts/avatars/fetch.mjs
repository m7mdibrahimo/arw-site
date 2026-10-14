// The wrestlers' pictures a visitor can pick for a comment (owner 2026-10-14). One look for all of them (owner: «يهمني ان
// الصور تكون استايل واحد»), recent, no title belts (titles change, the pictures stay):
//   WWE: the superstar's official profile cut-out on WWE.com;
//   AEW: the wrestler's newest free photo on Wikimedia Commons (AEW's own roster cards carry its site's design and the
//        belts), its background taken away by scripts/avatars/cutout.py.
// Step 1 (this file): download the candidates to tmp/avatars/raw/ and list them in tmp/avatars/list.json with credits.
// Step 2 (cutout.py): the best one chosen, its face found, the same framing for everyone, on the promotion's colours.
// Run by .github/workflows/avatars.yml (those sites can't be reached from everywhere).
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'tmp/avatars/raw';
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
// Wikimedia asks for a name and a way to reach whoever asks, and no hurry (it answered 429 to a faster run)
const WM = { 'User-Agent': 'ArabWrestlingAvatars/2.1 (https://arab-wrestling.com; comment avatars, a few dozen requests)' };
const FREE = /^(cc[ -]?by(-sa)?|cc0|public domain|pd)/i;
const API = 'https://commons.wikimedia.org/w/api.php?format=json&';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function wm(url, json = true) {
  for (let i = 0; i < 5; i++) {
    await wait(1200);
    const r = await fetch(url, { headers: WM });
    if (r.status === 429 || r.status >= 500) { await wait(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return json ? r.json() : Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`Wikimedia keeps refusing ${url}`);
}

async function wwe(w) {
  const h = await (await fetch(w.page, { headers: UA })).text();
  const p = (h.match(/\/f\/styles\/talent_champion_xl\/public\/[^"\s,]+?\.png/) || [])[0];
  if (!p) throw new Error(`no profile picture on ${w.page}`);
  const r = await fetch(`https://www.wwe.com${p}`, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  const file = path.join(RAW, `${w.slug}.png`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return [{ file, owner: 'WWE', license: '', source: w.page, year: (p.match(/\/(20\d\d)\/\d\d\//) || [])[1] || '' }];
}

/** AEW: the newest free photos of the wrestler on Commons (their category and its 2023–2026 sub-categories), the
 *  Wikipedia page's own photo last; cutout.py takes the newest with one clear face looking at the camera */
async function commons(w) {
  const sum = await wm(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.wiki)}`);
  const parts = String((sum.originalimage && sum.originalimage.source) || '').split('?')[0].split('/');
  const lead = decodeURIComponent(parts.includes('thumb') ? parts[parts.length - 2] : parts[parts.length - 1]);
  const files = new Set(lead ? [lead] : []);
  if (lead) {
    const c = await wm(`${API}action=query&prop=categories&clshow=!hidden&cllimit=50&titles=${encodeURIComponent('File:' + lead)}`);
    const cats = ((Object.values(c.query.pages)[0] || {}).categories || []).map((x) => x.title);
    const last = plain(w.en.split(' ').pop());
    const cat = w.category || cats.find((t) => plain(t).includes(last) && !/\b(19|20)\d\d\b/.test(t)) || cats.find((t) => plain(t).includes(last));
    if (cat) {
      const members = async (title) => (await wm(`${API}action=query&list=categorymembers&cmtype=file|subcat&cmsort=timestamp&cmdir=desc&cmlimit=60&cmtitle=${encodeURIComponent(title)}`)).query.categorymembers;
      for (const m of await members(cat)) {
        if (m.ns === 6) files.add(m.title.slice(5));
        else if (m.ns === 14 && /\b202[3-6]\b/.test(m.title)) for (const f of await members(m.title)) if (f.ns === 6) files.add(f.title.slice(5));
      }
      console.log(`  ${w.slug}: ${cat}, ${files.size} files`);
    } else console.log(`  ${w.slug}: no category among ${cats.join(' | ')}`);
  }
  const names = [...files].filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).slice(0, 60);
  const found = [];
  for (let i = 0; i < names.length; i += 15) {
    const q = names.slice(i, i + 15).map((f) => 'File:' + f).join('|');
    const info = await wm(`${API}action=query&prop=imageinfo&iiprop=url|size|extmetadata|timestamp&iiurlwidth=1600&titles=${encodeURIComponent(q)}`);
    for (const pg of Object.values(info.query.pages)) {
      const ii = (pg.imageinfo || [])[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const license = strip(m.LicenseShortName && m.LicenseShortName.value);
      if (!FREE.test(license) || Math.min(ii.width, ii.height) < 600) continue;
      const date = strip(m.DateTimeOriginal && m.DateTimeOriginal.value) || ii.timestamp;
      found.push({ title: pg.title, url: ii.thumburl || ii.url, owner: strip(m.Artist && m.Artist.value) || 'Wikimedia Commons', license, source: ii.descriptionurl, date, year: (String(date).match(/20\d\d/) || [])[0] || '' });
    }
  }
  found.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const pick = found.filter((f) => Number(f.year) >= 2023).slice(0, 7);
  const leadInfo = found.find((f) => f.title === 'File:' + lead);
  if (leadInfo && !pick.includes(leadInfo)) pick.push(leadInfo);
  if (!pick.length) throw new Error('no free photo found');
  const got = [];
  for (const [k, f] of pick.entries()) {
    const file = path.join(RAW, `${w.slug}-${k}${path.extname(f.url.split('?')[0]).toLowerCase() || '.jpg'}`);
    try {
      fs.writeFileSync(file, await wm(f.url, false));
      got.push({ file, owner: f.owner, license: f.license, source: f.source, year: f.year });
    } catch (e) { console.log(`  ${w.slug}: ${e.message}`); }
  }
  return got;
}

fs.mkdirSync(RAW, { recursive: true });
const out = [];
for (const w of list) {
  try {
    const candidates = w.fed === 'WWE' ? await wwe(w) : await commons(w);
    if (!candidates.length) throw new Error('nothing downloaded');
    out.push({ ...w, candidates });
    console.log(`✓ ${w.slug}: ${candidates.map((c) => c.year || '?').join(' ')}`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
fs.writeFileSync('tmp/avatars/list.json', JSON.stringify(out, null, 1));
if (out.length < list.length) { console.log(`${list.length - out.length} missing`); process.exit(1); }
