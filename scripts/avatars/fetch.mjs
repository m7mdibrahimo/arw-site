// The ready-made pictures a visitor can pick for a comment (owner 2026-10-14: «صور لابرز المصارعيين … من شركات wwe و
// aew», then «صور حديثة لاشكالهم صور رسمية … 2026»): each wrestler's official profile picture — WWE.com's superstar page,
// AEW's roster — cut round the head and set on the promotion's colours, so every picture looks like part of one set.
// Run by .github/workflows/avatars.yml (those sites can't be reached from everywhere): node scripts/avatars/fetch.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = 'assets/avatars';
const SIZE = 256;
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const page = new Map();
async function html(u) { if (!page.has(u)) page.set(u, await (await fetch(u, { headers: UA })).text()); return page.get(u); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The official picture's address */
async function source(w) {
  const h = await html(w.page);
  if (w.fed === 'WWE') {
    const p = (h.match(/\/f\/styles\/talent_champion_xl\/public\/[^"\s,]+?\.png/) || [])[0];
    return p && `https://www.wwe.com${p}`;
  }
  // AEW (a Wix page): the <img> whose alt is the wrestler's name; its original, without Wix's resizing
  for (const tag of h.match(/<img\b[^>]*>/g) || []) {
    if (!new RegExp(`alt="${esc(w.alt)}"`, 'i').test(tag)) continue;
    const src = (tag.match(/src="([^"]+)"/) || [])[1] || '';
    const m = src.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/]+?~mv2\.(?:png|jpe?g|webp))/);
    if (m) return m[1];
  }
  return null;
}

// the promotion's colours behind the picture: WWE red, AEW gold, both fading to the site's ink
const BACK = {
  WWE: ['#e2412f', '#5a1610'],
  AEW: ['#e4b43a', '#4a3608'],
};
const background = (fed) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${BACK[fed][0]}"/><stop offset="1" stop-color="${BACK[fed][1]}"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/></svg>`);

async function avatar(w, buf) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  if (meta.hasAlpha) {
    // a cut-out: trim the empty space, then the head and shoulders, a little room above the head
    const { data, info } = await sharp(buf).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
    const side = Math.round(Math.min(info.width, info.height) * (w.zoom ?? 0.62));
    const left = Math.max(0, Math.min(info.width - side, Math.round(info.width * (w.x ?? 0.5) - side / 2)));
    const pad = Math.round(side * 0.06);
    // (one pipeline each: sharp resizes before it extends, whatever order they are written in)
    const cut = await sharp(data).extract({ left, top: 0, width: side, height: Math.min(side - pad, info.height) })
      .extend({ top: pad, bottom: Math.max(0, side - pad - info.height), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const head = await sharp(cut).resize(SIZE, SIZE, { fit: 'cover', position: 'top' }).png().toBuffer();
    const back = await sharp(background(w.fed)).resize(SIZE, SIZE).png().toBuffer();
    return sharp(back).composite([{ input: head }]).webp({ quality: 84 }).toBuffer();
  }
  // a photo: a square from the top middle
  const side = Math.round(Math.min(meta.width, meta.height) * (w.zoom ?? 1));
  const left = Math.round(Math.max(0, Math.min(meta.width - side, meta.width * (w.x ?? 0.5) - side / 2)));
  const top = Math.round(Math.max(0, Math.min(meta.height - side, meta.height * (w.y ?? 0))));
  return img.extract({ left, top, width: side, height: side }).resize(SIZE, SIZE).webp({ quality: 84 }).toBuffer();
}

fs.mkdirSync(OUT, { recursive: true });
const credits = [];
for (const w of list) {
  try {
    const src = await source(w);
    if (!src) { console.log(`✗ ${w.slug}: no picture on ${w.page}`); continue; }
    const res = await fetch(src, { headers: UA });
    if (!res.ok) { console.log(`✗ ${w.slug}: ${res.status} ${src}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(OUT, `${w.slug}.webp`), await avatar(w, buf));
    const year = (src.match(/\/(20\d\d)\/\d\d\//) || [])[1] || '';
    credits.push({ slug: w.slug, ar: w.ar, en: w.en, fed: w.fed, owner: w.fed === 'WWE' ? 'WWE' : 'All Elite Wrestling', year, source: w.fed === 'WWE' ? w.page : 'https://www.allelitewrestling.com/aew-roster' });
    console.log(`✓ ${w.slug} ${year} ${src}`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
if (credits.length < list.length / 2) { console.log(`only ${credits.length} of ${list.length}: nothing saved`); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1) + '\n');
console.log(`${credits.length} of ${list.length} pictures`);
