import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(__dirname, '..');
const LATEST_RENDER = path.join(ROOT_DIR, 'dist/videos/latest-render.json');
const WORKER_URL = process.env.WORKER_API || 'https://arw-site-bot.m7mdibrahimpc.workers.dev';

async function autoPublish() {
  if (!fs.existsSync(LATEST_RENDER)) {
    console.log('ℹ️ No latest-render.json found, skipping auto-publish.');
    return;
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(LATEST_RENDER, 'utf-8'));
  } catch (e) {
    console.error('⚠️ Could not parse latest-render.json:', e);
    return;
  }

  console.log(`🚀 [Auto-Publish] Processing: "${data.title}" (Kind: ${data.kind || 'unknown'})`);

  const rawVideoUrl = `https://raw.githubusercontent.com/m7mdibrahimo/arw-site/main${data.videoUrl}`;
  const postUrl = data.postUrl
    ? (data.postUrl.startsWith('http') ? data.postUrl : `https://arab-wrestling.com${data.postUrl.startsWith('/') ? '' : '/'}${data.postUrl}`)
    : undefined;

  let imageUrl: string | undefined = undefined;
  if (data.image) {
    imageUrl = data.image.startsWith('http')
      ? data.image
      : `https://arab-wrestling.com${data.image.startsWith('/') ? '' : '/'}${data.image}`;
  }

  // 1. Auto-Publish Video Reel & Story to Facebook and Instagram
  try {
    console.log('📹 [Auto-Publish] Publishing Reel & Story to Facebook & Instagram...');
    const reelRes = await fetch(`${WORKER_URL}/api/videos/publish-social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: rawVideoUrl,
        title: data.title,
        postUrl,
        imageUrl,
        platforms: ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'],
      }),
    });

    const reelData: any = await reelRes.json().catch(() => ({}));
    console.log('✅ Reel & Story Publish Response:', JSON.stringify(reelData, null, 2));
  } catch (reelErr) {
    console.error('⚠️ Failed to publish Reel & Story:', reelErr);
  }

  console.log('🎉 [Auto-Publish] Completed Reel and Story broadcasting successfully.');
}

autoPublish().catch((err) => {
  console.error('❌ Fatal error in auto-publish:', err);
  process.exit(1);
});
