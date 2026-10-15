// The chat's emoji picker data (assets/emoji-data.json, loaded only when the picker opens).
// Made once from emojibase-data (en/data.json) and the CLDR Arabic annotations, then kept in the repo:
//   node scripts/build-emoji-data.mjs <emojibase en/data.json> <cldr annotations/ar/annotations.json> <cldr annotationsDerived/ar/annotations.json>
// Emoji up to version 14 only (what nearly every phone shows), no skin-tone parts on their own.
// Each one: [emoji, Arabic and English words to search by, 1 if it takes a skin tone].
import fs from "node:fs";
const [dataPath, arPath, arDerivedPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const ar = { ...JSON.parse(fs.readFileSync(arDerivedPath, "utf8")).annotationsDerived.annotations, ...JSON.parse(fs.readFileSync(arPath, "utf8")).annotations.annotations };
const strip = s => s.replace(/️/g, "");
const arOf = e => ar[e] || ar[strip(e)] || ar[e + "️"];
const GROUPS = [[0, "وجوه"], [1, "ناس"], [3, "حيوانات وطبيعة"], [4, "أكل وشرب"], [6, "أنشطة"], [5, "سفر وأماكن"], [7, "أشياء"], [8, "رموز"], [9, "أعلام"]];
const out = GROUPS.map(([g, name]) => {
  const list = data.filter(x => x.group === g && x.version <= 14).sort((a, b) => a.order - b.order).map(x => {
    const emoji = x.emoji.replace(/️$/, x.emoji.length <= 2 ? "️" : "");
    const a = arOf(x.emoji);
    // the words people would type: Arabic first, then English, each word once
    const split = l => [...new Set(l.join(" ").toLowerCase().split(/[\s:,]+/).filter(w => w.length > 1))];
    const words = [...split(a ? [...(a.tts || []), ...(a.default || [])] : []).slice(0, 14), ...split([x.label, ...(x.tags || [])]).slice(0, 8)].join(" ");
    const row = [emoji, words];
    // a skin tone goes right after the first character (the picker does that): kept only where that is the real one
    const toned = x.skins && x.skins.find(k => k.tone === 1);
    if (toned) { const [first, ...rest] = Array.from(strip(x.emoji)); if (strip(toned.emoji) === first + "\u{1F3FB}" + rest.join("")) row.push(1); }
    return row;
  });
  return [name, list];
});
fs.writeFileSync(new URL("../assets/emoji-data.json", import.meta.url), JSON.stringify(out));
console.log(out.map(([n, l]) => `${n}: ${l.length}`).join(", "), fs.statSync(new URL("../assets/emoji-data.json", import.meta.url)).size);
