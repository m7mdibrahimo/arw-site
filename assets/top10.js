/* «الأكثر مشاهدة» on the home page (INCIDENTS #180): the ten most viewed shows and stories, Netflix
   style, from the Worker's /top10 (the site's own Cloudflare analytics). No list, no section. */
(function () {
  if (location.pathname !== '/') return;
  var css = `
  #top10 { --t10-accent:#ff6a3d; --t10-num-fill:var(--bg); --t10-num-stroke:#aab5bf; --t10-num-stroke-hover:var(--t10-accent); --t10-card-shadow:0 18px 34px -22px rgba(20,28,36,.55); }
  html.arw-dark #top10 { --t10-num-stroke:#5a6a76; --t10-card-shadow:0 18px 34px -18px rgba(0,0,0,.8); }
  #top10 .section-head h2 .dot { box-shadow:0 0 0 6px rgba(255,106,61,.16); }
  #top10 .t10-bar { display:flex; align-items:center; justify-content:center; gap:10px; margin:-14px 0 18px; }
  #top10 .t10-tabs { display:flex; gap:4px; background:var(--card); border:1px solid var(--line); padding:4px; border-radius:999px; }
  #top10 .t10-tabs button { font:700 13px 'Cairo',sans-serif; padding:5px 16px; border-radius:999px; color:var(--muted); background:none; border:0; cursor:pointer; transition:background .25s,color .25s; }
  #top10 .t10-tabs button[aria-pressed="true"] { background:var(--t10-accent); color:#fff; }
  /* the whole block on a soft panel with a light frame, so it reads as one section in daylight too */
  #top10 { --t10-panel:rgba(20,30,40,.035); --t10-panel-line:rgba(20,30,40,.09); }
  html.arw-dark #top10 { --t10-panel:rgba(255,255,255,.03); --t10-panel-line:rgba(255,255,255,.07); }
  #top10 .t10-stage { position:relative; }
  #top10 .t10-next { left:-14px; } #top10 .t10-prev { right:-14px; }
  #top10 .t10-row { display:flex; gap:22px; overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain; touch-action:pan-x pan-y; scroll-snap-type:x mandatory; scroll-padding-inline:6px;
    padding:10px 6px 22px; scrollbar-width:none;
    -webkit-mask-image:linear-gradient(to left, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%);
            mask-image:linear-gradient(to left, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); }
  #top10 .t10-row::-webkit-scrollbar { display:none; }
  /* one item: the number stands behind the card's right edge */
  #top10 .t10-item { flex:0 0 auto; position:relative; display:block; padding-inline-start:70px; scroll-snap-align:start; text-decoration:none; color:#fff; outline:none; }
  #top10 .t10-item.two { padding-inline-start:108px; }
  #top10 .t10-n { position:absolute; inset-inline-start:0; bottom:-6px; z-index:0; font:900 150px/1 'Cairo',sans-serif; letter-spacing:-4px;
    color:var(--t10-num-fill); -webkit-text-stroke:3px var(--t10-num-stroke); paint-order:stroke fill; transition:-webkit-text-stroke-color .35s ease; pointer-events:none; user-select:none; }
  #top10 .t10-item:hover .t10-n, #top10 .t10-item:focus-visible .t10-n { -webkit-text-stroke-color:var(--t10-num-stroke-hover); }
  #top10 .t10-card { position:relative; z-index:1; display:block; width:236px; aspect-ratio:16/10; border-radius:14px; overflow:hidden; background:#151a1f;
    box-shadow:var(--t10-card-shadow); outline:2px solid transparent; outline-offset:2px; transition:outline-color .3s ease, box-shadow .3s ease; }
  #top10 .t10-img { position:absolute; inset:0; background:#151a1f center/cover no-repeat; transition:transform .7s cubic-bezier(.16,1,.3,1); }
  #top10 .t10-card::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,8,10,0) 38%, rgba(5,8,10,.92) 100%); }
  #top10 .t10-item:hover .t10-card, #top10 .t10-item:focus-visible .t10-card { outline-color:var(--t10-accent); }
  #top10 .t10-item:hover .t10-img { transform:scale(1.06); }
  #top10 .t10-chip { position:absolute; z-index:2; top:9px; inset-inline-start:9px; background:var(--t10-accent); color:#fff; font:900 11px/1.6 'Cairo',sans-serif; padding:0 9px; border-radius:999px; }
  #top10 .t10-title { position:absolute; z-index:2; inset-inline:10px; bottom:9px; font:700 13.5px/1.45 'Cairo',sans-serif; text-shadow:0 1px 6px rgba(0,0,0,.6);
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  /* arrows: desktop only, show when there is more to see */
  #top10 .t10-arrow { position:absolute; top:50%; z-index:3; width:44px; height:44px; margin-top:-26px; border-radius:50%; border:1px solid var(--line);
    background:var(--card); color:var(--ink); display:none; align-items:center; justify-content:center; cursor:pointer;
    box-shadow:0 10px 24px -12px rgba(0,0,0,.5); transition:opacity .25s, border-color .25s, color .25s; }
  #top10 .t10-arrow:hover { border-color:var(--t10-accent); color:var(--t10-accent); }
  #top10 .t10-arrow[disabled] { opacity:0; pointer-events:none; }
  #top10 .t10-next { left:-8px; } #top10 .t10-prev { right:-8px; }
  @media (hover:hover) and (pointer:fine) { #top10 .t10-arrow { display:flex; } }
  @media (max-width:700px) {
    #top10 .t10-row { gap:14px; padding-inline:2px; }
    #top10 .t10-item { padding-inline-start:50px; } #top10 .t10-item.two { padding-inline-start:80px; }
    #top10 .t10-n { font-size:112px; bottom:-4px; -webkit-text-stroke-width:2.5px; }
    #top10 .t10-card { width:190px; }
  }
  @media (prefers-reduced-motion:reduce) { #top10 .t10-img, #top10 .t10-n, #top10 .t10-card { transition:none; } #top10 .t10-item:hover .t10-img { transform:none; } }`;
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var esc = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/top10?range=';
  var cache = {};
  function load(range) {
    if (cache[range]) return Promise.resolve(cache[range]);
    return fetch(API + range).then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (d) { cache[range] = Array.isArray(d.items) ? d.items : []; return cache[range]; })
      .catch(function () { return []; });
  }
  var kindLabel = { show: 'عرض', news: 'خبر', recap: 'ملخص', nostalgia: 'نوستالجيا' };
  function rowHtml(top) {
    return top.map(function (i, n) {
      return '<a class="t10-item' + (n === 9 ? ' two' : '') + '" href="' + esc(i.url) + '"><span class="t10-n" aria-hidden="true">' + (n + 1) + '</span><span class="t10-card"><span class="t10-img" style="background-image:url(\'' + esc(i.image) + '\')"></span><span class="t10-chip">' + (kindLabel[i.kind] || 'عرض') + '</span><span class="t10-title">' + esc(i.title) + '</span></span></a>';
    }).join('');
  }
  load('day').then(function (top) {
    if (!top || top.length < 5) return;
    var spot = document.getElementById('spotlight-wrap');
    if (!spot) return;
    var sec = document.createElement('section');
    sec.className = 'content'; sec.id = 'top10'; sec.setAttribute('aria-label', 'الأكثر مشاهدة');
    sec.innerHTML = '<div class="wrap"><div class="section-head"><div class="head-text"><h2 style="color:#ff6a3d;"><span class="dot" style="background:#ff6a3d"></span>الأكثر مشاهدة</h2><p>أكثر العروض والأخبار متابعة من الجمهور الآن</p></div></div>' +
      '<div class="t10-bar"><div class="t10-tabs" role="group" aria-label="الفترة"><button type="button" data-r="day" aria-pressed="true">اليوم</button><button type="button" data-r="week" aria-pressed="false">هذا الأسبوع</button></div></div>' +
      '<div class="t10-stage"><button type="button" class="t10-arrow t10-prev" aria-label="السابق"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '<div class="t10-row">' + rowHtml(top) + '</div>' +
      '<button type="button" class="t10-arrow t10-next" aria-label="التالي"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button></div></div>';
    spot.parentNode.insertBefore(sec, spot.nextSibling);
    var row = sec.querySelector('.t10-row'), prev = sec.querySelector('.t10-prev'), next = sec.querySelector('.t10-next');
    var step = function () { return Math.max(260, row.clientWidth * 0.8); };
    prev.addEventListener('click', function () { row.scrollBy({ left: step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { row.scrollBy({ left: -step(), behavior: 'smooth' }); });
    var sync = function () { var max = row.scrollWidth - row.clientWidth, x = Math.abs(row.scrollLeft); prev.disabled = x < 4; next.disabled = x > max - 4; };
    row.addEventListener('scroll', function () { requestAnimationFrame(sync); }, { passive: true });
    addEventListener('resize', sync); sync();
    sec.querySelectorAll('.t10-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        sec.querySelectorAll('.t10-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        load(b.dataset.r).then(function (list) { if (list.length) { row.innerHTML = rowHtml(list); row.scrollLeft = 0; sync(); } });
      });
    });
  });
})();
