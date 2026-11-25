/* «بث مباشر» on the home page (INCIDENTS #1537): the strip under the hero tells of the section, and of the show that is
   on now («مباشر الآن») or the next one within two days (its countdown, in the visitor's own time). One request a visit,
   kept for two minutes in the tab; again each minute only while a show is close or on. */
(function () {
  var a = document.getElementById('lvStrip');
  if (!a) return;
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data';
  var tEl = document.getElementById('lvsT'), sEl = document.getElementById('lvsS'), tagEl = document.getElementById('lvsTag'), cdEl = document.getElementById('lvsCd'), goEl = document.getElementById('lvsGo'),
    imEl = document.getElementById('lvsIm'), dotsEl = document.getElementById('lvsDots'), fedEl = document.getElementById('lvsFed'), hEl = document.getElementById('lvsH'), mEl = document.getElementById('lvsM'), xEl = document.getElementById('lvsX'), shownImg = '';
  var skew = 0, show = null, list = [], idx = 0, held = 0, hover = false, TURN = 7, tz = '', zone = 'بتوقيتك', timer = null;
  var SHORT = { SA: 'السعودية', AE: 'الإمارات', US: 'أمريكا', GB: 'بريطانيا', PS: 'فلسطين', SY: 'سوريا' };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function now() { return Date.now() + skew; }
  function zp(ts) {
    var o = {};
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = p.value; }); } catch (e) { var d = new Date(ts); o = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }; }
    return { n: Math.round(Date.UTC(+o.year, +o.month - 1, +o.day) / 86400000), h: (+o.hour) % 24, mi: +o.minute };
  }
  function period(h) { return h < 3 ? 'بعد منتصف الليل' : h < 5 ? 'فجرًا' : h < 12 ? 'صباحًا' : h < 15 ? 'ظهرًا' : h < 18 ? 'عصرًا' : 'مساءً'; }
  function when(ts) {
    var p = zp(ts), t = zp(now()), d = p.n - t.n, day;
    if (d === 0) day = p.h >= 17 || p.h < 6 ? 'الليلة' : 'اليوم';
    else if (d === 1 && p.h < 6 && t.h >= 6) day = 'الليلة';
    else { try { day = new Intl.DateTimeFormat('ar', { timeZone: tz || undefined, weekday: 'long' }).format(new Date(ts)); } catch (e) { day = ''; } if (p.h < 6) day = 'فجر ' + day; }
    return day + ' ' + (p.h % 12 || 12) + ':' + pad(p.mi) + ' ' + period(p.h) + ' ' + zone;
  }
  function nm(s) { var t = s.t || ''; return !t || /^عرض\s/.test(t) ? t : 'عرض ' + t; }
  // the number and its word never part at the end of a line (\u00a0)
  function srv(n) { return n ? n + (n > 2 && n < 11 ? '\u00a0سيرفرات' : '\u00a0سيرفرًا') : ''; }
  // the show's picture is fetched first and put in only once it is whole (no other picture before it, no half-drawn one)
  function setImg(src) {
    shownImg = src;
    var u = String(src).replace(/['\\()]/g, ''), im = new Image();
    im.onload = im.onerror = function () { if (shownImg !== src) return; imEl.style.backgroundImage = "url('" + u + "')"; imEl.className = 'lvs-im is-in'; };
    im.src = u;
  }
  // no show near: the section's own picture
  function plain() { if (shownImg !== '/assets/hero-bg.jpg') setImg('/assets/hero-bg.jpg'); }
  function paint() {
    if (!show) return;
    var n = now();
    if (n >= show.end) return;
    a.href = '/live/' + show.k + '/';
    // the show's own picture and its federation, once a show is known
    if (show.img) { if (shownImg !== show.img) setImg(show.img); } else plain();
    if (show.fed) { fedEl.textContent = show.fed; fedEl.hidden = false; }
    if (n >= show.start) {
      a.className = 'lvs is-live';
      tagEl.textContent = 'مباشر الآن';
      tEl.textContent = 'بث مباشر ' + nm(show);
      sEl.textContent = (show.n ? srv(show.n) + '\u00a0جاهزة للمشاهدة · ' : '') + 'بدأ ' + when(show.start).replace(/^(الليلة|اليوم) /, '');
      cdEl.hidden = true; goEl.textContent = 'شاهد الآن ‹';
    } else {
      var left = Math.floor((show.start - n) / 1000), h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      a.className = 'lvs is-soon';
      tagEl.textContent = 'البث القادم';
      tEl.textContent = 'بث مباشر ' + nm(show);
      sEl.textContent = when(show.start) + (show.n ? ' · ' + srv(show.n) + '\u00a0جاهزة' : '');
      cdEl.hidden = false; hEl.textContent = pad(h); mEl.textContent = pad(m); xEl.textContent = pad(s);
      goEl.textContent = 'صفحة البث ‹';
    }
  }
  function use(d) {
    if (!d || !d.shows) return;
    try { tz = d.geo && d.geo.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var c = d.geo && d.geo.c, name = '';
    if (c) { name = SHORT[c] || ''; if (!name) try { name = new Intl.DisplayNames(['ar'], { type: 'region' }).of(c) || ''; } catch (e) { name = ''; } }
    zone = name ? 'بتوقيت ' + name : 'بتوقيتك';
    // every show on now, then every one within two days, soonest first: one at a time, turning to the next every
    // few seconds like a slider (owner 2026-11-25)
    var n = now(), on = [], soon = [];
    d.shows.forEach(function (s) {
      if (n >= s.start && n < s.end) on.push(s);
      else if (s.start > n && s.start - n < 48 * 3600000) soon.push(s);
    });
    on.sort(function (x, y) { return x.start - y.start; }); soon.sort(function (x, y) { return x.start - y.start; });
    var keep = show && show.k;
    list = on.concat(soon).slice(0, 6);
    idx = 0; for (var i = 0; i < list.length; i++) if (list[i].k === keep) idx = i;
    show = list[idx] || null;
    list.forEach(function (s) { if (s.img) new Image().src = String(s.img).replace(/['\\()]/g, ''); });
    marks();
    // kept for the next visit: the strip shows this show from the first frame (index.njk), no other picture before it
    try { if (list[0]) localStorage.setItem('arwLiveLast', JSON.stringify({ k: list[0].k, img: list[0].img || '', title: 'بث مباشر ' + nm(list[0]), end: list[0].end })); else localStorage.removeItem('arwLiveLast'); } catch (e) {}
    if (!show) plain();
    paint();
    hold();
    clearInterval(timer);
    if (show) timer = setInterval(tick, 1000);
  }
  // the marks under the strip: one per show, the one shown in red (none for a single show)
  function marks() {
    dotsEl.innerHTML = '';
    dotsEl.hidden = list.length < 2;
    for (var i = 0; i < list.length && list.length > 1; i++) { var m = document.createElement('i'); if (i === idx) m.className = 'on'; dotsEl.appendChild(m); }
  }
  function go(to) {
    if (list.length < 2) return;
    idx = (to + list.length) % list.length; held = 0;
    a.classList.add('is-turn');
    setTimeout(function () { show = list[idx]; paint(); marks(); hold(); a.classList.remove('is-turn'); }, 200);
  }
  // while several shows take turns the strip keeps its tallest height, so the page under it never jumps
  var tallest = 0;
  function hold() {
    if (list.length < 2) { a.style.minHeight = ''; tallest = 0; return; }
    // each show is laid out once, unseen, to find the tallest before the first turn
    if (!tallest) { a.style.minHeight = ''; var cur = show; list.forEach(function (s) { show = s; paint(); tallest = Math.max(tallest, a.offsetHeight); }); show = cur; paint(); }
    a.style.minHeight = tallest + 'px';
  }
  window.addEventListener('resize', function () { tallest = 0; hold(); });
  // measured again once the site's font is in (the text takes more room in it)
  try { document.fonts.ready.then(function () { tallest = 0; hold(); }); } catch (e) {}
  function tick() {
    // a show that ended leaves the turn
    var n = now();
    if (list.some(function (s) { return n >= s.end; })) { list = list.filter(function (s) { return n < s.end; }); if (idx >= list.length) idx = 0; show = list[idx] || null; marks(); if (!show) { plain(); return; } }
    paint();
    if (list.length > 1 && !hover && !document.hidden && ++held >= TURN) go(idx + 1);
  }
  a.addEventListener('mouseenter', function () { hover = true; });
  a.addEventListener('mouseleave', function () { hover = false; });
  // a swipe on the phone turns it by hand (and does not open the page)
  var sx = null, swiped = false;
  a.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; swiped = false; }, { passive: true });
  a.addEventListener('touchend', function (e) {
    if (sx === null || list.length < 2) return;
    var dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 40) { swiped = true; go(idx + (dx > 0 ? 1 : -1)); }
  }, { passive: true });
  a.addEventListener('click', function (e) { if (swiped) { e.preventDefault(); swiped = false; } });
  function load() {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('arwLiveStrip') || 'null'); } catch (e) { cached = null; }
    if (cached && Date.now() - cached.at < 120000) { skew = cached.skew; return use(cached.d); }
    var x = new XMLHttpRequest(), sent = Date.now();
    x.open('GET', API, true);
    x.timeout = 10000;
    x.onload = function () {
      try {
        var d = JSON.parse(x.responseText), got = Date.now();
        if (d.t) skew = d.t + (got - sent) / 2 - got;
        try { sessionStorage.setItem('arwLiveStrip', JSON.stringify({ at: got, skew: skew, d: d })); } catch (e) {}
        use(d);
      } catch (e) {}
    };
    x.send();
  }
  load();
  // a show close or on: the data again each two minutes while the page stays open
  setInterval(function () { if (!document.hidden && show) load(); }, 120000);
})();
