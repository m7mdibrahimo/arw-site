// The three writer bots (Fightful, Ringside News, Wrestling Inc) run on their own schedules and
// can write the same story at the same moment: each one checks for duplicates against the site as
// it was when its run started, so neither sees the other's article. «Oba Femi vs. Bronson Reed»
// went out twice 45 seconds apart, same embedded WWE post, and both reached social (INCIDENTS #114).
//
// This runs in every bot's push loop, right after `git pull`: the articles this run adds are
// checked against the ones that arrived from other runs since this run started. Whoever pushes
// second always pulls the first one's article first, so the race is closed. A duplicate of ours
// is removed before the push — it never reaches the site or social.
//
//   npx tsx scripts/cross-run-dedupe.ts <commit this run started from>
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import matter from "gray-matter";
import { findDuplicateCandidates, duplicatePrompt, parseDuplicateAnswer, recordDuplicate } from "./editorial";
import type { NewsFile } from "./news-qa";

const NEWS_DIR = path.join(process.cwd(), "content", "news");

export interface CrossRunHit { file: string; matchedFile: string; reason: string }
type Judge = (prompt: string) => Promise<string | null>;

const statusLinks = (text: string) => new Set((text.match(/https?:\/\/\S+\/status\/\d+/gi) || []).map(u => u.replace(/[.,)\]]+$/, "")));

/** Which of `ours` repeat a story in `arrived` (articles other runs pushed meanwhile). */
export async function crossRunDuplicates(ours: NewsFile[], arrived: NewsFile[], judge: Judge, now = Date.now()): Promise<CrossRunHit[]> {
  const hits: CrossRunHit[] = [];
  if (!arrived.length) return hits;
  for (const mine of ours) {
    // The same embedded post (tweet) puts a story first in line; one tweet can carry two stories
    // (INCIDENTS #115), so the same-story check decides — and only if it can't answer, the tweet does.
    const links = statusLinks(mine.body);
    const sameLink = arrived.find(a => [...statusLinks(a.body)].some(l => links.has(l)));
    const found = findDuplicateCandidates(mine, arrived, now, 6).filter(c => c.file !== sameLink?.file);
    const candidates = (sameLink ? [sameLink, ...found] : found).slice(0, 5);
    if (!candidates.length) continue;
    const answer = await judge(duplicatePrompt(mine, candidates));
    const verdict = parseDuplicateAnswer(answer, candidates);
    if (verdict) hits.push({ file: mine.file, matchedFile: verdict.file, reason: verdict.reason || "نفس الخبر نزل من بوت تاني في نفس الوقت" });
    else if (!answer && sameLink) hits.push({ file: mine.file, matchedFile: sameLink.file, reason: "نفس المنشور المضمّن في خبر نزل من بوت تاني في نفس الوقت" });
  }
  return hits;
}

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { encoding: "utf-8" });
}
function addedNews(from: string, to: string): string[] {
  return git("diff", "--name-only", "--diff-filter=A", from, to, "--", "content/news")
    .split("\n").filter(f => f.endsWith(".md")).map(f => path.basename(f));
}
function readNews(file: string): NewsFile | null {
  try {
    const { data, content } = matter(fs.readFileSync(path.join(NEWS_DIR, file), "utf-8"));
    // Results reports have their own per-show guard (findExistingShowResults)
    if (data.source_title) return null;
    return { file, title: String(data.title || ""), body: content, tags: (data.tags || []).map(String),
      date: data.date ? new Date(data.date).getTime() : 0, sourceUrl: data.source_url };
  } catch { return null; }
}

async function main() {
  const base = process.argv[2];
  if (!base) return;
  const ours = addedNews("origin/main", "HEAD").map(readNews).filter((n): n is NewsFile => !!n);
  if (!ours.length) return;
  const arrived = addedNews(base, "origin/main").filter(f => !ours.some(o => o.file === f)).map(readNews).filter((n): n is NewsFile => !!n);
  if (!arrived.length) return;
  const { queryGemini } = await import("./fightful-watcher");
  const hits = await crossRunDuplicates(ours, arrived, p => queryGemini(p, true, 0.1));
  for (const hit of hits) {
    const mine = ours.find(o => o.file === hit.file)!;
    const full = path.join(NEWS_DIR, hit.file);
    const image = String(matter(fs.readFileSync(full, "utf-8")).data.image || "");
    fs.rmSync(full);
    // Its image goes too, unless another article uses it
    if (image.startsWith("/content/images/")) {
      const name = path.basename(image);
      const used = fs.readdirSync(NEWS_DIR).some(f => f.endsWith(".md") && fs.readFileSync(path.join(NEWS_DIR, f), "utf-8").includes(name));
      if (!used) fs.rmSync(path.join(process.cwd(), image.slice(1)), { force: true });
    }
    if (mine.sourceUrl) recordDuplicate(String(mine.sourceUrl), hit.matchedFile, hit.reason);
    console.log(`[Cross-run] 🔁 ${hit.file} repeats ${hit.matchedFile} (${hit.reason}) — removed before push.`);
  }
}

if (process.argv[1]?.endsWith("cross-run-dedupe.ts")) main().catch(e => { console.error("[Cross-run]", e); });
