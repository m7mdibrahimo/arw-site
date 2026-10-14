// The wrestlers' pictures a visitor can pick for a comment (owner 2026-10-14): real photos taken in 2026 (or 2025, owner's later word), the face
// clear, cut square round it («تجيب صور ليهم حديثة ووشهم واضح فيها وتقصها علي وشهم بالظبط ولكن احدث صور 2026 فقط»).
// Free photos from Wikimedia Commons (their authors and licences are kept and shown under the pictures).
// Step 1 (this file): each star's photos taken in 2026, newest first, downloaded to tmp/avatars/raw/ and listed in
//   tmp/avatars/list.json. A photo counts only when it is surely of that star (a star's Commons category also holds
//   photos of the people they fought or stood with; a first run put other wrestlers' faces on stars' names):
//   - Commons says it depicts the star (structured data, P180) and no more than one other thing, or
//   - its file name has the star's name, and no one else's («and», «vs», «&», «with»), or
//   - it's in the star's own category and its description names them (photos named by a code, like the White House's).
//   Looked for in every file that depicts the star (search), and in the star's category and its «2026» sub-categories.
//   A photo whose name says another year (e.g. «SummerSlam 2025») is never one from 2026, whatever its date says.
//   «skip» (the reason) leaves a star out, «reject» (file names) leaves a photo out: what was seen wrong on the sheets.
//   The date is the one the photo was taken; the upload's only when the file has none (an old photo uploaded in 2026
//   carries its own date, so it isn't taken for one from 2026).
// Step 2 (cutout.py): the first with one clear, close face is cut round it; a star without one is left out.
// Run by .github/workflows/avatars.yml (Wikimedia can't be reached from everywhere).
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'tmp/avatars/raw';
// 2026 first; 2025 for a star with no clear 2026 photo (owner 2026-10-14: «لو عايز تحط 2025 مع 2026 عادي»)
const YEARS = ['2026', '2025'];
const yearOf = (s) => YEARS.find((y) => String(s).includes(y)) || '';
const MAX = 12; // candidates downloaded per star
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
// Wikimedia asks for a name and a way to reach whoever asks, and no hurry (it answered 429 to a faster run)
const WM = { 'User-Agent': 'ArabWrestlingAvatars/4.0 (https://arab-wrestling.com; comment avatars)' };
const FREE = /^(cc[ -]?by(-sa)?|cc0|public domain|pd)/i;
const API = 'https://commons.wikimedia.org/w/api.php?format=json&';
const WP = 'https://en.wikipedia.org/w/api.php?format=json&';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OTHERS = /\b(and|vs|versus|with|feat|ft)\b|&| x /i;

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

/** The star's Wikidata item and Commons category (from their Wikipedia page; a search when the page's name has moved) */
async function who(w) {
  const page = async (title) => {
    const q = await wm(`${WP}action=query&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(title)}`);
    const p = Object.values(q.query.pages)[0] || {};
    return p.pageprops && p.pageprops.wikibase_item;
  };
  let qid = w.wiki ? await page(w.wiki.replace(/_/g, ' ')) : null;
  if (!qid) {
    const s = await wm(`${WP}action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(`${w.en} ${w.fed === 'UFC' ? 'fighter' : 'wrestler'}`)}`);
    const hit = ((s.query && s.query.search) || [])[0];
    // only a page about them: its name has theirs (a search can bring their promotion's page first)
    if (hit && plain(hit.title).includes(plain(w.en).split(' ').pop())) qid = await page(hit.title);
  }
  let cat = w.category || null;
  if (qid && !cat) {
    const e = await wm(`https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=claims&ids=${qid}`);
    const c = ((e.entities[qid] || {}).claims || {}).P373;
    if (c && c[0].mainsnak.datavalue) cat = 'Category:' + c[0].mainsnak.datavalue.value;
  }
  return { qid, cat };
}

/** The star's names as they'd be written in a file name: the whole ring name, or its last word when it's long enough */
function names(w) {
  const full = plain(w.en);
  const out = [full];
  const last = full.split(' ').pop();
  if (full.includes(' ') && last.length >= 5 && !['jr', 'sky', 'cole', 'page', 'jones', 'smith', 'jackson'].includes(last)) out.push(last);
  return out;
}

async function photos2026(w) {
  const { qid, cat } = await who(w);
  if (!qid && !cat) throw new Error('not found on Wikipedia/Commons');
  const files = new Set();
  const inCat = new Set();
  if (qid) {
    let off = 0;
    for (let k = 0, tries = 0; k < 3 && tries < 3; k++) {
      const s = await wm(`${API}action=query&list=search&srnamespace=6&srlimit=100&sroffset=${off}&srsearch=${encodeURIComponent('haswbstatement:P180=' + qid)}`);
      // the search sometimes answers with an error (too busy): asked again
      if (!s.query) { tries++; k--; await wait(4000); continue; }
      s.query.search.forEach((x) => files.add(x.title));
      if (!s.continue) break;
      off = s.continue.sroffset;
    }
  }
  if (cat) {
    const members = async (title) => (await wm(`${API}action=query&list=categorymembers&cmtype=file|subcat&cmsort=timestamp&cmdir=desc&cmlimit=200&cmtitle=${encodeURIComponent(title)}`)).query.categorymembers;
    try {
      for (const m of await members(cat)) {
        if (m.ns === 6) { files.add(m.title); inCat.add(m.title); }
        else if (m.ns === 14 && YEARS.some((y) => m.title.includes(y))) for (const f of await members(m.title)) if (f.ns === 6) { files.add(f.title); inCat.add(f.title); }
      }
    } catch (e) { console.log(`  ${w.slug}: ${cat}: ${e.message}`); }
  }
  const all = [...files].filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const found = [];
  for (let i = 0; i < all.length; i += 40) {
    const batch = all.slice(i, i + 40);
    const info = await wm(`${API}action=query&prop=imageinfo&iiprop=url|size|extmetadata|timestamp&iiurlwidth=3200&titles=${encodeURIComponent(batch.join('|'))}`);
    const keep = [];
    for (const pg of Object.values(info.query.pages)) {
      const ii = (pg.imageinfo || [])[0];
      if (!ii || Math.min(ii.width, ii.height) < 500) continue;
      const m = ii.extmetadata || {};
      const license = strip(m.LicenseShortName && m.LicenseShortName.value);
      const taken = m.DateTimeOriginal ? strip(m.DateTimeOriginal.value) : String(ii.timestamp || '');
      if (!FREE.test(license) || !yearOf(taken)) continue;
      if ((pg.title.match(/\b(19|20)\d\d/g) || []).some((y) => !YEARS.includes(y))) continue;
      if ((w.reject || []).includes(pg.title)) continue;
      keep.push({ id: pg.pageid, title: pg.title, about: plain(strip(m.ImageDescription && m.ImageDescription.value)), url: ii.thumburl || ii.url, owner: strip(m.Artist && m.Artist.value) || 'Wikimedia Commons', license, source: ii.descriptionurl, taken });
    }
    if (!keep.length) continue;
    // who's in it: Commons' «depicts»
    const sd = await wm(`${API}action=wbgetentities&props=claims&ids=${keep.map((k) => 'M' + k.id).join('|')}`);
    for (const k of keep) {
      const depicts = (((sd.entities || {})['M' + k.id] || {}).statements || {}).P180 || [];
      const ids = depicts.map((d) => d.mainsnak && d.mainsnak.datavalue && d.mainsnak.datavalue.value.id).filter(Boolean);
      const name = plain(k.title.replace(/^File:/, '').replace(/\.\w+$/, ''));
      // two people in it: only when its name doesn't say there's another (a «Breakker vs Rollins» is Breakker's face too)
      const byDepicts = qid && ids.includes(qid) && (ids.length === 1 || (ids.length === 2 && !OTHERS.test(k.title.replace(/^File:/, ''))));
      const byName = names(w).some((n) => ` ${name} `.includes(` ${n} `)) && !OTHERS.test(k.title.replace(/^File:/, '')) && ids.filter((x) => x !== qid).length <= 1;
      const byAbout = inCat.has(k.title) && names(w).some((n) => ` ${k.about} `.includes(` ${n} `));
      if (byDepicts || byName || byAbout) found.push({ ...k, why: byDepicts ? 'depicts' : byName ? 'name' : 'description' });
    }
  }
  // 2026's first, then 2025's (the dates are written many ways, so by their year, the order Commons gave within it)
  found.sort((a, b) => Number(yearOf(b.taken)) - Number(yearOf(a.taken)));
  console.log(`  ${w.slug}: ${qid || '-'} ${cat || '-'}, ${all.length} files, ${found.length} of them from ${YEARS.join('/')}`);
  const got = [];
  for (const [k, f] of found.slice(0, MAX).entries()) {
    const file = path.join(RAW, `${w.slug}-${k}${path.extname(f.url.split('?')[0]).toLowerCase() || '.jpg'}`);
    try { fs.writeFileSync(file, await wm(f.url, false)); got.push({ file, owner: f.owner, license: f.license, source: f.source, year: yearOf(f.taken), title: f.title, why: f.why }); }
    catch (e) { console.log(`  ${w.slug}: ${e.message}`); }
  }
  return got;
}

fs.mkdirSync(RAW, { recursive: true });
const out = [];
for (const w of list) {
  if (w.skip) { console.log(`✗ ${w.slug}: left out (${w.skip})`); continue; }
  try {
    const candidates = await photos2026(w);
    if (candidates.length) out.push({ ...w, candidates });
    console.log(`${candidates.length ? '✓' : '✗'} ${w.slug}: ${candidates.length} photos from ${YEARS.join('/')}`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
fs.writeFileSync('tmp/avatars/list.json', JSON.stringify(out, null, 1));
console.log(`${out.length} of ${list.length} stars have photos from ${YEARS.join('/')}`);
if (!out.length) process.exit(1);
