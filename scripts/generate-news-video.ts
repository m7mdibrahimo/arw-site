import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const NEWS_DIR = path.join(ROOT_DIR, 'content/news');
const REEL_DIR = path.join(ROOT_DIR, 'videos/news-reel');
const OUT_DIR = path.join(ROOT_DIR, 'dist/videos');

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

const CONTENT_DIRS = [
  path.join(ROOT_DIR, 'content/news'),
  path.join(ROOT_DIR, 'content/shows'),
  path.join(ROOT_DIR, 'content/recaps'),
  path.join(ROOT_DIR, 'content/nostalgia'),
  path.join(ROOT_DIR, 'content/nostalgia-series'),
];

function getTargetContentFile(input?: string): string {
  if (input && fs.existsSync(input)) {
    return path.resolve(input);
  }
  if (input) {
    const rawInput = input.trim();
    // Strip domain and route prefixes
    const clean = rawInput
      .replace(/^(?:https?:\/\/[^\/]+)?\/?(?:news|shows|recaps|nostalgia)\//, '')
      .replace(/\.html$/, '')
      .replace(/^\/+/, '');

    // Check each content directory
    for (const d of CONTENT_DIRS) {
      if (!fs.existsSync(d)) continue;
      const c1 = path.join(d, rawInput);
      if (fs.existsSync(c1)) return c1;
      const c2 = path.join(d, `${rawInput}.md`);
      if (fs.existsSync(c2)) return c2;
      const c3 = path.join(d, `${clean}.md`);
      if (fs.existsSync(c3)) return c3;

      const files = fs.readdirSync(d).filter(f => f.endsWith('.md'));
      for (const f of files) {
        const fNoExt = f.replace(/\.md$/, '');
        if (fNoExt === clean || fNoExt.includes(clean) || clean.includes(fNoExt)) {
          return path.join(d, f);
        }
      }
    }
  }

  // Fallback: newest file in content/news
  const files = fs.readdirSync(NEWS_DIR).filter(f => f.endsWith('.md'));
  if (!files.length) throw new Error('No content files found in content/news');
  files.sort((a, b) => fs.statSync(path.join(NEWS_DIR, b)).mtimeMs - fs.statSync(path.join(NEWS_DIR, a)).mtimeMs);
  return path.join(NEWS_DIR, files[0]);
}

export async function generateNewsVideo(inputTarget?: string) {
  const targetFile = getTargetContentFile(inputTarget);
  const isShow = targetFile.includes('/shows/') || targetFile.includes('\\shows\\');
  console.log(`🎬 Processing ${isShow ? 'Full Show' : 'News'} Post: ${path.basename(targetFile)}`);

  const raw = fs.readFileSync(targetFile, 'utf-8');
  const meta = parseFrontmatter(raw);

  const title = meta.headline || meta.title || (isShow ? 'عرض مصارعة مترجم' : 'خبر عاجل من عرب راسلنج');
  const fed = meta.federation || 'عرب راسلنج';
  const desc = meta.description || (isShow ? 'مشاهدة وتحميل العرض كاملاً ومترجماً بجودة عالية حصرياً.' : 'تغطية حصرية لكافة النزالات والأحداث المثيرة في أحدث عروض المصارعة.');
  const badgeText = isShow ? 'عرض كامل | مترجم' : 'عاجل | عرب راسلنج';
  const ctaText = isShow ? 'شاهد العرض كاملاً عبر موقعنا:' : 'التفاصيل الكاملة عبر موقعنا:';
  let imageRel = meta.image || '';
  if (imageRel.startsWith('/')) imageRel = imageRel.slice(1);

  const imageSrc = path.join(ROOT_DIR, imageRel);
  const targetImage = path.join(REEL_DIR, 'assets/news-cover.jpg');

  fs.mkdirSync(path.join(REEL_DIR, 'assets'), { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (fs.existsSync(imageSrc)) {
    fs.copyFileSync(imageSrc, targetImage);
  } else {
    console.warn(`⚠️ Warning: Image not found at ${imageSrc}, using fallback`);
  }

  // Generate index.html for reel (Note: avoid dir="rtl" on <html> for HyperFrames headless capture)
  const htmlTemplate = `<!doctype html>
<html lang="ar">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@500;700;900&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #090b10;
        font-family: 'Cairo', Arial, sans-serif;
        color: #ffffff;
      }

      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        direction: rtl;
        text-align: right;
        background: radial-gradient(circle at 50% 12%, rgba(220, 38, 38, 0.35) 0%, transparent 55%),
                    radial-gradient(circle at 50% 88%, rgba(245, 158, 11, 0.2) 0%, transparent 55%),
                    #090c10;
      }

      .top-header {
        position: absolute;
        top: 80px;
        left: 60px;
        right: 60px;
        height: 90px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 20;
      }

      .badge-breaking {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        background: rgba(220, 38, 38, 0.25);
        border: 2px solid #ef4444;
        color: #fee2e2;
        padding: 14px 28px;
        border-radius: 9999px;
        font-size: 30px;
        font-weight: 800;
        box-shadow: 0 0 30px rgba(239, 68, 68, 0.4);
      }

      .pulse-dot {
        width: 18px;
        height: 18px;
        background: #ef4444;
        border-radius: 50%;
        box-shadow: 0 0 15px #ef4444;
      }

      .brand-title {
        font-size: 36px;
        font-weight: 900;
        background: linear-gradient(135deg, #f59e0b, #ef4444);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.5px;
        filter: drop-shadow(0 2px 8px rgba(245, 158, 11, 0.3));
      }

      .media-container {
        position: absolute;
        top: 200px;
        left: 60px;
        right: 60px;
        height: 960px;
        border-radius: 36px;
        overflow: hidden;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.9), 0 0 0 2px rgba(255, 255, 255, 0.16);
        background: #151820;
        z-index: 10;
      }

      .media-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform-origin: center center;
      }

      .media-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(9, 12, 16, 0) 45%, rgba(9, 12, 16, 0.95) 100%);
      }

      .fed-tag {
        position: absolute;
        top: 30px;
        right: 30px;
        background: rgba(15, 23, 42, 0.9);
        backdrop-filter: blur(14px);
        border: 2px solid #f59e0b;
        color: #fef3c7;
        font-size: 26px;
        font-weight: 800;
        padding: 10px 24px;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 15px rgba(245, 158, 11, 0.25);
      }

      .content-box {
        position: absolute;
        top: 1200px;
        left: 60px;
        right: 60px;
        height: 480px;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        gap: 20px;
        z-index: 20;
      }

      .headline {
        font-size: 50px;
        font-weight: 900;
        line-height: 1.32;
        color: #ffffff;
        text-shadow: 0 4px 24px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8);
      }

      .subtext {
        font-size: 32px;
        font-weight: 600;
        color: #cbd5e1;
        line-height: 1.5;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
      }

      .bottom-cta {
        position: absolute;
        bottom: 70px;
        left: 60px;
        right: 60px;
        height: 110px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(15, 23, 42, 0.8);
        backdrop-filter: blur(18px);
        border: 2px solid rgba(56, 189, 248, 0.3);
        padding: 0 40px;
        border-radius: 28px;
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.65), 0 0 20px rgba(56, 189, 248, 0.15);
        z-index: 20;
      }

      .cta-text {
        font-size: 28px;
        font-weight: 700;
        color: #e2e8f0;
      }

      .cta-url {
        font-size: 34px;
        font-weight: 900;
        color: #38bdf8;
        letter-spacing: 0.5px;
        text-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="8"
      data-fps="30"
      data-width="1080"
      data-height="1920"
    >
      <div class="top-header" id="header">
        <div class="badge-breaking" id="badge">
          <div class="pulse-dot"></div>
          <span>${escapeHtml(badgeText)}</span>
        </div>
        <div class="brand-title" id="brand">
          <span>عرب راسلنج</span>
        </div>
      </div>

      <div class="media-container" id="mediaCard">
        <img class="media-img" id="heroImg" src="assets/news-cover.jpg" alt="${escapeHtml(title)}" />
        <div class="media-overlay"></div>
        <div class="fed-tag" id="fedTag">${escapeHtml(fed)}</div>
      </div>

      <div class="content-box" id="contentBox">
        <h1 class="headline" id="headlineText">${escapeHtml(title)}</h1>
        <p class="subtext" id="subtext">${escapeHtml(desc)}</p>
      </div>

      <div class="bottom-cta" id="bottomBar">
        <div class="cta-text">${escapeHtml(ctaText)}</div>
        <div class="cta-url">arab-wrestling.com</div>
      </div>
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });

      tl.fromTo("#badge", { opacity: 0, y: -40, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.7)" }, 0.2);
      tl.fromTo("#brand", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power2.out" }, 0.4);

      tl.fromTo("#mediaCard", { opacity: 0, scale: 0.92, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.9, ease: "power3.out" }, 0.3);
      tl.fromTo("#heroImg", { scale: 1.0 }, { scale: 1.12, duration: 7.5, ease: "sine.inOut" }, 0.3);
      tl.fromTo("#fedTag", { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, ease: "back.out(2)" }, 0.7);

      tl.fromTo("#headlineText", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.8);
      tl.fromTo("#subtext", { opacity: 0, y: 25 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 1.2);

      tl.fromTo("#bottomBar", { opacity: 0, y: 30, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.5)" }, 1.5);

      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>`;

  fs.writeFileSync(path.join(REEL_DIR, 'index.html'), htmlTemplate, 'utf-8');

  const baseSlug = path.basename(targetFile, '.md').slice(0, 45);
  const outPath = path.join(OUT_DIR, `reel-${baseSlug}.mp4`);

  console.log('🚀 Rendering video with HyperFrames engine...');
  const tempOut = path.join(OUT_DIR, `temp-${baseSlug}.mp4`);
  execSync(`npx hyperframes render -o "${tempOut}"`, {
    cwd: REEL_DIR,
    stdio: 'inherit',
  });

  console.log('🔊 Adding AAC audio track and faststart header for Meta Story & Reels compatibility...');
  try {
    execSync(`ffmpeg -y -i "${tempOut}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -crf 23 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outPath}"`, {
      stdio: 'pipe',
    });
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
  } catch (audioErr) {
    console.warn('⚠️ ffmpeg post-processing skipped or failed, fallback to raw render:', audioErr);
    if (fs.existsSync(tempOut)) fs.renameSync(tempOut, outPath);
  }

  console.log(`\n🎉 Success! Video generated at: ${outPath}`);
  const latestRender = {
    videoUrl: `/videos/reel-${baseSlug}.mp4`,
    filename: `reel-${baseSlug}.mp4`,
    title,
    description: desc,
    postUrl: isShow ? `/shows/${baseSlug}` : `/news/${baseSlug}`,
    kind: isShow ? 'show' : 'news',
    slug: baseSlug,
    image: meta.image || '',
    renderedAt: Date.now(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'latest-render.json'), JSON.stringify(latestRender, null, 2), 'utf-8');
  updateVideosManifest();

  return {
    success: true,
    videoUrl: `/videos/reel-${baseSlug}.mp4`,
    filename: `reel-${baseSlug}.mp4`,
    filePath: outPath,
    title,
  };
}

export function updateVideosManifest() {
  try {
    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
    }
    const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.mp4'));
    const manifest = files.map(f => {
      const stat = fs.statSync(path.join(OUT_DIR, f));
      return {
        filename: f,
        videoUrl: `/videos/${f}`,
        size: stat.size,
        mtime: stat.mtimeMs,
        cleanSlug: f.replace(/^reel-/, '').replace(/\.mp4$/, ''),
      };
    }).sort((a, b) => b.mtime - a.mtime);
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`📋 Updated videos manifest with ${manifest.length} videos.`);
    return manifest;
  } catch (err) {
    console.error('⚠️ Could not update videos manifest:', err);
    return [];
  }
}

if (require.main === module || process.argv[1]?.endsWith('generate-news-video.ts')) {
  generateNewsVideo(process.argv[2]).catch(err => {
    console.error('❌ Error generating video:', err);
    process.exit(1);
  });
}

