// The ready-made pictures a visitor can pick for a comment (owner 2026-10-14: «صور لابرز المصارعيين … من شركات wwe و
// aew»). Each is the wrestler's free photo from Wikimedia Commons (the one on their Wikipedia page), cut to a square
// round the face, with its author and licence kept in assets/avatars/credits.json (shown under the pictures).
// Run by .github/workflows/avatars.yml (Wikipedia can't be reached from everywhere): node scripts/avatars/fetch.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = 'assets/avatars';
const list = JSON.parse(fs.readFileSync('scripts/avatars/wrestlers.json', 'utf8'));
const UA = { 'User-Agent': 'ArabWrestlingAvatars/1.0 (https://arab-wrestling.com; contact via site)' };
const FREE = /^(cc[ -]?by(-sa)?|cc0|public domain|pd)/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
fs.mkdirSync(OUT, { recursive: true });

const credits = [];
for (const w of list) {
  try {
    const sum = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.wiki)}`, { headers: UA })).json();
    const src = w.file ? null : sum.originalimage && sum.originalimage.source;
    const file = w.file || decodeURIComponent(String(src || '').split('/').pop());
    if (!file) { console.log(`✗ ${w.slug}: no picture on the page`); continue; }
    const info = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&titles=${encodeURIComponent('File:' + file)}`, { headers: UA })).json();
    const page = Object.values(info.query.pages)[0];
    const ii = page.imageinfo && page.imageinfo[0];
    if (!ii) { console.log(`✗ ${w.slug}: ${file} is not on Commons`); continue; }
    const m = ii.extmetadata || {};
    const license = strip(m.LicenseShortName && m.LicenseShortName.value);
    if (!FREE.test(license)) { console.log(`✗ ${w.slug}: ${file} licence «${license}»`); continue; }
    const buf = Buffer.from(await (await fetch(ii.thumburl || ii.url, { headers: UA })).arrayBuffer());
    const img = sharp(buf).rotate();
    const { width, height } = await img.metadata();
    // a portrait: the square from the top, where the face is (w.top moves it down, as a share of the height);
    // a wide picture: the square round what stands out
    let cut;
    if (height >= width) {
      const top = Math.round(Math.min(height - width, height * (w.top ?? 0.04)));
      cut = img.extract({ left: 0, top, width, height: width }).resize(256, 256);
    } else cut = img.resize(256, 256, { fit: 'cover', position: sharp.strategy.attention });
    await cut.webp({ quality: 82 }).toFile(path.join(OUT, `${w.slug}.webp`));
    credits.push({ slug: w.slug, ar: w.ar, en: w.en, fed: w.fed, author: strip(m.Artist && m.Artist.value) || 'Wikimedia Commons', license, licenseUrl: strip(m.LicenseUrl && m.LicenseUrl.value), source: ii.descriptionurl });
    console.log(`✓ ${w.slug}: ${file} (${license}, ${width}×${height})`);
  } catch (e) { console.log(`✗ ${w.slug}: ${e.message}`); }
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1) + '\n');
console.log(`${credits.length} of ${list.length} pictures`);
