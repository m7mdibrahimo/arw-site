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
import { findDuplicateCandidates, duplicatePrompt, parseDuplicateAnswer, newSubject, newMedicalOutcome, recordDuplicate } from "./editorial";
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
    const parsed = parseDuplicateAnswer(answer, candidates);
    const matched = parsed && candidates.find(c => c.file === parsed.file);
    // A story about someone the other one never mentions is its own story (INCIDENTS #150)
    const verdict = matched && (newSubject(mine, matched) || newMedicalOutcome(mine, matched)) ? null : parsed;
    if (verdict) hits.push({ file: mine.file, matchedFile: verdict.file, reason: verdict.reason || "نفس الخبر نزل من بوت تاني في نفس الوقت" });
    else if (!answer && sameLink) hits.push({ file: mine.file, matchedFile: sameLink.file, reason: "نفس المنشور المضمّن في خبر نزل من بوت تاني في نفس الوقت" });
  }
  return hits;
}

export interface ResultsReport { file: string; sourceTitle: string; date: number; sourceUrl?: string }
type ShowKey = (title: string) => { name: string; md: string };

/**
 * Results reports skip the story check above: each bot's own per-show guard (findSameShowResults) keeps one report per
 * show — but it only sees the site as it was when its run started. Fightful and Ringside News both published «WWE NXT
 * Results (27/10)» two minutes apart (INCIDENTS #910). The same show = the same name, and the same date when both titles
 * carry one (else written within 20 hours of each other).
 */
export function sameShowResultsAcrossRuns(ours: ResultsReport[], arrived: ResultsReport[], key: ShowKey): CrossRunHit[] {
  const hits: CrossRunHit[] = [];
  for (const mine of ours) {
    const k = key(mine.sourceTitle);
    if (!k.name || k.name.split(" ").length < 2) continue;
    const other = arrived.find(a => {
      const o = key(a.sourceTitle);
      return o.name === k.name && (k.md && o.md ? k.md === o.md : Math.abs(mine.date - a.date) < 20 * 3600_000);
    });
    if (other) hits.push({ file: mine.file, matchedFile: other.file, reason: "تقرير نتائج نفس العرض نزل من بوت تاني في نفس الوقت" });
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

function readResults(file: string): ResultsReport | null {
  try {
    const { data } = matter(fs.readFileSync(path.join(NEWS_DIR, file), "utf-8"));
    if (!data.source_title) return null;
    return { file, sourceTitle: String(data.source_title), date: data.date ? new Date(data.date).getTime() : 0, sourceUrl: data.source_url };
  } catch { return null; }
}
/** The English edition of a removed Arabic story (same source_id) goes with it. */
function removeEnglishPair(file: string) {
  try {
    const id = String(matter(fs.readFileSync(path.join(NEWS_DIR, file), "utf-8")).data.source_id ?? "");
    const dir = path.join(process.cwd(), "content", "news-en");
    if (!id || !fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(dir, f);
      if (String(matter(fs.readFileSync(full, "utf-8")).data.source_id ?? "") === id) fs.rmSync(full);
    }
  } catch {}
}

async function main() {
  const base = process.argv[2];
  if (!base) return;
  const oursFiles = addedNews("origin/main", "HEAD");
  const arrivedFiles = addedNews(base, "origin/main").filter(f => !oursFiles.includes(f));
  if (!oursFiles.length || !arrivedFiles.length) return;
  const ours = oursFiles.map(readNews).filter((n): n is NewsFile => !!n);
  const arrived = arrivedFiles.map(readNews).filter((n): n is NewsFile => !!n);
  const { queryGemini, showResultsKey } = await import("./fightful-watcher");
  const oursResults = oursFiles.map(readResults).filter((n): n is ResultsReport => !!n);
  const hits = [
    ...sameShowResultsAcrossRuns(oursResults, arrivedFiles.map(readResults).filter((n): n is ResultsReport => !!n), showResultsKey),
    ...(ours.length && arrived.length ? await crossRunDuplicates(ours, arrived, p => queryGemini(p, true, 0.1)) : []),
  ];
  for (const hit of hits) {
    const mine = ours.find(o => o.file === hit.file) || oursResults.find(o => o.file === hit.file)!;
    const full = path.join(NEWS_DIR, hit.file);
    removeEnglishPair(hit.file);
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
