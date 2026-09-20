/**
 * batch-fix-articles.ts
 * ═════════════════════
 * يطبّق كل التصحيحات على الأخبار الموجودة في content/news/
 * يشمل: أسماء المصارعين، إزالة الحروف الأجنبية، كلمة Live، وغيرها
 *
 * تشغيل: npx tsx scripts/batch-fix-articles.ts
 */

import fs from 'node:fs';
import path from 'node:path';

// Import shared fix functions from fightful-watcher
import {
  sanitizeWrestlingTerms,
  sanitizeAIWatermarks,
  applyNamesGlossary,
} from './fightful-watcher.js';

const NEWS_DIR = path.join(process.cwd(), 'content', 'news');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Frontmatter parser ────────────────────────────────────────────────────

function parseFrontmatterRaw(content: string): { frontmatter: string; body: string; separator: string } {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!match) return { frontmatter: '', body: content, separator: '' };
  return {
    frontmatter: match[2],
    body: match[4],
    separator: match[3],
  };
}

function getFrontmatterValue(fm: string, key: string): string {
  const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

function setFrontmatterValue(fm: string, key: string, value: string): string {
  // Escape special yaml chars
  const needsQuotes = /[:#\[\]{}&*!|>'"%@`]/.test(value) || value.includes('\n');
  const escaped = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
  
  const regex = new RegExp(`^(${key}:\\s*)(.+)$`, 'm');
  if (regex.test(fm)) {
    return fm.replace(regex, `$1${escaped}`);
  }
  return fm; // key not found, leave as-is
}

// ── Apply all fixes to text ───────────────────────────────────────────────

function applyAllFixes(text: string): string {
  if (!text) return text;
  let result = text;
  result = sanitizeAIWatermarks(result);    // remove Bengali/Hindi/foreign chars
  result = sanitizeWrestlingTerms(result);  // fix names, Live, terms
  result = applyNamesGlossary(result);      // apply wrestler-names.json
  return result;
}

// ── Process a single file ─────────────────────────────────────────────────

function processFile(filePath: string): { changed: boolean; changes: string[] } {
  const original = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body, separator } = parseFrontmatterRaw(original);
  
  if (!frontmatter && !body) return { changed: false, changes: [] };

  const changes: string[] = [];
  let newFm = frontmatter;
  let newBody = body;

  // Fix title field
  const title = getFrontmatterValue(frontmatter, 'title');
  if (title) {
    const fixedTitle = applyAllFixes(title);
    if (fixedTitle !== title) {
      newFm = setFrontmatterValue(newFm, 'title', fixedTitle);
      changes.push(`title: "${title}" → "${fixedTitle}"`);
    }
  }

  // Fix headline field
  const headline = getFrontmatterValue(frontmatter, 'headline');
  if (headline) {
    const fixedHeadline = applyAllFixes(headline);
    if (fixedHeadline !== headline) {
      newFm = setFrontmatterValue(newFm, 'headline', fixedHeadline);
      changes.push(`headline: "${headline}" → "${fixedHeadline}"`);
    }
  }

  // Fix description field
  const description = getFrontmatterValue(frontmatter, 'description');
  if (description) {
    const fixedDesc = applyAllFixes(description);
    if (fixedDesc !== description) {
      newFm = setFrontmatterValue(newFm, 'description', fixedDesc);
      changes.push(`description fixed`);
    }
  }

  // Fix tags field
  const tags = getFrontmatterValue(frontmatter, 'tags');
  if (tags) {
    const fixedTags = applyAllFixes(tags);
    if (fixedTags !== tags) {
      newFm = setFrontmatterValue(newFm, 'tags', fixedTags);
      changes.push(`tags fixed`);
    }
  }

  // Fix body content
  const fixedBody = applyAllFixes(body);
  if (fixedBody !== body) {
    newBody = fixedBody;
    changes.push(`body fixed (foreign chars / name corrections)`);
  }

  if (changes.length === 0) return { changed: false, changes: [] };

  // Reconstruct file
  const newContent = `---\n${newFm}${separator}${newBody}`;
  
  if (!DRY_RUN) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
  }

  return { changed: true, changes };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 Batch Fix Articles${DRY_RUN ? ' (DRY RUN — no files written)' : ''}`);
  console.log(`📂 Directory: ${NEWS_DIR}\n`);

  if (!fs.existsSync(NEWS_DIR)) {
    console.error('❌ content/news/ not found');
    process.exit(1);
  }

  const files = fs.readdirSync(NEWS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log(`📄 Found ${files.length} articles\n`);

  let fixed = 0;
  let unchanged = 0;
  let errors = 0;

  for (const fname of files) {
    const filePath = path.join(NEWS_DIR, fname);
    try {
      const { changed, changes } = processFile(filePath);
      if (changed) {
        fixed++;
        console.log(`✅ ${fname}`);
        for (const c of changes) {
          console.log(`   → ${c}`);
        }
      } else {
        unchanged++;
      }
    } catch (e: any) {
      errors++;
      console.error(`❌ ${fname}: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Fixed: ${fixed}`);
  console.log(`⏭️  Unchanged: ${unchanged}`);
  console.log(`❌ Errors: ${errors}`);
  
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — no files were modified. Remove --dry-run to apply.');
  } else {
    console.log('\n✅ All fixes applied. Commit and push to GitHub.');
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
