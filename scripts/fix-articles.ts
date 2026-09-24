// Repairs already-published articles with the same editorial layers the watcher
// now applies to new ones (scripts/editorial.ts):
//   npx tsx scripts/fix-articles.ts --days 4 [--ai] [--dry-run]
//   npx tsx scripts/fix-articles.ts --files a.md,b.md --ai
//   npx tsx scripts/fix-articles.ts --all            (deterministic fixes only)
// Edits are surgical (title line, tag lines, body) so frontmatter formatting is
// untouched. A changed title gets an explicit `permalink:` pinned to the old URL,
// because the default permalink is derived from the title (see content/news/news.json)
// and changing it would 404 every link already shared.
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { autoFix, applyCorrections, checkArticle } from "./news-qa";
import { proofreadPrompt, parseProofEdits, applyProofEdits, logProofEdits, type ArticleDraft, type ProofEdit } from "./editorial";
import { queryGemini, buildNamesGlossaryHint } from "./fightful-watcher";
// @ts-ignore — CommonJS helper shared with eleventy.config.js
import { arabicSlug } from "../lib/slug.cjs";

const NEWS_DIR = path.join(process.cwd(), "content", "news");

interface Parsed { header: string; body: string; title: string; tags: string[]; date: number }
function parse(raw: string): Parsed | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const header = m[1];
  // YAML parsing (not line regexes): titles are sometimes folded over several lines.
  let data: any;
  try { data = matter(raw).data; } catch { return null; }
  const title = String(data.title ?? "");
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const date = new Date(data.date ?? 0).getTime();
  return { header, body: m[2], title, tags, date };
}

function render(p: Parsed, next: ArticleDraft): string {
  let header = p.header;
  if (next.title !== p.title) {
    // Replace the whole title node, including any folded continuation lines.
    header = header.replace(/^title:.*(?:\n[ \t]+.*)*/m, `title: ${JSON.stringify(next.title)}`);
    if (!/^permalink:/m.test(header)) {
      header = header.replace(/^(title:.*)$/m, `$1\npermalink: ${JSON.stringify(`/news/${arabicSlug(p.title)}/index.html`)}`);
    }
  }
  if (next.tags.join("\n") !== p.tags.join("\n")) {
    const yamlTag = (t: string) => /^[\w\u0600-\u06FF][^:#"'\[\]{},&*!|>%@`]*$/.test(t) ? t : JSON.stringify(t);
    header = header.replace(/^tags:.*\n(?:[ \t]+-\s.*\n?)*/m, `tags:\n${next.tags.map(t => `  - ${yamlTag(t)}`).join("\n")}\n`);
  }
  return `---\n${header.replace(/\n+$/, "")}\n---\n${next.body}`;
}

// Corrections first (they resolve multi-word transliterations like "دبليو دبليو إي"
// that autoFix's repeated-word rule must never see), then autoFix, then again.
const fixText = (t: string) => applyCorrections(autoFix(applyCorrections(t)));
const deterministic = (d: ArticleDraft): ArticleDraft => ({
  title: fixText(d.title),
  body: fixText(d.body),
  tags: [...new Set(d.tags.map(fixText))],
});

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  const useAi = args.includes("--ai");
  const dryRun = args.includes("--dry-run");
  let files = fs.readdirSync(NEWS_DIR).filter(f => f.endsWith(".md"));
  if (arg("--files")) files = arg("--files")!.split(",").map(f => path.basename(f.trim())).filter(Boolean);
  const days = Number(arg("--days") || 0);
  const report: any[] = [];
  let changed = 0;
  for (const file of files.sort()) {
    const filePath = path.join(NEWS_DIR, file);
    if (!fs.existsSync(filePath)) { console.warn(`missing: ${file}`); continue; }
    const raw = fs.readFileSync(filePath, "utf-8");
    const p = parse(raw);
    if (!p) continue;
    if (days && !arg("--files") && Date.now() - p.date > days * 86400_000) continue;

    let draft = deterministic({ title: p.title, body: p.body, tags: p.tags });
    let applied: ProofEdit[] = [];
    if (useAi) {
      const issues = checkArticle(draft.title, draft.body, draft.tags);
      const edits = parseProofEdits(await queryGemini(proofreadPrompt(draft, p.title,
        "(المصدر الإنجليزي غير متاح لهذا الخبر المنشور — أصلح الأخطاء اللغوية والإملائية وصيغ الأسماء العربية فقط. ممنوع تغيير أي معلومة أو رقم أو تاريخ أو كلمة إنجليزية، وممنوع استبدال كلمة صحيحة بمرادف.)",
        buildNamesGlossaryHint(`${draft.title}\n${draft.body}`), issues), true, 0.1));
      if (edits) ({ article: draft, applied } = applyProofEdits(draft, edits));
      else console.warn(`AI unavailable for ${file}`);
      draft = deterministic(draft);
      await new Promise(r => setTimeout(r, 4500)); // stay under the free-tier per-minute limit
    }
    const next = render(p, draft);
    if (next === raw) continue;
    // Never write a file whose frontmatter no longer parses or lost its title/tags.
    try {
      const check = matter(next).data;
      if (String(check.title) !== draft.title || (p.tags.length && (check.tags || []).length !== draft.tags.length)) throw new Error("frontmatter mismatch");
    } catch (e: any) {
      console.error(`⛔ skipped ${file}: ${e.message}`);
      continue;
    }
    changed++;
    report.push({ file, titleBefore: p.title, titleAfter: draft.title, aiEdits: applied });
    console.log(`✏️  ${file}${draft.title !== p.title ? `\n    title: ${p.title}\n        → ${draft.title}` : ""}${applied.length ? `\n    AI: ${applied.map(e => `«${e.find}» → «${e.replace}»`).join(" | ")}` : ""}`);
    if (!dryRun) {
      fs.writeFileSync(filePath, next, "utf-8");
      logProofEdits(file, applied);
    }
  }
  const out = arg("--report");
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${dryRun ? "[dry-run] " : ""}${changed} article(s) changed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
