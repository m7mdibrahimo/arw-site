import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { arabicSlug } from '../lib/slug.cjs';

export const PLATFORMS = ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'] as const;
type Platform = typeof PLATFORMS[number];
type Entry = Record<Platform, boolean> & {
  publishedAt: number | null; lastAttempt?: number; title?: string;
  errors?: Record<string, string>; reviewPlatforms?: Platform[]; needsReview?: boolean; note?: string;
};
type State = Record<string, Entry>;
const ORIGIN = process.env.SITE_ORIGIN || 'https://arab-wrestling.com';
const WORKER = process.env.WORKER_API || 'https://arw-site-bot.m7mdibrahimpc.workers.dev';

export function isShowEligible(filename: string, data: Record<string, any>): boolean {
  const date = data.date ? new Date(data.date).getTime() : NaN;
  return Number.isFinite(date) && date >= Date.parse('2026-09-21T19:13:59Z') && date <= Date.now();
}
export function showUrl(filename: string, data: Record<string, any>, origin = ORIGIN): string {
  const link = typeof data.permalink === 'string' && !data.permalink.includes('{{')
    ? data.permalink.replace(/index\.html$/, '')
    : `/shows/${arabicSlug(data.title || filename.replace(/\.md$/, ''))}/`;
  const url = new URL(link, origin);
  if (url.origin !== new URL(origin).origin) throw new Error('Show permalink must belong to the site');
  return url.href;
}
export function findReelVideo(slug: string, files: string[]): string | null {
  // The generator uses exactly 45 characters. Never select an unrelated fuzzy match.
  return [`reel-${slug}.mp4`, `reel-${slug.slice(0, 45)}.mp4`].find(f => files.includes(f)) || null;
}
export function applyResults(existing: Entry | undefined, results: Record<string, any>, requested: readonly Platform[], title: string): Entry {
  const entry: Entry = { publishedAt: existing?.publishedAt || null,
    facebook_reel: false, facebook_story: false, instagram_reel: false, instagram_story: false,
    ...existing, title, lastAttempt: Date.now(), errors: { ...existing?.errors } };
  for (const platform of requested) {
    const result = results[platform];
    if (result?.ok === true) {
      entry[platform] = true;
      entry.publishedAt ||= Date.now();
      delete entry.errors![platform];
    } else {
      entry.errors![platform] = result?.error || 'لم تُرجع الخدمة تأكيدًا للنشر.';
    }
  }
  const review = new Set(existing?.reviewPlatforms || []);
  for (const p of requested) {
    if (results[p]?.ok) review.delete(p);
    else if (results[p]?.ambiguous || results[p]?.status === 'uncertain') review.add(p);
  }
  entry.reviewPlatforms = [...review];
  entry.needsReview = review.size > 0;
  return entry;
}
export async function main() {
  const root = process.cwd();
  const stateFile = path.join(root, '_data/show-reel-state.json');
  const dir = path.join(root, 'content/shows');
  const videoDir = path.join(root, 'dist/videos');
  const dryRun = process.argv.includes('--dry-run');
  // Invalid state must fail closed; resetting it to {} could repost every show.
  const state: State = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const save = () => {
    if (dryRun) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(stateFile + '.tmp', stateFile);
  };
  const videos = fs.existsSync(videoDir) ? fs.readdirSync(videoDir) : [];
  let failures = 0;
  for (const filename of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const { data } = matter(fs.readFileSync(path.join(dir, filename), 'utf8'));
    if (!isShowEligible(filename, data)) continue;
    const slug = filename.replace(/\.md$/, '');
    const previous = state[slug];
    if (previous?.needsReview) { console.error(`${slug}: uncertain platforms need review.`); failures++; }
    const review = previous?.reviewPlatforms || (previous?.needsReview ? [...PLATFORMS] : []);
    const pending = PLATFORMS.filter(p => !previous?.[p] && !review.includes(p));
    if (!pending.length) continue;
    if (previous?.lastAttempt && Date.now() - previous.lastAttempt < 45 * 60_000) continue;
    const file = findReelVideo(slug, videos);
    if (!file) { console.log(`${slug}: waiting for rendered video.`); continue; }
    const title = data.headline || data.title || slug;
    const postUrl = showUrl(filename, data);
    const videoUrl = `https://raw.githubusercontent.com/m7mdibrahimo/arw-site/main/dist/videos/${encodeURIComponent(file)}`;
    if (dryRun) { console.log(JSON.stringify({ slug, pending, postUrl, videoUrl })); continue; }
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required for authenticated publishing.');
    let results: Record<string, any> = {};
    // Check the canonical article, not just HTTP 200 (the host has a home-page fallback).
    try {
      const page = await fetch(postUrl, { signal: AbortSignal.timeout(20_000) });
      const html = await page.text();
      const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
      if (!page.ok || !canonical || new URL(canonical, ORIGIN).pathname.replace(/\/$/, '') !== new URL(postUrl).pathname.replace(/\/$/, '')) {
        throw new Error('صفحة العرض لم تصبح متاحة بالرابط الصحيح بعد.');
      }
      // One request per platform: persist each acknowledgement before attempting the next.
      for (const platform of pending) {
        try {
          const response = await fetch(`${WORKER}/api/videos/publish-social`, {
            method: 'POST', signal: AbortSignal.timeout(150_000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
            body: JSON.stringify({ videoUrl, title, postUrl, platforms: [platform] }),
          });
          const body: any = await response.json();
          results[platform] = body.results?.[platform] || { ok: false, error: body.error || `HTTP ${response.status}` };
        } catch {
          results[platform] = { ok: false, ambiguous: true, status: 'uncertain', error: 'انقطع الاتصال؛ راجع المنصة قبل إعادة المحاولة.' };
        }
        state[slug] = applyResults(state[slug], results, [platform], title);
        save();
      }
    } catch (error: any) {
      results = Object.fromEntries(pending.map(p => [p, { ok: false, error: error.message }]));
      state[slug] = applyResults(state[slug], results, pending, title);
      save();
    }
    if (pending.some(p => results[p]?.ok !== true)) failures++;
    console.log(JSON.stringify({ slug, results }));
  }
  if (failures) throw new Error(`${failures} show(s) have incomplete publishing; state and errors were saved.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
