// The wrestlers' pictures a visitor can pick for a comment (owner 2026-10-14): real photos taken in 2026 only, the face
// clear, cut square round it («تجيب صور ليهم حديثة ووشهم واضح فيها وتقصها علي وشهم بالظبط ولكن احدث صور 2026 فقط»).
// Free photos from Wikimedia Commons (their authors and licences are kept and shown under the pictures).
// Step 1 (this file): every 2026 photo of each star in their Commons category (and its «… in 2026» sub-category),
//   newest first, downloaded to tmp/avatars/raw/ and listed in tmp/avatars/list.json.
// Step 2 (cutout.py): the first with one clear, close face is cut round it; a star without one is left out.
// Run by .github/workflows/avatars.yml (Wikimedia can't be reached from everywhere).
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'tmp/avatars/raw';
const YEAR = '2026';
const MAX = 10; // candidates downloaded per star
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
// Wikimedia asks for a name and a way to reach whoever asks, and no hurry (it answered 429 to a faster run)
const WM = { 'User-Agent': 'ArabWrestlingAvatars/3.0 (https://arab-wrestling.com; comment avatars)' };
const FREE = /^(cc[ -]?by(-sa)?|cc0|public domain|pd)/i;
const API = 'https://commons.wikimedia.org/w/api.php?format=json&';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function wm(url, json = true) {
  for (let i = 0; i < 5; i++) {
    await wait(1100);
    const r = await fetch(url, { headers: WM });
    if (r.status === 429 || r.status >= 500) { await wait(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return json ? r.json() : Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`Wikimedia keeps refusing ${url}`);
}

/** The star's Commons category: «category» in wrestlers.json, or the one their Wikipedia photo is filed under */
async function category(w) {
  if (w.category) return w.category;
  const sum = await wm(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.wiki)}`);
  const parts = String((sum.originalimage && sum.originalimage.source) || '').split('?')[0].split('/');
  const lead = decodeURIComponent(parts.includes('thumb') ? parts[parts.length - 2] : parts[parts.length - 1]).replace(/_/g, ' ');
  if (!lead) return null;
  const c = await wm(`${API}action=query&prop=categories&clshow=!hidden&cllimit=50&titles=${encodeURIComponent('File:' + lead)}`);
  const cats = ((Object.values(c.query.pages)[0] || {}).categories || []).map((x) => x.title);
  const last = plain(w.en.split(' ').pop().replace(/\.$/, ''));
  return cats.find((t) => plain(t).includes(last) && !/\b(19|20)\d\d\b/.test(t)) || null;
}

async function photos2026(w) {
  const cat = await category(w);
  if (!cat) throw new Error('no Commons category');
  const members = async (title) => (await wm(`${API}action=query&list=categorymembers&cmtype=file|subcat&cmsort=timestamp&cmdir=desc&cmlimit=200&cmtitle=${encodeURIComponent(title)}`)).query.categorymembers;
  const files = [];
  for (const m of await members(cat)) {
    if (m.ns === 6) files.push(m.title);
    else if (m.ns === 14 && m.title.includes(YEAR)) for (const f of await members(m.title)) if (f.ns === 6) files.push(f.title);
  }
  const names = [...new Set(files)].filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const found = [];
  for (let i = 0; i < names.length && found.length < MAX * 2; i += 25) {
    const info = await wm(`${API}action=query&prop=imageinfo&iiprop=url|size|extmetadata|timestamp&iiurlwidth=1600&titles=${encodeURIComponent(names.slice(i, i + 25).join('|'))}`);
    for (const pg of Object.values(info.query.pages)) {
      const ii = (pg.imageinfo || [])[0];
      if (!ii || Math.min(ii.width, ii.height) < 500) continue;
      const m = ii.extmetadata || {};
      const license = strip(m.LicenseShortName && m.LicenseShortName.value);
      // taken in 2026: the camera's date, or (without one) the upload's
      const taken = strip(m.DateTimeOriginal && m.DateTimeOriginal.value) || ii.timestamp;
      if (!FREE.test(license) || !String(taken).includes(YEAR)) continue;
      found.push({ title: pg.title, url: ii.thumburl || ii.url, owner: strip(m.Artist && m.Artist.value) || 'Wikimedia Commons', license, source: ii.descriptionurl, taken });
    }
  }
  found.sort((a, b) => String(b.taken).localeCompare(String(a.taken)));
  console.log(`  ${w.slug}: ${cat}, ${names.length} files, ${found.length} from ${YEAR}`);
  const got = [];
  for (const [k, f] of found.slice(0, MAX).entries()) {
    const file = path.join(RAW, `${w.slug}-${k}${path.extname(f.url.split('?')[0]).toLowerCase() || '.jpg'}`);
    try { fs.writeFileSync(file, await wm(f.url, false)); got.push({ file, owner: f.owner, license: f.license, source: f.source, year: YEAR }); }
    catch (e) { console.log(`  ${w.slug}: ${e.message}`); }
  }
  return got;
}

fs.mkdirSync(RAW, { recursive: true });
const out = [];
for (const w of list) {
  try {
    const candidates = await photos2026(w);
    if (candidates.length) out.push({ ...w, candidates });
    console.log(`${candidates.length ? '✓' : '✗'} ${w.slug}: ${candidates.length} photos from ${YEAR}`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
fs.writeFileSync('tmp/avatars/list.json', JSON.stringify(out, null, 1));
console.log(`${out.length} of ${list.length} stars have photos from ${YEAR}`);
if (!out.length) process.exit(1);
