// The show reel («الحلبة», chosen by the owner 2026-09-29): an official-poster look — the show's poster
// shattered into three shards that fly in and lock together, the Arabic and English names each on ONE
// line sized to fit, the details, and the site. 1080×1920, 8 seconds, every move on one GSAP timeline
// so the renderer can seek any frame. Content stays between y≈150 and ≈1700: the platforms draw their
// buttons above and the caption below.

export interface ShowReelData {
  arTitle: string;      // «بروجريس شابتر 198 وين سبتمبر اندز 27.09.2026»
  enTitle: string;      // «PROGRESS Chapter 198 When September Ends»
  federation: string;   // «INDIE»
  dateLabel: string;    // «27 سبتمبر»
  duration: string;     // «03:20:49»
  poster: string;       // path relative to the page
  logo: string;
}

const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The Arabic name exactly as the site shows it («عرض الرو 28.09.2026 مترجم»). Stripping «عرض»,
 *  the date and «مترجم» left «الرو» alone on the RAW reel — the owner wants the whole title (INCIDENTS #133). */
export function posterName(headline: string): string {
  return String(headline || '').replace(/\s{2,}/g, ' ').trim();
}

/** «03:20:49» → «3:20:49» */
export function shortDuration(d: string): string {
  return String(d || '').trim().replace(/^0(\d:)/, '$1');
}

export function showReelHtml(d: ShowReelData): string {
  return `<!doctype html>
<html lang="ar">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lalezar&family=Noto+Kufi+Arabic:wght@600;800;900&family=Anton&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #070707; }
  #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; direction: rtl; font-family: 'Noto Kufi Arabic', sans-serif; color: #fff; }
  .bg { position: absolute; inset: 0; background:
      radial-gradient(70% 38% at 50% 30%, rgba(200,16,32,.5), transparent 70%),
      radial-gradient(80% 30% at 50% 78%, rgba(140,0,14,.4), transparent 70%), #070707; }
  .bigword { position: absolute; top: 330px; left: -120px; width: 1500px; text-align: center; font-family: Anton; font-size: 300px; line-height: 1; color: transparent; -webkit-text-stroke: 3px rgba(255,255,255,.06); transform: rotate(-12deg); white-space: nowrap; direction: ltr; }
  .grain { position: absolute; inset: 0; opacity: .18; mix-blend-mode: overlay; pointer-events: none; z-index: 30;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
  .slash { position: absolute; top: 250px; left: -200px; width: 1480px; height: 22px; background: linear-gradient(90deg, transparent, #e0102a 20%, #ff3b3b 50%, #e0102a 80%, transparent); transform: rotate(-12deg); box-shadow: 0 0 40px rgba(255,40,60,.7); transform-origin: 100% 50%; }
  .ember { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: #ffb199; box-shadow: 0 0 10px #ff3b3b, 0 0 22px #e0102a; z-index: 25; opacity: 0; }
  .flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 28; pointer-events: none; }

  .top { position: absolute; top: 150px; left: 64px; right: 64px; height: 84px; display: flex; justify-content: space-between; align-items: center; z-index: 12; }
  .brand { display: flex; align-items: center; gap: 14px; font-family: Lalezar; font-size: 46px; }
  .brand img { width: 72px; height: 72px; border-radius: 50%; box-shadow: 0 0 0 3px #fff, 0 0 24px rgba(255,40,60,.6); }
  .excl { background: #fff; color: #c8102e; padding: 6px 30px; transform: skewX(-12deg); box-shadow: 6px 6px 0 #c8102e; }
  .excl span { display: inline-block; transform: skewX(12deg); font-weight: 900; font-size: 34px; }

  .stack { position: absolute; top: 272px; left: 40px; right: 40px; display: flex; flex-direction: column; align-items: center; z-index: 10; }
  /* The whole poster shows: the zone takes the image's own proportions, the shards split it */
  .posterzone { position: relative; width: 1000px; height: 563px; }
  .glow { position: absolute; inset: 24px -12px -12px 24px; background: #c8102e; clip-path: polygon(3% 7%, 60% 0%, 100% 5%, 100% 100%, 0% 95%); opacity: .95; }
  .shard { position: absolute; inset: 0; background: url('${esc(d.poster)}') center / 100% 100% no-repeat; }
  .sh1 { clip-path: polygon(0% 0%, 60% 0%, 53% 100%, 0% 100%); }
  .sh2 { clip-path: polygon(60.4% 0%, 100% 0%, 100% 57.5%, 56.4% 63%); }
  .sh3 { clip-path: polygon(56.3% 63.6%, 100% 58.1%, 100% 100%, 53.4% 100%); }
  .sheenwrap { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .sheen { position: absolute; top: -10%; bottom: -10%; width: 180px; left: -260px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); transform: skewX(-18deg); mix-blend-mode: overlay; }
  .edges { position: absolute; inset: 0; pointer-events: none; }
  .edges svg { width: 100%; height: 100%; overflow: visible; }
  .fed { position: absolute; bottom: -26px; right: 36px; font-family: Anton; font-size: 38px; letter-spacing: 4px; background: #c8102e; padding: 4px 26px; transform: skewX(-12deg); box-shadow: 8px 8px 0 #000; direction: ltr; }
  .fed span { display: inline-block; transform: skewX(12deg); }

  .titles { width: 980px; margin-top: 64px; text-align: center; }
  .ar { white-space: nowrap; font-family: Lalezar; font-weight: 400; font-size: 112px; line-height: 1.15; color: #fff; text-shadow: 5px 5px 0 #c8102e, 10px 10px 0 rgba(0,0,0,.9); }
  .en { white-space: nowrap; direction: ltr; font-family: Anton; font-size: 54px; line-height: 1.2; letter-spacing: 2px; color: #ff4d5e; margin-top: 8px; text-transform: uppercase; text-shadow: 0 4px 18px rgba(0,0,0,.9); }
  .ar span, .en span { display: inline-block; }
  .divider { margin: 22px auto 0; width: max-content; transform: skewX(-20deg); display: flex; gap: 10px; }
  .divider i { display: block; width: 150px; height: 8px; background: #c8102e; box-shadow: 0 0 18px rgba(255,40,60,.8); }
  .divider b { display: block; width: 60px; height: 8px; background: #fff; }

  .info { width: 952px; margin-top: 34px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .info > div { background: rgba(255,255,255,.06); border: 2px solid rgba(255,255,255,.18); border-top: 6px solid #c8102e; padding: 16px 10px 18px; transform: skewX(-10deg); text-align: center; }
  .info > div > * { display: block; transform: skewX(10deg); }
  .info small { font-size: 25px; font-weight: 800; color: #ff9aa4; }
  .info b { font-size: 38px; font-weight: 900; margin-top: 2px; white-space: nowrap; }

  .cta { position: relative; width: 952px; height: 150px; margin-top: 28px; display: flex; transform: skewX(-10deg); box-shadow: 14px 14px 0 rgba(0,0,0,.9); overflow: hidden; }
  .cta .a { flex: 0 0 40%; background: #c8102e; display: flex; flex-direction: column; justify-content: center; align-items: center; }
  .cta .b { flex: 1; background: #fff; color: #0a0a0a; display: flex; align-items: center; justify-content: center; }
  .cta .a > *, .cta .b > * { transform: skewX(10deg); }
  .cta .a small { font-size: 28px; font-weight: 800; line-height: 1.3; }
  .cta .a b { font-size: 48px; font-weight: 900; line-height: 1.25; display: block; }
  .cta .b span { font-family: Anton; font-size: 56px; letter-spacing: 1px; direction: ltr; }
  .cta .shine { position: absolute; top: 0; bottom: 0; width: 140px; left: -200px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="8" data-fps="120" data-width="1080" data-height="1920">
  <div class="bg"></div>
  <div class="bigword" id="bigword">ARAB WRESTLING • ARAB WRESTLING</div>
  <div class="slash" id="slash"></div>
  <div class="top">
    <div class="brand" id="brand"><img src="${esc(d.logo)}" alt=""><span>عرب راسلنج</span></div>
    <div class="excl" id="excl"><span>حصريًا</span></div>
  </div>
  <div class="stack">
    <div class="posterzone" id="pz">
      <div class="glow" id="glow"></div>
      <div class="shard sh1" id="sh1"></div><div class="shard sh2" id="sh2"></div><div class="shard sh3" id="sh3"></div>
      <div class="edges"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <polygon class="edge" points="0,0 600,0 530,1000 0,1000" fill="none" stroke="#fff" stroke-width="5" vector-effect="non-scaling-stroke"/>
        <polygon class="edge" points="604,0 1000,0 1000,575 564,630" fill="none" stroke="#fff" stroke-width="4" vector-effect="non-scaling-stroke"/>
        <polygon class="edge" points="563,636 1000,581 1000,1000 534,1000" fill="none" stroke="#fff" stroke-width="4" vector-effect="non-scaling-stroke"/>
      </svg></div>
      <div class="sheenwrap"><div class="sheen" id="sheen"></div></div>
      <div class="fed" id="fed"><span>${esc(d.federation)}</span></div>
    </div>
    <div class="titles">
      <div class="ar" id="ar"><span id="arIn">${esc(d.arTitle)}</span></div>
      <div class="en" id="en"><span id="enIn">${esc(d.enTitle)}</span></div>
      <div class="divider" id="divider"><i></i><b></b><i></i></div>
    </div>
    <div class="info" id="info">
      <div><small>ليلة العرض</small><b>${esc(d.dateLabel)}</b></div>
      <div><small>المدة</small><b>${esc(d.duration)}</b></div>
      <div><small>النسخة</small><b>كاملة ومترجمة</b></div>
    </div>
    <div class="cta" id="cta"><div class="a"><small>العرض كامل</small><b id="watch">شاهده الآن</b></div><div class="b"><span>arab-wrestling.com</span></div><div class="shine" id="ctaShine"></div></div>
  </div>
  <div class="flash" id="flash"></div>
  <div id="embers"></div>
  <div class="grain"></div>
</div>
<script>
  // ── one line each, as large as fits (the owner: the name grows or shrinks, never wraps or gets cut) ──
  function fit(boxId, inId, max, avail, min, spacing) {
    var b = document.getElementById(boxId), i = document.getElementById(inId);
    // Measure the final look, not the first frame of the animation (English starts letter-spaced)
    var saved = b.style.letterSpacing; if (spacing) b.style.letterSpacing = spacing;
    var z = max; b.style.fontSize = z + 'px';
    var w = i.scrollWidth;
    if (w > avail) { z = Math.max(min, Math.floor(z * avail / w)); b.style.fontSize = z + 'px'; }
    while (i.scrollWidth > avail && z > min) { z--; b.style.fontSize = z + 'px'; }
    if (spacing) b.style.letterSpacing = saved;
  }
  // The block sits in the middle of the safe area (below the header, above the caption zone)
  function centerStack() {
    var st = document.querySelector('.stack'); var h = st.offsetHeight;
    st.style.top = Math.round(Math.max(262, 262 + (1690 - 262 - h) / 2)) + 'px';
  }
  // The Arabic name leads: the English one never comes out bigger than ~70% of it
  function fitAll() {
    fit('ar', 'arIn', 112, 970, 34);
    var arSize = parseFloat(document.getElementById('ar').style.fontSize) || 112;
    fit('en', 'enIn', Math.min(54, Math.round(arSize * 0.7)), 970, 22, '2px');
    centerStack();
  }
  // ── the whole poster: the zone takes the image's proportions (within a sane range) ──
  function sizePoster() {
    var img = new Image();
    img.onload = function () {
      var ratio = img.naturalWidth / img.naturalHeight || 16 / 9;
      var h = Math.round(Math.min(700, Math.max(470, 1000 / ratio)));
      document.getElementById('pz').style.height = h + 'px';
      centerStack();
    };
    img.src = ${JSON.stringify(d.poster)};
  }
  sizePoster(); fitAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);

  // ── embers: seeded, so every render is the same ──
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  var box = document.getElementById('embers'), embers = [];
  for (var k = 0; k < 46; k++) { var e = document.createElement('div'); e.className = 'ember'; box.appendChild(e); embers.push(e); }

  var tl = gsap.timeline({ paused: true });
  var E = 'expo.out';
  // background life for all 8 seconds
  tl.fromTo('#bigword', { x: 60 }, { x: -160, duration: 8, ease: 'none' }, 0);
  tl.fromTo('#slash', { scaleX: 0 }, { scaleX: 1, duration: .8, ease: E }, .1);
  // header
  tl.fromTo('#brand', { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .9, ease: E }, .3);
  tl.fromTo('#excl', { scale: 1.8, rotation: -10, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: .7, ease: 'back.out(2.2)' }, .45);
  // the shards fly in from three sides and lock together
  tl.fromTo('#sh1', { x: -760, y: 60, rotation: -16, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 1.05, ease: E }, .55);
  tl.fromTo('#sh2', { x: 720, y: -340, rotation: 14, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 1.05, ease: E }, .68);
  tl.fromTo('#sh3', { x: 720, y: 380, rotation: -12, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 1.05, ease: E }, .8);
  tl.fromTo('#glow', { opacity: 0, scale: .92 }, { opacity: .95, scale: 1, duration: .8, ease: E }, 1.05);
  tl.fromTo('.edge', { strokeDasharray: 4000, strokeDashoffset: 4000 }, { strokeDashoffset: 0, duration: .9, stagger: .08, ease: 'power2.out' }, 1.2);
  // impact: flash + a short camera shake
  tl.fromTo('#flash', { opacity: 0 }, { opacity: .4, duration: .07, ease: 'none' }, 1.32);
  tl.to('#flash', { opacity: 0, duration: .5, ease: 'power2.out' }, 1.39);
  tl.fromTo('#pz', { x: 0 }, { x: 9, duration: .04, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 1.32);
  tl.fromTo('#pz', { scale: 1 }, { scale: 1.035, duration: 6.4, ease: 'sine.inOut' }, 1.6);
  tl.fromTo('#fed', { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: .7, ease: E }, 1.5);
  // names: Arabic wipes in from the right, English tightens into place
  tl.fromTo('#ar', { clipPath: 'inset(0 0 0 100%)', y: 18 }, { clipPath: 'inset(0 0 0 0%)', y: 0, duration: 1.0, ease: 'power3.out' }, 1.6);
  tl.fromTo('#en', { letterSpacing: '22px', opacity: 0 }, { letterSpacing: '2px', opacity: 1, duration: 1.1, ease: E }, 1.9);
  tl.fromTo('#divider > *', { scaleX: 0 }, { scaleX: 1, duration: .6, stagger: .08, ease: E }, 2.15);
  tl.fromTo('#info > div', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: .8, stagger: .1, ease: E }, 2.3);
  tl.fromTo('#cta', { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: .9, ease: E }, 2.6);
  // light passes: poster, then the site
  tl.fromTo('#sheen', { left: -260 }, { left: 1260, duration: 1.3, ease: 'power2.inOut' }, 3.0);
  tl.fromTo('#ctaShine', { left: -200 }, { left: 1100, duration: 1.1, ease: 'power2.inOut' }, 3.5);
  tl.fromTo('#ctaShine', { left: -200 }, { left: 1100, duration: 1.1, ease: 'power2.inOut' }, 6.1);
  tl.fromTo('#watch', { scale: 1 }, { scale: 1.08, duration: .35, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 4.7);
  tl.fromTo('#watch', { scale: 1 }, { scale: 1.08, duration: .35, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 7.0);
  // embers rise through the whole reel
  embers.forEach(function (e) {
    var x = rnd() * 1080, y0 = 700 + rnd() * 1300, rise = 500 + rnd() * 900, s = .4 + rnd() * 1.4, t0 = rnd() * 1.2;
    gsap.set(e, { left: x, top: 0, scale: s });
    tl.fromTo(e, { y: y0, x: 0, opacity: 0 }, { y: y0 - rise, x: (rnd() - .5) * 160, duration: 8 - t0, ease: 'none' }, t0);
    tl.to(e, { opacity: .35 + rnd() * .6, duration: .6, ease: 'none' }, t0);
    tl.to(e, { opacity: 0, duration: .8, ease: 'none' }, 7.2);
  });

  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = tl;
  tl.seek(0);
</script>
</body>
</html>`;
}
