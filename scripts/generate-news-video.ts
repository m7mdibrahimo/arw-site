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

function formatArabicDate(dateStr?: string): string {
  if (!dateStr) return 'اليوم';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const months = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return String(dateStr);
  }
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
    if (rawInput === 'show' || rawInput === 'shows' || rawInput === 'shows:latest') {
      const showDir = path.join(ROOT_DIR, 'content/shows');
      if (fs.existsSync(showDir)) {
        const sFiles = fs.readdirSync(showDir).filter(f => f.endsWith('.md'));
        if (sFiles.length) {
          sFiles.sort((a, b) => fs.statSync(path.join(showDir, b)).mtimeMs - fs.statSync(path.join(showDir, a)).mtimeMs);
          return path.join(showDir, sFiles[0]);
        }
      }
    }
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

  // Fallback: newest file across content/shows and content/news
  const candidates: { file: string; mtime: number }[] = [];
  for (const dir of [path.join(ROOT_DIR, 'content/shows'), NEWS_DIR]) {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const full = path.join(dir, f);
        candidates.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  }
  if (!candidates.length) throw new Error('No content files found in content/shows or content/news');
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].file;
}

export async function generateNewsVideo(inputTarget?: string) {
  const targetFile = getTargetContentFile(inputTarget);
  const isShow = targetFile.includes('/shows/') || targetFile.includes('\\shows\\');
  console.log(`🎬 Processing ${isShow ? 'Full Show' : 'News'} Post: ${path.basename(targetFile)}`);

  const raw = fs.readFileSync(targetFile, 'utf-8');
  const meta = parseFrontmatter(raw);

  const title = meta.headline || meta.title || (isShow ? 'عرض مصارعة مترجم' : 'خبر عاجل من عرب راسلنج');
  let secondaryTitle = '';
  if (meta.headline && meta.title && meta.headline !== meta.title) {
    secondaryTitle = String(meta.title).trim();
  } else if (meta.secondary_title) {
    secondaryTitle = String(meta.secondary_title).trim();
  } else if (meta.title_en) {
    secondaryTitle = String(meta.title_en).trim();
  } else if (meta.subtitle) {
    secondaryTitle = String(meta.subtitle).trim();
  } else if (isShow && meta.program_name && meta.program_name !== title) {
    secondaryTitle = String(meta.program_name).trim();
  }

  const fed = meta.federation || 'عرب راسلنج';
  const desc = meta.description || (isShow ? 'مشاهدة وتحميل العرض كاملاً ومترجماً بجودة عالية حصرياً.' : 'تغطية حصرية لكافة النزالات والأحداث المثيرة في أحدث عروض المصارعة.');
  const badgeText = isShow ? 'عرض كامل | مترجم' : 'عاجل | عرب راسلنج';
  const ctaText = isShow ? 'شاهد العرض كاملاً عبر موقعنا:' : 'التفاصيل الكاملة عبر موقعنا:';

  // Dynamic font sizing & positioning for titles and cards
  let titleFontSize = isShow ? 45 : 50;
  let titleLineHeight = isShow ? 1.16 : 1.22;
  let titleTop = isShow ? 830 : 775;
  let barHeight = isShow ? 38 : 44;
  if (!isShow) {
    if (title.length > 70) {
      titleFontSize = 42;
      titleLineHeight = 1.28;
      barHeight = 36;
    } else if (title.length > 45) {
      titleFontSize = 46;
      titleLineHeight = 1.26;
      barHeight = 40;
    } else {
      titleFontSize = 50;
      titleLineHeight = 1.22;
      barHeight = 44;
    }
  } else {
    // Shows: calibrated to 45px for comfortable, eye-friendly readability on a single line
    if (title.length > 55) {
      titleFontSize = 40;
      barHeight = 34;
    } else if (title.length > 40) {
      titleFontSize = 42;
      barHeight = 36;
    } else {
      titleFontSize = 45;
      barHeight = 38;
    }
  }

  const summaryTop = isShow ? 1180 : 1040;
  const summaryHeight = isShow ? 345 : 520;
  const summaryPadding = isShow ? '32px 36px' : '40px 42px';
  const summaryTagSize = isShow ? 28 : 36;
  const summaryTextSize = isShow ? 36 : 38;

  // Dynamic specs
  const specDuration = meta.duration || (isShow ? 'عرض كامل' : 'تغطية عاجلة');
  const specDurationLabel = isShow ? 'المدة الزمنية' : 'طبيعة التغطية';
  const specDate = formatArabicDate(meta.event_date || meta.date);
  const specDateLabel = isShow ? 'تاريخ الحدث' : 'تاريخ النشر';

  let specType = 'عرض أسبوعي';
  if (isShow) {
    const rawLower = raw.toLowerCase();
    const isMonthly =
      meta.is_annual === 'true' ||
      meta.is_annual === true ||
      meta.is_ppv === 'true' ||
      meta.is_ppv === true ||
      (meta.show_type && (meta.show_type.includes('شهري') || meta.show_type.toLowerCase().includes('ppv') || meta.show_type.toLowerCase().includes('ple'))) ||
      rawLower.includes('عروض شهرية') ||
      rawLower.includes('عرض شهري') ||
      rawLower.includes('مهرجان') ||
      rawLower.includes('ppv') ||
      rawLower.includes('ple') ||
      /\b(wrestlemania|summerslam|royal rumble|survivor series|backlash|money in the bank|elimination chamber|crown jewel|bad blood|fastlane|all in|all out|revolution|double or nothing|wrestledream|worlds end|forbidden door|bound for glory|slammiversary|rebellion|triplemania|hard to kill)\b/i.test(
        `${meta.title || ''} ${meta.headline || ''} ${meta.program_name || ''}`
      );

    specType = isMonthly ? 'عرض شهري' : 'عرض أسبوعي';
  } else {
    specType = meta.category || meta.federation || 'أخبار عامة';
  }
  const specTypeLabel = isShow ? 'نوع العرض' : 'التصنيف';

  // Feature ribbon chips (2 chips centered)
  const chipsHtml = isShow ? `
        <div class="ribbon-chip gold">⚡ جودة عالية</div>
        <div class="ribbon-chip cyan">🎙️ ترجمة حصرية</div>` : `
        <div class="ribbon-chip fire">🔥 خبر عاجل</div>
        <div class="ribbon-chip cyan">⚡ تحديث فوري</div>`;

  // Summary card text
  const summaryTag = isShow ? '✨ نبذة عن العرض' : '✨ تفاصيل الخبر';
  const summaryPill = isShow ? 'متاح الآن' : 'تحديث عاجل';
  const summaryFooter = isShow ? 'سيرفرات سريعة ومشاهدة مباشرة بدون إعلانات مزعجة' : 'تابع أحدث الكواليس والنتائج أولاً بأول على موقعنا';

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
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@500;700;800;900&display=swap" rel="stylesheet">
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
        background: #06080d;
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
        background: radial-gradient(circle at 50% 12%, rgba(220, 38, 38, 0.45) 0%, transparent 60%),
                    radial-gradient(circle at 50% 88%, rgba(245, 158, 11, 0.3) 0%, transparent 60%),
                    #07090f;
      }

      /* Animated Glowing Ambient Stage Backdrop */
      .ambient-stage {
        position: absolute;
        inset: -40px;
        width: calc(100% + 80px);
        height: calc(100% + 80px);
        background: url('assets/news-cover.jpg') center 22% / cover no-repeat;
        filter: blur(55px) brightness(0.25) saturate(1.6);
        opacity: 0.9;
        z-index: 1;
        pointer-events: none;
      }
      .ambient-light-top {
        position: absolute;
        top: -100px;
        left: 50%;
        transform: translateX(-50%);
        width: 800px;
        height: 400px;
        background: radial-gradient(ellipse, rgba(239, 68, 68, 0.3) 0%, transparent 70%);
        z-index: 2;
        pointer-events: none;
      }
      .ambient-light-bottom {
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 900px;
        height: 450px;
        background: radial-gradient(ellipse, rgba(245, 158, 11, 0.25) 0%, transparent 70%);
        z-index: 2;
        pointer-events: none;
      }

      /* Top Header */
      .top-header {
        position: absolute;
        top: 65px;
        left: 60px;
        right: 60px;
        height: 85px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 25;
      }
      .badge-breaking {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        background: linear-gradient(135deg, rgba(220, 38, 38, 0.4), rgba(185, 28, 28, 0.2));
        border: 2px solid #ef4444;
        color: #ffffff;
        padding: 14px 30px;
        border-radius: 9999px;
        font-size: 30px;
        font-weight: 900;
        box-shadow: 0 0 30px rgba(239, 68, 68, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        backdrop-filter: blur(16px);
      }
      .pulse-dot {
        width: 18px;
        height: 18px;
        background: #ef4444;
        border-radius: 50%;
        box-shadow: 0 0 15px #ef4444, 0 0 25px #ef4444;
        animation: pulseDot 1.6s infinite ease-in-out;
      }
      @keyframes pulseDot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.3); opacity: 0.7; }
      }
      .brand-title {
        font-size: 40px;
        font-weight: 900;
        background: linear-gradient(135deg, #fbbf24, #f59e0b, #ef4444);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.5px;
        filter: drop-shadow(0 2px 14px rgba(245, 158, 11, 0.5));
      }

      /* 16:9 Showcase Card - Epic Cinema Centerpiece */
      .media-showcase-container {
        position: absolute;
        top: 165px;
        left: 60px;
        right: 60px;
        height: 530px;
        z-index: 15;
        perspective: 1000px;
      }
      .media-showcase {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 30px;
        overflow: hidden;
        border: 2.5px solid rgba(245, 158, 11, 0.55);
        box-shadow: 0 35px 90px rgba(0, 0, 0, 0.95), 0 0 50px rgba(245, 158, 11, 0.25);
        background: #000;
        transform-origin: center center;
      }
      .media-showcase img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .card-gloss {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, transparent 45%);
      }
      /* Animated Luxury Light Sheen Sweep */
      .card-sheen {
        position: absolute;
        top: -50%;
        bottom: -50%;
        width: 130px;
        left: -160px;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.38), transparent);
        transform: rotate(25deg);
        pointer-events: none;
        z-index: 5;
      }
      .fed-tag-floating {
        position: absolute;
        top: 24px;
        right: 24px;
        background: rgba(10, 15, 30, 0.92);
        backdrop-filter: blur(16px);
        border: 2px solid #f59e0b;
        color: #fef3c7;
        font-size: 27px;
        font-weight: 900;
        padding: 10px 26px;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.75), 0 0 20px rgba(245, 158, 11, 0.4);
        z-index: 20;
      }

      /* Feature Ribbon Directly Below Poster */
      .feature-ribbon {
        position: absolute;
        top: 720px;
        left: 60px;
        right: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 24px;
        z-index: 20;
      }
      .ribbon-chip {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        background: rgba(10, 15, 30, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.22);
        padding: 13px 34px;
        border-radius: 999px;
        font-size: 28px;
        font-weight: 900;
        color: #ffffff;
        backdrop-filter: blur(16px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }
      .ribbon-chip.fire {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.35), rgba(185, 28, 28, 0.15));
        border-color: #ef4444;
        color: #fee2e2;
        box-shadow: 0 4px 18px rgba(239, 68, 68, 0.35);
      }
      .ribbon-chip.gold {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(180, 83, 9, 0.15));
        border-color: #f59e0b;
        color: #fef08a;
        box-shadow: 0 4px 18px rgba(245, 158, 11, 0.35);
      }
      .ribbon-chip.cyan {
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.35), rgba(3, 105, 161, 0.15));
        border-color: #38bdf8;
        color: #e0f2fe;
        box-shadow: 0 4px 18px rgba(56, 189, 248, 0.35);
      }

      /* Titles Area (Dynamic spacing and sizing) */
      .titles-section {
        position: absolute;
        top: ${titleTop}px;
        left: 60px;
        right: 60px;
        width: 960px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        z-index: 20;
      }
      .headline {
        display: inline-flex;
        align-items: center;
        gap: 16px;
        font-size: ${titleFontSize}px;
        font-weight: 900;
        line-height: ${titleLineHeight};
        color: #ffffff;
        text-shadow: 0 4px 25px rgba(0, 0, 0, 1), 0 2px 8px #000000;
        white-space: nowrap;
        width: max-content;
        max-width: 960px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .headline-bar {
        display: inline-block;
        width: 8px;
        min-width: 8px;
        height: ${barHeight}px;
        background: linear-gradient(180deg, #ef4444, #f59e0b);
        border-radius: 4px;
        box-shadow: 0 0 16px #ef4444, 0 0 24px #f59e0b;
        flex-shrink: 0;
      }
      .headline-text {
        white-space: nowrap;
        display: inline-block;
      }
      .secondary-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 30px;
        font-weight: 900;
        line-height: 1.15;
        color: #fbbf24;
        letter-spacing: 0.5px;
        direction: ltr;
        text-align: left;
        width: 100%;
        justify-content: flex-start;
        text-shadow: 0 2px 16px rgba(0, 0, 0, 1);
        white-space: nowrap;
        max-width: 960px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .secondary-title::before {
        content: '';
        display: inline-block;
        width: 6px;
        min-width: 6px;
        height: 24px;
        background: #fbbf24;
        border-radius: 3px;
        box-shadow: 0 0 16px #fbbf24;
        flex-shrink: 0;
      }

      /* Show Specs / Stats Grid (Enlarged & Prominent) */
      .specs-grid {
        position: absolute;
        top: 985px;
        left: 60px;
        right: 60px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
        z-index: 20;
      }
      .spec-card {
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(10, 15, 30, 0.96) 100%);
        border: 2px solid rgba(255, 255, 255, 0.22);
        border-radius: 26px;
        padding: 18px 14px;
        text-align: center;
        backdrop-filter: blur(18px);
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        height: 170px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .spec-icon {
        font-size: 42px;
        line-height: 1;
        margin-bottom: 4px;
        display: block;
      }
      .spec-label {
        font-size: 25px;
        line-height: 1.25;
        font-weight: 800;
        color: #cbd5e1;
        display: block;
      }
      .spec-val {
        font-size: 32px;
        line-height: 1.25;
        font-weight: 900;
        color: #ffffff;
        display: block;
        margin-top: 4px;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
      }

      /* Summary / Description Glass Card (Enlarged & Dominant) */
      .summary-card {
        position: absolute;
        top: ${summaryTop}px;
        left: 60px;
        right: 60px;
        height: ${summaryHeight}px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(10, 15, 30, 0.97) 100%);
        border: 2.5px solid rgba(245, 158, 11, 0.5);
        border-radius: 28px;
        padding: ${summaryPadding};
        backdrop-filter: blur(20px);
        box-shadow: 0 25px 65px rgba(0, 0, 0, 0.8), 0 0 35px rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        z-index: 20;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .summary-header {
        display: flex;
        align-items: center;
        justify-content: ${isShow ? 'space-between' : 'flex-start'};
        ${isShow ? '' : 'border-bottom: 2px solid rgba(255, 255, 255, 0.12); padding-bottom: 20px;'}
      }
      .summary-tag {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-size: ${summaryTagSize}px;
        font-weight: 900;
        color: #f59e0b;
        text-shadow: 0 0 15px rgba(245, 158, 11, 0.5);
      }
      .summary-pill-live {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.15));
        border: 1.5px solid #10b981;
        color: #a7f3d0;
        font-size: 24px;
        font-weight: 900;
        padding: 6px 22px;
        border-radius: 999px;
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
      }
      .summary-text {
        font-family: 'Tajawal', sans-serif;
        font-size: ${summaryTextSize}px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.6;
        ${isShow ? '' : 'margin: auto 0;'}
        text-shadow: 0 2px 14px rgba(0, 0, 0, 1);
      }
      .summary-footer {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 26px;
        font-weight: 800;
        color: #e2e8f0;
        ${isShow ? '' : 'border-top: 2px solid rgba(255, 255, 255, 0.12); padding-top: 20px;'}
      }
      .summary-dot {
        width: 10px;
        height: 10px;
        background: #f59e0b;
        border-radius: 50%;
        box-shadow: 0 0 12px #f59e0b, 0 0 20px #f59e0b;
      }

      /* Call To Action Bar - Enlarged & Glowing */
      .bottom-cta {
        position: absolute;
        top: 1555px;
        left: 60px;
        right: 60px;
        height: 125px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: linear-gradient(180deg, rgba(10, 15, 30, 0.96) 0%, rgba(5, 8, 16, 0.98) 100%);
        backdrop-filter: blur(20px);
        border: 2.5px solid rgba(56, 189, 248, 0.7);
        padding: 0 46px;
        border-radius: 30px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 45px rgba(56, 189, 248, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        z-index: 20;
      }
      .cta-text {
        font-size: 32px;
        font-weight: 900;
        color: #ffffff;
      }
      .cta-url {
        font-size: 40px;
        font-weight: 900;
        color: #38bdf8;
        letter-spacing: 0.5px;
        text-shadow: 0 0 25px rgba(56, 189, 248, 0.8);
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="8"
      data-fps="120"
      data-width="1080"
      data-height="1920"
    >
      <div class="ambient-stage" id="ambientBg"></div>
      <div class="ambient-light-top"></div>
      <div class="ambient-light-bottom"></div>

      <div class="top-header" id="header">
        <div class="badge-breaking" id="badge">
          <div class="pulse-dot"></div>
          <span>${escapeHtml(badgeText)}</span>
        </div>
        <div class="brand-title" id="brand">
          <span>عرب راسلنج</span>
        </div>
      </div>

      <div class="media-showcase-container" id="mediaContainer">
        <div class="media-showcase" id="mediaCard">
          <img id="heroImg" src="assets/news-cover.jpg" alt="${escapeHtml(title)}" />
          <div class="card-gloss"></div>
          <div class="card-sheen" id="cardSheen"></div>
          <div class="fed-tag-floating" id="fedTag">${escapeHtml(fed)}</div>
        </div>
      </div>

      ${isShow ? `<div class="feature-ribbon" id="featureRibbon">${chipsHtml}</div>` : ''}

      <div class="titles-section" id="titlesSection">
        <h1 class="headline" id="headlineText">
          <span class="headline-bar"></span>
          <span class="headline-text" id="headlineTextInner">${escapeHtml(title)}</span>
        </h1>
        ${secondaryTitle ? `<div class="secondary-title" id="secondaryTitle">${escapeHtml(secondaryTitle)}</div>` : ''}
      </div>

      ${isShow ? `<div class="specs-grid" id="specsGrid">
        <div class="spec-card">
          <span class="spec-icon">⏱️</span>
          <span class="spec-label">${escapeHtml(specDurationLabel)}</span>
          <span class="spec-val">${escapeHtml(specDuration)}</span>
        </div>
        <div class="spec-card">
          <span class="spec-icon">📅</span>
          <span class="spec-label">${escapeHtml(specDateLabel)}</span>
          <span class="spec-val">${escapeHtml(specDate)}</span>
        </div>
        <div class="spec-card">
          <span class="spec-icon">🏆</span>
          <span class="spec-label">${escapeHtml(specTypeLabel)}</span>
          <span class="spec-val">${escapeHtml(specType)}</span>
        </div>
      </div>` : ''}

      <div class="summary-card" id="summaryCard">
        <div class="summary-header">
          <div class="summary-tag">${escapeHtml(summaryTag)}</div>
          ${isShow ? `<div class="summary-pill-live">${escapeHtml(summaryPill)}</div>` : ''}
        </div>
        <p class="summary-text" id="summaryText">${escapeHtml(desc)}</p>
        <div class="summary-footer">
          <div class="summary-dot"></div>
          <span id="summaryFooterText">${escapeHtml(summaryFooter)}</span>
        </div>
      </div>

      <div class="bottom-cta" id="bottomBar">
        <div class="cta-text" id="ctaText">${escapeHtml(ctaText)}</div>
        <div class="cta-url">arab-wrestling.com</div>
      </div>
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });

      // Continuous cinematic ambient breathing across all 8 seconds
      tl.fromTo("#ambientBg", { scale: 1.0 }, { scale: 1.10, duration: 8, ease: "sine.inOut" }, 0);
      tl.fromTo("#heroImg", { scale: 1.0 }, { scale: 1.06, duration: 8, ease: "none" }, 0);

      // Top bar - liquid smooth glide
      tl.fromTo("#badge", { opacity: 0, y: -24, force3D: true }, { opacity: 1, y: 0, duration: 1.0, ease: "expo.out" }, 0.1);
      tl.fromTo("#brand", { opacity: 0, x: -24, force3D: true }, { opacity: 1, x: 0, duration: 1.0, ease: "expo.out" }, 0.2);

      // Media poster card - luxurious rise & settle
      tl.fromTo("#mediaCard", { opacity: 0, scale: 0.94, y: 30, force3D: true }, { opacity: 1, scale: 1, y: 0, duration: 1.2, ease: "expo.out" }, 0.25);
      tl.fromTo("#fedTag", { opacity: 0, scale: 0.8, y: -10, force3D: true }, { opacity: 1, scale: 1, y: 0, duration: 0.9, ease: "expo.out" }, 0.6);

      // Television Light Sheen Sweep across the poster (1.6s to 3.0s)
      tl.fromTo("#cardSheen", { left: "-160px", opacity: 0 }, { left: "1150px", opacity: 0.8, duration: 1.4, ease: "power2.inOut" }, 1.5);

      ${isShow ? `// Ribbon chips - fluid staggered wave
      tl.fromTo(".ribbon-chip", { opacity: 0, y: 20, scale: 0.94, force3D: true }, { opacity: 1, y: 0, scale: 1, duration: 0.9, stagger: 0.12, ease: "expo.out" }, 0.6);` : ''}

      // Titles - smooth upward glide
      tl.fromTo("#headlineText", { opacity: 0, y: 24, force3D: true }, { opacity: 1, y: 0, duration: 1.1, ease: "expo.out" }, 0.8);
      ${secondaryTitle ? `tl.fromTo("#secondaryTitle", { opacity: 0, y: 16, force3D: true }, { opacity: 1, y: 0, duration: 1.0, ease: "expo.out" }, 0.95);` : ''}

      ${isShow ? `// Specs cards - velvety staggered arrival
      tl.fromTo(".spec-card", { opacity: 0, y: 24, scale: 0.96, force3D: true }, { opacity: 1, y: 0, scale: 1, duration: 1.0, stagger: 0.1, ease: "expo.out" }, 1.1);` : ''}

      // Summary Card - grand smooth reveal
      tl.fromTo("#summaryCard", { opacity: 0, y: 28, scale: 0.97, force3D: true }, { opacity: 1, y: 0, scale: 1, duration: 1.1, ease: "expo.out" }, 1.35);

      // Bottom Bar - glowing rise
      tl.fromTo("#bottomBar", { opacity: 0, y: 24, force3D: true }, { opacity: 1, y: 0, duration: 1.0, ease: "expo.out" }, 1.55);

      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);

      // ── Auto-fit Arabic headline strictly to single line at maximum legible size ──
      function fitHeadlineToOneLine() {
        var el = document.getElementById('headlineText');
        var inner = document.getElementById('headlineTextInner');
        if (!el || !inner) return;
        var maxAllowedWidth = 920; // 960px container minus 40px for bar & margins
        var currentSize = ${titleFontSize};
        var minSize = 36; // Keep it bold and clearly readable, never shrink to tiny text
        el.style.fontSize = currentSize + 'px';
        while ((inner.offsetWidth + 36) > maxAllowedWidth && currentSize > minSize) {
          currentSize -= 1;
          el.style.fontSize = currentSize + 'px';
        }
      }
      fitHeadlineToOneLine();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fitHeadlineToOneLine);
      }
    </script>
  </body>
</html>`;

  fs.writeFileSync(path.join(REEL_DIR, 'index.html'), htmlTemplate, 'utf-8');

  const baseSlug = path.basename(targetFile, '.md').slice(0, 45);
  const outPath = path.join(OUT_DIR, `reel-${baseSlug}.mp4`);

  console.log('🚀 Rendering video with HyperFrames engine (120 FPS)...');
  const tempOut = path.join(OUT_DIR, `temp-${baseSlug}.mp4`);
  execSync(`npx hyperframes render -o "${tempOut}"`, {
    cwd: REEL_DIR,
    stdio: ['pipe', 'inherit', 'inherit'],
    input: '\n',
    env: { ...process.env, CI: '1' },
  });

  console.log('🔊 Adding AAC audio track and faststart header for Meta Story & Reels compatibility...');
  try {
    execSync(`ffmpeg -y -i "${tempOut}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -crf 22 -preset veryfast -pix_fmt yuv420p -r 120 -c:a aac -b:a 128k -shortest -movflags +faststart "${outPath}"`, {
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
    secondaryTitle: secondaryTitle || undefined,
    description: desc,
    postUrl: isShow ? `/shows/${baseSlug}` : `/news/${baseSlug}`,
    kind: isShow ? 'show' : 'news',
    slug: baseSlug,
    image: meta.image || '',
    renderedAt: Date.now(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'latest-render.json'), JSON.stringify(latestRender, null, 2), 'utf-8');

  // Also append to batch queue for multi-item publishing
  const queuePath = path.join(OUT_DIR, 'rendered-queue.json');
  let queue: any[] = [];
  if (fs.existsSync(queuePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      if (Array.isArray(parsed)) queue = parsed;
    } catch {
      queue = [];
    }
  }
  queue.push(latestRender);
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');

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

const isMain = process.argv[1]?.includes('generate-news-video');
if (isMain) {
  generateNewsVideo(process.argv[2]).catch(err => {
    console.error('❌ Error generating video:', err);
    process.exit(1);
  });
}

