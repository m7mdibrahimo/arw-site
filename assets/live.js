/* «بث مباشر»: the section's cards and a show's ring → bell → live links. Data: arw-site-bot /live/data (worker/src/live.ts). */
(function () {
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data';
  var root = document.getElementById('lvRoot');
  if (!root) return;
  var key = root.getAttribute('data-key') || '';
  if (!key) { var m = location.pathname.match(/^\/live\/([a-z0-9-]+)\/?$/); if (m) key = m[1]; }
  // a show's address served by the section's page (site-worker/fast.js, before the show's own page is built): it becomes the show's page
  if (key && !document.getElementById('lvShow')) root.innerHTML = '<div id="lvShow"></div><section class="lv-more"><h2>عروض أخرى في البث المباشر</h2><p><a href="/live/" style="color:var(--teal);font-weight:800">كل عروض البث المباشر ←</a></p></section>';
  var skew = 0; // the server's clock minus this device's: a countdown right even on a phone set a few minutes off
  var data = null, timer = null, poll = null, rang = false, lastLinks = '';
  var ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
  var COL = ['#0e9594', '#f2a53c', '#ff6f59', '#7c6ee8', '#38bdf8', '#a3e635'];
  var NOTE = ['الأكثر ثباتًا', 'مصدر إضافي', 'مصدر إضافي', 'مصدر احتياطي'];
  var BELL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a1 1 0 0 1 1 1v1.07A7 7 0 0 1 19 11v4.6l1.7 2.55A1.2 1.2 0 0 1 19.7 20H4.3a1.2 1.2 0 0 1-1-1.85L5 15.6V11a7 7 0 0 1 6-6.93V3a1 1 0 0 1 1-1Zm-2.5 19h5a2.5 2.5 0 0 1-5 0Z"/></svg>';

  function now() { return Date.now() + skew; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(ms) { ms = Math.max(0, ms); var s = Math.floor(ms / 1000); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; }
  function period(h) { return h < 5 ? 'فجرًا' : h < 12 ? 'صباحًا' : h < 15 ? 'ظهرًا' : h < 18 ? 'عصرًا' : h < 20 ? 'مساءً' : 'ليلًا'; }
  function clock(ts) { var d = new Date(ts), h = d.getHours(), h12 = h % 12 || 12; return h12 + ':' + pad(d.getMinutes()) + ' ' + period(h); }
  function day(ts) {
    var d = new Date(ts), t = new Date(now()), y = new Date(now() + 86400000);
    var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
    if (same(d, t)) return 'اليوم';
    if (same(d, y)) return 'غدًا';
    try { return new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' }).format(d); } catch (e) { return d.toLocaleDateString(); }
  }
  function zoneName() { try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return z.indexOf('Cairo') > -1 ? 'بتوقيت القاهرة' : z.indexOf('Riyadh') > -1 ? 'بتوقيت الرياض' : 'بتوقيتك'; } catch (e) { return 'بتوقيتك'; } }
  function status(s) { var n = now(); return n >= s.end ? 'ended' : n >= s.start ? 'live' : 'soon'; }
  function img(s) { return s.img ? (s.img.charAt(0) === '/' ? s.img : s.img) : '/assets/hero-bg.jpg'; }

  function load(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', API + '?t=' + Math.floor(Date.now() / 20000), true);
    x.timeout = 12000;
    x.onload = function () {
      try {
        var d = JSON.parse(x.responseText);
        // the edge copy can be 20 s old: its «now» is when it was made, so only a large gap moves the clock
        var gap = d.now - Date.now();
        if (Math.abs(gap) > 60000) skew = gap;
        data = d; cb && cb(d);
      } catch (e) { cb && cb(null); }
    };
    x.onerror = x.ontimeout = function () { cb && cb(null); };
    x.send();
  }

  // ── the section ──
  function renderList() {
    var box = document.getElementById('lvList');
    if (!box) return;
    var shows = (data && data.shows || []).filter(function (s) { return status(s) !== 'ended'; });
    shows.sort(function (a, b) { var A = status(a) === 'live' ? 0 : 1, B = status(b) === 'live' ? 0 : 1; return A - B || a.start - b.start; });
    if (!shows.length) {
      box.innerHTML = '<div class="lv-empty"><b>لا يوجد بث الآن</b>يظهر هنا كل عرض فور الإعلان عن بثه المباشر، مع عدّاد حتى لحظة البداية ثم روابط البث كلها.</div>';
      return;
    }
    box.innerHTML = '<div class="lv-grid">' + shows.map(function (s) {
      var st = status(s), p = parts(s.start - now());
      var ropes = '', fill = st === 'live' ? 4 : Math.max(1, Math.min(4, s.srcs));
      for (var i = 0; i < 4; i++) ropes += '<i' + (i < fill ? '' : ' class="o"') + '></i>';
      var cd = st === 'live' ? '<span class="tagl"><i></i>مباشر الآن</span>' :
        '<div class="cd" data-start="' + s.start + '">' + (p.d ? '<b>' + p.d + '<small>يوم</small></b>' : '') + '<b>' + pad(p.h) + '<small>ساعة</small></b><b>' + pad(p.m) + '<small>دقيقة</small></b>' + (p.d ? '' : '<b>' + pad(p.s) + '<small>ثانية</small></b>') + '</div>';
      var line = st === 'live' ? 'بدأ منذ ' + Math.max(1, Math.round((now() - s.start) / 60000)) + ' دقيقة' + (s.n ? ' · ' + s.n + ' رابطًا' : '') : 'يدقّ الجرس ' + day(s.start) + ' ' + clock(s.start) + ' ' + zoneName();
      var pill = st === 'live' ? '<span class="lv-pill c">ادخل البث ←</span>' : s.srcs ? '<span class="lv-pill">' + (s.srcs > 2 ? s.srcs + ' مصادر جاهزة' : s.srcs === 2 ? 'مصدران جاهزان' : 'مصدر جاهز') + '</span>' : '<span class="lv-pill g">بانتظار الروابط</span>';
      return '<a class="lv-card' + (st === 'live' ? ' is-live' : '') + '" href="/live/' + esc(s.k) + '/"><div class="im" style="background-image:url(\'' + esc(img(s)) + '\')"><span class="fed">' + esc(s.fed) + '</span>' + cd + '</div><div class="bd"><h3>' + esc(s.t) + '</h3><p>' + line + '</p><div class="ft">' + pill + '<div class="lv-ropes">' + ropes + '</div></div></div></a>';
    }).join('') + '</div>';
  }

  // ── a show ──
  function show() { return (data && data.shows || []).filter(function (s) { return s.k === key; })[0] || null; }
  function base() {
    // what the page itself knows (its front matter) until the data comes
    var s = show();
    if (s) return s;
    var a = root.getAttribute('data-start');
    if (!a) return null;
    return { k: key, t: root.getAttribute('data-title') || '', fed: root.getAttribute('data-fed') || '', start: Date.parse(a), end: Date.parse(root.getAttribute('data-end') || a), img: root.getAttribute('data-img') || '', en: root.getAttribute('data-en') || '', srcs: 0, n: 0, links: [] };
  }
  function stageHtml(s) {
    return '<div class="lv-stage" id="lvStage"><div class="bgimg" style="background-image:url(\'' + esc(img(s)) + '\')"></div>' +
      '<div class="lv-top"><div><h1>' + esc(s.t) + ' — بث مباشر</h1><p>' + esc(day(s.start)) + ' · ' + clock(s.start) + ' ' + zoneName() + '</p></div><span class="fed">' + esc(s.fed) + '</span></div>' +
      '<div class="lv-ring"><div class="post p1"></div><div class="post p2"></div><div class="mat"></div><div class="rope r1"></div><div class="rope r2"></div>' +
      '<div class="lv-digits"><div class="lv-d"><b id="lvD">00</b><small>يوم</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvH">00</b><small>ساعة</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvM">00</b><small>دقيقة</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvS">00</b><small>ثانية</small></div></div>' +
      '<div class="lv-tension"><div class="t"><i id="lvT"></i></div><div class="lab"><span>آخر 24 ساعة قبل العرض</span><span>الحبال تشتدّ كلما اقترب الجرس</span><span>' + clock(s.start) + ' ' + zoneName() + '</span></div></div></div>' +
      '<div class="lv-chips"><span>' + BELL + ' يدقّ الجرس <b>' + clock(s.start) + '</b> ' + zoneName() + '</span><span id="lvReady">' + readyText(s) + '</span><span>تتحدّث الروابط وحدها، لا حاجة لإعادة تحميل الصفحة</span></div>' +
      '<div class="lv-bell" id="lvBell"><div>' + BELL + '<b>دقّ الجرس!</b></div></div></div>';
  }
  function readyText(s) {
    if (!s.srcs) return 'الروابط تُضاف هنا فور نشرها';
    return (s.srcs > 2 ? s.srcs + ' مصادر جاهزة' : s.srcs === 2 ? 'مصدران جاهزان' : 'مصدر جاهز') + (s.n ? ' · ' + s.n + ' رابطًا تُفتح لحظة البداية' : '');
  }
  function liveHtml(s) {
    var groups = {};
    (s.links || []).forEach(function (l) { (groups[l.s] = groups[l.s] || []).push(l); });
    var QO = { FHD: 0, HD: 1, SD: 2, LQ: 3 };
    Object.keys(groups).forEach(function (g) { groups[g].sort(function (a, b) { return (b.e ? 1 : 0) - (a.e ? 1 : 0) || (a.q in QO ? QO[a.q] : 4) - (b.q in QO ? QO[b.q] : 4) || a.n - b.n; }); });
    var ids = Object.keys(groups).sort(function (a, b) { return a - b; });
    var fresh = now() - 5 * 60000;
    var body = ids.length ? '<div class="lv-srcs">' + ids.map(function (g, i) {
      var ls = groups[g], isNew = ls.some(function (l) { return l.at > fresh && l.at > s.start; });
      return '<div class="lv-src">' + (isNew ? '<span class="lv-new">جديد</span>' : '') + '<h3><i style="background:' + COL[i % COL.length] + '">' + (i + 1) + '</i> المصدر ' + (ORD[i] || (i + 1)) + '</h3><p>' + (NOTE[i] || 'مصدر إضافي') + '</p><div class="lv-lk">' +
        ls.map(function (l, j) {
          var label = (l.e ? 'شاهد هنا' : 'بث ' + (j + 1)) + (l.q ? ' <em>' + esc(l.q) + '</em>' : '');
          return l.e ? '<button type="button" class="' + esc(l.q) + '" data-embed="' + esc(l.u) + '">' + label + '</button>' : '<a class="' + esc(l.q) + '" href="' + esc(l.u) + '" target="_blank" rel="nofollow noopener noreferrer">' + label + '</a>';
        }).join('') + '</div></div>';
    }).join('') + '</div><div class="lv-player" id="lvPlayer"></div><div class="lv-note">إذا توقّف بث فجرّب رابطًا آخر أو مصدرًا آخر؛ كل رابط جديد يظهر هنا وحده خلال دقيقة.</div>'
      : '<div class="lv-wait">تُضاف روابط البث هنا لحظة نشرها، والصفحة تتحدّث وحدها كل دقيقة.</div>';
    return '<div class="lv-live" id="lvLive"><div class="lv-onair"><div class="b">' + BELL + '</div><div><h2>دقّ الجرس — البث مباشر الآن</h2><p>' + esc(s.t) + ' · الروابط تتحدّث وحدها كل دقيقة</p></div><div class="lv-el"><b id="lvE">00:00:00</b><small>منذ بداية العرض</small></div></div>' + body + '</div>';
  }
  function endedHtml(s) {
    return '<div class="lv-ended"><b>انتهى البث المباشر لعرض ' + esc(s.t) + '</b><p>يُنشر العرض كاملًا في قسم عروض المصارعة فور جاهزيته.</p><a href="/shows/">إلى عروض المصارعة</a></div>';
  }
  var mode = '', built = 0;
  function paint() {
    var s = base();
    var box = document.getElementById('lvShow');
    if (!box) return;
    if (!s) { box.innerHTML = data ? endedHtml({ t: root.getAttribute('data-title') || 'هذا العرض' }) : ''; return; }
    var st = status(s);
    if (s.t && document.title.indexOf(s.t) < 0) document.title = 'بث مباشر ' + s.t + ' | عرب راسلنج';
    if (st === 'soon') {
      if (mode !== 'soon' || built !== s.start) { box.innerHTML = stageHtml(s); mode = 'soon'; built = s.start; prev = {}; }
      var r = document.getElementById('lvReady'); if (r) r.innerHTML = readyText(s);
      return tick();
    }
    if (st === 'live') {
      var sig = JSON.stringify(s.links || []);
      if (mode === 'soon' && !rang) { rang = true; ring(function () { mode = ''; paint(); }); return; }
      if (mode !== 'live' || sig !== lastLinks) {
        var player = document.getElementById('lvPlayer'), keep = player && player.innerHTML;
        box.innerHTML = liveHtml(s); mode = 'live'; lastLinks = sig;
        if (keep) { var p2 = document.getElementById('lvPlayer'); if (p2) { p2.innerHTML = keep; p2.className = 'lv-player on'; } }
      }
      return tick();
    }
    if (mode !== 'ended') { box.innerHTML = endedHtml(s); mode = 'ended'; }
  }
  function ring(done) {
    var b = document.getElementById('lvBell');
    if (!b) return done();
    b.className = 'lv-bell on';
    setTimeout(done, 2300);
  }
  var prev = {};
  function set(id, v) { var el = document.getElementById(id); if (!el) return; if (prev[id] !== v) { el.textContent = v; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); prev[id] = v; } }
  function tick() {
    var s = base(); if (!s) return;
    var n = now();
    if (mode === 'soon') {
      var left = s.start - n;
      if (left <= 0) return paint();
      var p = parts(left);
      set('lvD', pad(p.d)); set('lvH', pad(p.h)); set('lvM', pad(p.m)); set('lvS', pad(p.s));
      var t = document.getElementById('lvT'); if (t) t.style.width = Math.max(2, Math.min(100, 100 - left / 864000)) + '%';
      var stg = document.getElementById('lvStage'); if (stg) stg.classList.toggle('final', left <= 10000);
    } else if (mode === 'live') {
      if (n >= s.end) return paint();
      var e = parts(n - s.start), el = document.getElementById('lvE');
      if (el) el.textContent = pad(e.d * 24 + e.h) + ':' + pad(e.m) + ':' + pad(e.s);
    }
  }
  function tickList() {
    var cds = document.querySelectorAll('.lv-card .cd[data-start]');
    for (var i = 0; i < cds.length; i++) {
      var st = +cds[i].getAttribute('data-start'), left = st - now();
      if (left <= 0) { renderList(); return; }
      var p = parts(left), bs = cds[i].querySelectorAll('b');
      var vals = p.d ? [p.d, pad(p.h), pad(p.m)] : [pad(p.h), pad(p.m), pad(p.s)];
      for (var j = 0; j < bs.length && j < vals.length; j++) bs[j].firstChild.nodeValue = vals[j];
    }
  }
  // how often to ask again: every minute while a show is near or on, else every ten; never while the tab is hidden
  function schedule() {
    clearTimeout(poll);
    var s = key ? base() : null, n = now(), wait = 600000;
    var list = key ? (s ? [s] : []) : (data && data.shows || []);
    list.forEach(function (x) {
      if (n >= x.start - 15 * 60000 && n < x.end) wait = Math.min(wait, 60000);
      else if (x.start - 10 * 60000 > n) wait = Math.min(wait, Math.max(5000, x.start - 10 * 60000 - n + 3000)); // the links open ten minutes before
    });
    poll = setTimeout(function () { if (document.hidden) return schedule(); load(function () { key ? paint() : renderList(); schedule(); }); }, wait);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(function () { key ? paint() : renderList(); schedule(); }); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-embed]');
    if (!b) return;
    var p = document.getElementById('lvPlayer'); if (!p) return;
    p.innerHTML = '<iframe src="' + esc(b.getAttribute('data-embed')) + '" allowfullscreen allow="autoplay; fullscreen; encrypted-media" referrerpolicy="no-referrer"></iframe>';
    p.className = 'lv-player on';
    p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  if (key) { paint(); load(function () { paint(); schedule(); }); timer = setInterval(tick, 1000); }
  else { load(function () { renderList(); schedule(); }); timer = setInterval(tickList, 1000); }
})();
