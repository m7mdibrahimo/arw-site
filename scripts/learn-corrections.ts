// Turns the AI copy editor's recurring fixes into permanent rules.
// Every edit the editor makes is logged to editorial/proofread-log.jsonl. When the
// same short Arabic correction (a misspelled name or term) has been made in 3+
// different articles, it is promoted into editorial/corrections.json — from then
// on it is fixed deterministically AND shown to Gemini as a spelling never to use,
// so the mistake stops being generated at all.
//   npx tsx scripts/learn-corrections.ts [--dry-run] [--min 3]
import fs from "fs";
import path from "path";


const ARABIC_PHRASE = /^[ء-يـ]+(?: [ء-يـ]+){0,3}$/;
// Grammar words whose "fix" depends on the sentence, never on the word itself.
const CONTEXTUAL = new Set(["في", "من", "على", "إلى", "عن", "أن", "إن", "التي", "الذي", "هذا", "هذه", "كان", "كانت", "قد", "لقد", "و", "أو"]);

export function learnCorrections(minArticles = 3, dryRun = false): { wrong: string; right: string; articles: number }[] {
  const LOG = path.join(process.cwd(), "editorial", "proofread-log.jsonl");
  const CORRECTIONS = path.join(process.cwd(), "editorial", "corrections.json");
  const GLOSSARY = path.join(process.cwd(), "scripts", "wrestler-names.json");
  if (!fs.existsSync(LOG)) return [];
  const data = JSON.parse(fs.readFileSync(CORRECTIONS, "utf-8"));
  const corrections: any[] = data.corrections;
  const canonical = new Set<string>([...corrections.map(c => c.right), ...Object.values(JSON.parse(fs.readFileSync(GLOSSARY, "utf-8"))) as string[]]);
  const known = new Set(corrections.filter(c => !c.regex).map(c => c.wrong));

  const seen = new Map<string, Set<string>>();
  const targets = new Map<string, Set<string>>();
  for (const line of fs.readFileSync(LOG, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const find = String(e.find || "").trim(), replace = String(e.replace || "").trim();
    if (!ARABIC_PHRASE.test(find) || !ARABIC_PHRASE.test(replace) || find === replace) continue;
    if (find.split(" ").some(w => CONTEXTUAL.has(w)) || find.length < 4) continue;
    const key = `${find}\u0000${replace}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(String(e.file));
    if (!targets.has(find)) targets.set(find, new Set());
    targets.get(find)!.add(replace);
  }

  const learned: { wrong: string; right: string; articles: number }[] = [];
  for (const [key, files] of seen) {
    const [wrong, right] = key.split("\u0000");
    if (files.size < minArticles) continue;
    if (targets.get(wrong)!.size > 1) continue;    // editor isn't consistent about it — not a rule
    if (known.has(wrong) || canonical.has(wrong)) continue; // already handled, or would undo an approved spelling
    if (known.has(right)) continue;                 // would create a correction loop
    learned.push({ wrong, right, articles: files.size });
  }
  if (learned.length && !dryRun) {
    for (const l of learned) corrections.push({ wrong: l.wrong, right: l.right, note: `تعلّمها المدقق الآلي من ${l.articles} أخبار` });
    fs.writeFileSync(CORRECTIONS, JSON.stringify(data, null, 1));
  }
  return learned;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const min = Number(args[args.indexOf("--min") + 1]) || 3;
  const learned = learnCorrections(min, args.includes("--dry-run"));
  console.log(learned.length ? learned.map(l => `learned: ${l.wrong} → ${l.right} (${l.articles} articles)`).join("\n") : "Nothing new to learn.");
}
