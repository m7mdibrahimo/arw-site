import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(__dirname, '..');
const LATEST_RENDER = path.join(ROOT_DIR, 'dist/videos/latest-render.json');
const WORKER_URL = process.env.WORKER_API || 'https://arw-site-bot.m7mdibrahimpc.workers.dev';

async function autoPublish() {
  const queuePath = path.join(ROOT_DIR, 'dist/videos/rendered-queue.json');
  let itemsToPublish: any[] = [];
  if (fs.existsSync(queuePath)) {
    try {
      const q = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      if (Array.isArray(q) && q.length) itemsToPublish = q;
    } catch (e) {
      console.error('⚠️ Could not parse rendered-queue.json:', e);
    }
  }
  if (!itemsToPublish.length && fs.existsSync(LATEST_RENDER)) {
    try {
      itemsToPublish.push(JSON.parse(fs.readFileSync(LATEST_RENDER, 'utf-8')));
    } catch (e) {
      console.error('⚠️ Could not parse latest-render.json:', e);
    }
  }

  if (!itemsToPublish.length) {
    console.log('ℹ️ No items to auto-publish.');
    return;
  }

  console.log(`🚀 [Auto-Publish] Found ${itemsToPublish.length} reel(s) to publish.`);

  for (const data of itemsToPublish) {
    console.log(`\n🚀 [Auto-Publish] Processing: "${data.title}" (Kind: ${data.kind || 'unknown'})`);
    const videoFileName = data.filename || path.basename(data.videoUrl || '');
    const rawVideoUrl = `https://raw.githubusercontent.com/m7mdibrahimo/arw-site/main/dist/videos/${videoFileName}`;
    const postUrl = data.postUrl
      ? (data.postUrl.startsWith('http') ? data.postUrl : `https://arab-wrestling.com${data.postUrl.startsWith('/') ? '' : '/'}${data.postUrl}`)
      : undefined;

    let imageUrl: string | undefined = undefined;
    if (data.image) {
      imageUrl = data.image.startsWith('http')
        ? data.image
        : `https://arab-wrestling.com${data.image.startsWith('/') ? '' : '/'}${data.image}`;
    }

    try {
      console.log(`📹 [Auto-Publish] Publishing Reel & Story for "${data.title}"...`);
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
      console.error(`⚠️ Failed to publish Reel & Story for "${data.title}":`, reelErr);
    }
  }

  if (fs.existsSync(queuePath)) {
    try { fs.unlinkSync(queuePath); } catch {}
  }
  console.log('🎉 [Auto-Publish] Completed Reel and Story broadcasting successfully.');
}

autoPublish().catch((err) => {
  console.error('❌ Fatal error in auto-publish:', err);
  process.exit(1);
});
