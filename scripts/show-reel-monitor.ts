/**
 * show-reel-monitor.ts
 * ════════════════════
 * نظام تتبع ونشر ريلز العروض — مستقل تماماً عن باقي أنظمة الموقع.
 *
 * المهام:
 *  1. يقرأ content/shows/ ويقارن بـ _data/show-reel-state.json
 *  2. لو عرض جديد وعنده فيديو في dist/videos/ → ينشره على:
 *       - Facebook Reel
 *       - Facebook Story
 *       - Instagram Reel
 *       - Instagram Story
 *  3. يحدّث show-reel-state.json بعد كل نشر ناجح
 *
 * لا يمس: fightful-watcher.ts | server.ts | auto-publish-reel.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SHOWS_DIR = path.join(ROOT_DIR, 'content', 'shows');
const VIDEOS_DIR = path.join(ROOT_DIR, 'dist', 'videos');
const STATE_FILE = path.join(ROOT_DIR, '_data', 'show-reel-state.json');

const WORKER_URL = process.env.WORKER_API || 'https://arw-site-bot.m7mdibrahimpc.workers.dev';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://arab-wrestling.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com/m7mdibrahimo/arw-site/main/dist/videos';

// Only process shows starting from UFC 331 (2026-09-21) and future shows
const SHOW_REEL_MIN_DATE = new Date('2026-09-21T00:00:00.000Z').getTime();
const SHOW_REEL_MIN_SLUG_PREFIX = '20260921002200';

function isShowEligible(fname: string, fm: Record<string, string>): boolean {
  const slug = fname.replace(/\.md$/, '');
  if (slug.includes('ufc-331-van-vs-pantoja-2')) return true;

  const match = fname.match(/^(\d{14})-/);
  if (match) {
    return match[1] >= SHOW_REEL_MIN_SLUG_PREFIX;
  }

  if (fm.date) {
    const t = new Date(fm.date).getTime();
    if (!isNaN(t)) {
      return t >= SHOW_REEL_MIN_DATE;
    }
  }

  return false;
}

// ── State helpers ──────────────────────────────────────────────────────────

interface ShowReelEntry {
  publishedAt: number | null;
  lastAttempt?: number;
  facebook_reel: boolean;
  facebook_story: boolean;
  instagram_reel: boolean;
  instagram_story: boolean;
  title?: string;
  note?: string;
}
type ReelState = Record<string, ShowReelEntry>;

function loadState(): ReelState {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as ReelState;
  } catch {
    return {};
  }
}

function saveState(state: ReelState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Frontmatter parser ────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const data: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
  }
  return data;
}

// ── Find video for a show ─────────────────────────────────────────────────

function findReelVideo(slug: string): string | null {
  // Try exact match first
  const exact = path.join(VIDEOS_DIR, `reel-${slug}.mp4`);
  if (fs.existsSync(exact)) return `reel-${slug}.mp4`;

  // Try partial slug match (truncated filenames)
  if (!fs.existsSync(VIDEOS_DIR)) return null;
  const files = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('.mp4'));
  const cleanSlug = slug.slice(0, 50);
  const found = files.find(f => f.includes(cleanSlug) || cleanSlug.includes(f.replace(/^reel-/, '').replace(/\.mp4$/, '')));
  return found || null;
}

// ── Publish to social via worker ──────────────────────────────────────────

async function publishToSocial(params: {
  videoUrl: string;
  title: string;
  postUrl?: string;
  imageUrl?: string;
  platforms?: ('facebook_reel' | 'facebook_story' | 'instagram_reel' | 'instagram_story')[];
}): Promise<{ facebook_reel: boolean; facebook_story: boolean; instagram_reel: boolean; instagram_story: boolean; errors: string[] }> {
  const result = { facebook_reel: false, facebook_story: false, instagram_reel: false, instagram_story: false, errors: [] as string[] };
  const targetPlatforms = params.platforms && params.platforms.length
    ? params.platforms
    : ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'];

  try {
    const res = await fetch(`${WORKER_URL}/api/videos/publish-social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: params.videoUrl,
        title: params.title,
        postUrl: params.postUrl,
        imageUrl: params.imageUrl,
        platforms: targetPlatforms,
      }),
    });

    const data: any = await res.json().catch(() => ({}));
    console.log(`  📡 [Publish] Response:`, JSON.stringify(data?.results || data, null, 2));

    const r = data?.results || {};
    result.facebook_reel   = !!r?.facebook_reel?.ok;
    result.facebook_story  = !!r?.facebook_story?.ok;
    result.instagram_reel  = !!r?.instagram_reel?.ok;
    result.instagram_story = !!r?.instagram_story?.ok;

    // Collect any errors
    for (const [platform, val] of Object.entries(r) as any) {
      if (!val?.ok && val?.error) {
        result.errors.push(`${platform}: ${val.error}`);
      }
    }
  } catch (e: any) {
    console.error('  ❌ [Publish] Network error:', e.message);
    result.errors.push(`network: ${e.message}`);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎬 [Show Reel Monitor] Starting...');

  if (!fs.existsSync(SHOWS_DIR)) {
    console.log('ℹ️ No content/shows/ directory found. Nothing to do.');
    return;
  }

  const state = loadState();
  const showFiles = fs.readdirSync(SHOWS_DIR).filter(f => f.endsWith('.md')).sort();
  console.log(`📂 Found ${showFiles.length} shows in content/shows/`);

  let processed = 0;
  let skipped = 0;
  let noVideo = 0;

  for (const fname of showFiles) {
    const slug = fname.replace('.md', '');
    const existing = state[slug];

    // Parse show frontmatter for title, image and date
    const mdPath = path.join(SHOWS_DIR, fname);
    const content = fs.readFileSync(mdPath, 'utf-8');
    const fm = parseFrontmatter(content);

    // 1. Strict filter: only UFC 331 and new shows onwards!
    if (!isShowEligible(fname, fm)) {
      skipped++;
      continue;
    }

    // 2. Determine remaining platforms: only those that have NOT succeeded yet!
    const targetPlatforms: ('facebook_reel' | 'facebook_story' | 'instagram_reel' | 'instagram_story')[] = [];
    if (!existing?.facebook_reel) targetPlatforms.push('facebook_reel');
    if (!existing?.facebook_story) targetPlatforms.push('facebook_story');
    if (!existing?.instagram_reel) targetPlatforms.push('instagram_reel');
    if (!existing?.instagram_story) targetPlatforms.push('instagram_story');

    // If all target platforms are already done, skip!
    if (targetPlatforms.length === 0) {
      skipped++;
      continue;
    }

    // Cooldown check: if last attempt was less than 15 minutes ago, skip to give APIs time to recover
    if (existing?.lastAttempt && (Date.now() - existing.lastAttempt < 15 * 60 * 1000)) {
      console.log(`  ⏳ [${slug}] Attempted recently (${Math.round((Date.now() - existing.lastAttempt) / 60000)}m ago) — waiting for Meta cooldown.`);
      skipped++;
      continue;
    }

    const title = fm.headline || fm.title || slug;
    const imageUrl = fm.image ? `${SITE_ORIGIN}${fm.image.startsWith('/') ? '' : '/'}${fm.image}` : undefined;
    const postUrl = `${SITE_ORIGIN}/shows/${slug}`;

    // Find reel video
    const videoFileName = findReelVideo(slug);
    if (!videoFileName) {
      console.log(`  ⏭️ [${slug}] No reel video found yet — waiting for render.`);
      // Mark in state as pending (no video yet)
      if (!existing) {
        state[slug] = { publishedAt: null, facebook_reel: false, facebook_story: false, instagram_reel: false, instagram_story: false, title };
      }
      noVideo++;
      continue;
    }

    // Build video URL — use GitHub Raw CDN (most reliable for external APIs)
    const videoUrl = `${GITHUB_RAW}/${encodeURIComponent(videoFileName)}`;

    console.log(`\n▶️  [${slug}]`);
    console.log(`   Title: ${title}`);
    console.log(`   Video: ${videoFileName}`);
    console.log(`   Publishing to: ${targetPlatforms.join(' | ')}`);

    const publishResult = await publishToSocial({ videoUrl, title, postUrl, imageUrl, platforms: targetPlatforms });
    const anySuccess = publishResult.facebook_reel || publishResult.facebook_story || publishResult.instagram_reel || publishResult.instagram_story;

    // Update state
    state[slug] = {
      publishedAt: anySuccess ? (existing?.publishedAt || Date.now()) : (existing?.publishedAt || null),
      lastAttempt: Date.now(),
      facebook_reel:   publishResult.facebook_reel   || !!existing?.facebook_reel,
      facebook_story:  publishResult.facebook_story  || !!existing?.facebook_story,
      instagram_reel:  publishResult.instagram_reel  || !!existing?.instagram_reel,
      instagram_story: publishResult.instagram_story || !!existing?.instagram_story,
      title,
    };

    if (anySuccess) {
      console.log(`  ✅ Published: FB_Reel=${publishResult.facebook_reel} | FB_Story=${publishResult.facebook_story} | IG_Reel=${publishResult.instagram_reel} | IG_Story=${publishResult.instagram_story}`);
    } else {
      console.log(`  ❌ All platforms failed. Errors: ${publishResult.errors.join('; ')}`);
    }

    // Save after each show to avoid losing progress on crash
    saveState(state);
    processed++;

    // Brief pause between shows to respect API rate limits
    if (processed < showFiles.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Final save
  saveState(state);

  console.log(`\n✅ [Show Reel Monitor] Done.`);
  console.log(`   Processed: ${processed} | Skipped (already done): ${skipped} | No video yet: ${noVideo}`);
}

main().catch(e => {
  console.error('❌ Fatal error in show-reel-monitor:', e);
  process.exit(1);
});
