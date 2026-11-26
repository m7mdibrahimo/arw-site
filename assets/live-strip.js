/* «بث مباشر» on the home page (INCIDENTS #1537): the strip under the hero tells of the section, and of the show that is
   on now («مباشر الآن») and every coming one of the section (its countdown, in the visitor's own time). One request a visit,
   kept for two minutes in the tab; again each minute only while a show is close or on.
   A show that ended stays a day while its full show is out on the site («شاهد العرض كاملًا مترجمًا», INCIDENTS #1543),
   and the shows are turned by hand too: the arrows and the marks of the strip (owner 2026-11-26). */
(function () {
  var box = document.getElementById('lvBox'), a = document.getElementById('lvStrip');
  if (!box || !a) return;
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data', RECENT = '/live/recent.json', DONE_KEEP = 24 * 3600000;
  var navEl = document.getElementById('lvsNav'), recent = null;
  var tEl = document.getElementById('lvsT'), sEl = document.getElementById('lvsS'), tagEl = document.getElementById('lvsTag'), cdEl = document.getElementById('lvsCd'), goEl = document.getElementById('lvsGo'),
    imEl = document.getElementById('lvsIm'), dotsEl = document.getElementById('lvsDots'), fedEl = document.getElementById('lvsFed'), hEl = document.getElementById('lvsH'), mEl = document.getElementById('lvsM'), xEl = document.getElementById('lvsX'), shownImg = '';
  var skew = 0, show = null, list = [], idx = 0, TURN = 7, tz = '', zone = 'بتوقيتك', timer = null;
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
  /** The full show on the site once it is out: the owner's own link first, else the same program within a day (as assets/live.js) */
  var ALIAS = { tna: ['tna', 'impact'], roh: ['roh', 'ringofhonor'], snme: ['saturdaynightsmainevent', 'snme'] };
  function vodOf(s) {
    if (!s) return null;
    if (s.vod) return { u: s.vod };
    if (!recent || !s.p || !s.d) return null;
    var keys = ALIAS[s.p] || [s.p.replace(/-/g, '')], day = Date.parse(s.d + 'T12:00:00Z');
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i], name = String(r.p || r.t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!r.u || !r.d || Math.abs(Date.parse(r.d + 'T12:00:00Z') - day) > 36 * 3600000) continue;
      for (var j = 0; j < keys.length; j++) if (name.indexOf(keys[j]) > -1) return r;
    }
    return null;
  }
  // ended within the day, its full show out: still in the turn, now pointing at the full show
  function isDone(s, n) { return n >= s.end && n < s.end + DONE_KEEP && !!vodOf(s); }
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
  // the show's state on the strip, keeping its other marks (arrows shown, turning, paused under the mouse)
  function state(c) { box.classList.remove('is-live', 'is-soon', 'is-done'); box.classList.add(c); }
  function paint() {
    if (!show) return;
    var n = now(), v = n >= show.end ? vodOf(show) : null;
    if (n >= show.end && !v) return;
    a.href = v ? v.u : '/live/' + show.k + '/';
    // the show's own picture and its federation, once a show is known
    if (show.img) { if (shownImg !== show.img) setImg(show.img); } else plain();
    if (show.fed) { fedEl.textContent = show.fed; fedEl.hidden = false; }
    if (v) {
      state('is-done');
      tagEl.textContent = 'انتهى البث';
      tEl.textContent = 'شاهد ' + nm(show) + ' كاملًا مترجمًا';
      sEl.textContent = 'العرض كاملًا ومترجمًا متاح الآن على الموقع';
      cdEl.hidden = true; goEl.textContent = 'شاهد العرض ‹';
    } else if (n >= show.start) {
      state('is-live');
      tagEl.textContent = 'مباشر الآن';
      tEl.textContent = 'بث مباشر ' + nm(show);
      sEl.textContent = (show.n ? srv(show.n) + '\u00a0جاهزة للمشاهدة · ' : '') + 'بدأ ' + when(show.start).replace(/^(الليلة|اليوم) /, '');
      cdEl.hidden = true; goEl.textContent = 'شاهد الآن ‹';
    } else {
      var left = Math.floor((show.start - n) / 1000), d = Math.floor(left / 86400), h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      state('is-soon');
      tagEl.textContent = 'البث القادم';
      tEl.textContent = 'بث مباشر ' + nm(show);
      sEl.textContent = when(show.start) + (show.n ? ' · ' + srv(show.n) + '\u00a0جاهزة' : '');
      // a day or more away: days, hours and minutes, as the section's own cards; under a day: hours, minutes, seconds
      var far = d > 0, lab = cdEl.querySelectorAll('small');
      cdEl.hidden = false;
      hEl.textContent = far ? d : pad(h); mEl.textContent = pad(far ? h % 24 : m); xEl.textContent = pad(far ? m : s);
      lab[0].textContent = far ? 'يوم' : 'ساعة'; lab[1].textContent = far ? 'ساعة' : 'دقيقة'; lab[2].textContent = far ? 'دقيقة' : 'ثانية';
      goEl.textContent = 'صفحة البث ‹';
    }
  }
  function use(d) {
    if (!d || !d.shows) return;
    try { tz = d.geo && d.geo.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var c = d.geo && d.geo.c, name = '';
    if (c) { name = SHORT[c] || ''; if (!name) try { name = new Intl.DisplayNames(['ar'], { type: 'region' }).of(c) || ''; } catch (e) { name = ''; } }
    zone = name ? 'بتوقيت ' + name : 'بتوقيتك';
    // every show on now, then every coming one the section shows, soonest first (owner 2026-11-26: «تتاكد ان كل البثوث
    // دي ظاهرة في الرئيسية» — two days left Survivor Series out, INCIDENTS #1547): one at a time, turning to the next every
    // few seconds like a slider (owner 2026-11-25)
    var n = now(), on = [], soon = [], done = [];
    d.shows.forEach(function (s) {
      if (n >= s.start && n < s.end) on.push(s);
      else if (s.start > n) soon.push(s);
      else if (isDone(s, n)) done.push(s);
    });
    on.sort(function (x, y) { return x.start - y.start; }); soon.sort(function (x, y) { return x.start - y.start; });
    done.sort(function (x, y) { return y.end - x.end; });
    var keep = show && show.k;
    list = on.concat(soon, done).slice(0, 10);
    idx = 0; for (var i = 0; i < list.length; i++) if (list[i].k === keep) idx = i;
    show = list[idx] || null;
    list.forEach(function (s) { if (s.img) new Image().src = String(s.img).replace(/['\\()]/g, ''); });
    marks();
    // kept for the next visit: the strip shows this show from the first frame (index.njk), no other picture before it
    try { if (list[0] && n < list[0].end) localStorage.setItem('arwLiveLast', JSON.stringify({ k: list[0].k, img: list[0].img || '', title: 'بث مباشر ' + nm(list[0]), end: list[0].end })); else localStorage.removeItem('arwLiveLast'); } catch (e) {}
    if (!show) plain();
    paint();
    hold();
    clearInterval(timer);
    if (show) timer = setInterval(tick, 1000);
  }
  // the arrows and a mark per show, the one shown in red; each mark opens its show (none of it for a single show)
  function marks() {
    dotsEl.innerHTML = '';
    navEl.hidden = list.length < 2;
    box.classList.toggle('has-nav', list.length > 1);
    for (var i = 0; i < list.length && list.length > 1; i++) {
      var m = document.createElement('button');
      m.type = 'button'; m.setAttribute('aria-label', nm(list[i])); m.dataset.i = i;
      m.innerHTML = '<span class="tr"><i></i></span>';
      if (i === idx) { m.className = 'on'; m.setAttribute('aria-current', 'true'); }
      dotsEl.appendChild(m);
    }
  }
  function go(to) {
    if (list.length < 2) return;
    idx = (to + list.length) % list.length;
    box.classList.add('is-turn');
    setTimeout(function () { show = list[idx]; paint(); marks(); hold(); box.classList.remove('is-turn'); }, 200);
  }
  // RTL: «›» on the right goes back, «‹» on the left goes on
  document.getElementById('lvsPrev').addEventListener('click', function () { go(idx - 1); });
  document.getElementById('lvsNext').addEventListener('click', function () { go(idx + 1); });
  // the shown mark full: the next show (its fill runs TURN seconds, paused under the mouse; a turn by hand starts it again)
  box.style.setProperty('--lvs-turn', TURN + 's');
  dotsEl.addEventListener('animationend', function (e) { if (e.animationName === 'lvs-run' && list.length > 1) go(idx + 1); });
  dotsEl.addEventListener('click', function (e) { var t = e.target.closest('button'); if (t && +t.dataset.i !== idx) go(+t.dataset.i); });
  // while several shows take turns the strip keeps its tallest height, so the page under it never jumps
  var tallest = 0;
  function hold() {
    if (list.length < 2) { box.style.minHeight = ''; tallest = 0; return; }
    // each show is laid out once, unseen, to find the tallest before the first turn
    if (!tallest) { box.style.minHeight = ''; var cur = show; list.forEach(function (s) { show = s; paint(); tallest = Math.max(tallest, box.offsetHeight); }); show = cur; paint(); }
    box.style.minHeight = tallest + 'px';
  }
  window.addEventListener('resize', function () { tallest = 0; hold(); });
  // measured again once the site's font is in (the text takes more room in it)
  try { document.fonts.ready.then(function () { tallest = 0; hold(); }); } catch (e) {}
  function tick() {
    // a show that ended leaves the turn, unless its full show is out (then a day after it ends)
    var n = now(), gone = function (s) { return n >= s.end && !isDone(s, n); };
    if (list.some(gone)) { list = list.filter(function (s) { return !gone(s); }); if (idx >= list.length) idx = 0; show = list[idx] || null; marks(); if (!show) { plain(); return; } }
    paint();
  }
  box.addEventListener('mouseenter', function () { box.classList.add('is-paused'); });
  box.addEventListener('mouseleave', function () { box.classList.remove('is-paused'); });
  // dragged by the mouse or the finger, left or right, turns the shows like the spotlight above it (owner 2026-11-26:
  // «اتنقل بين البثوث بالشد بالماوس او بالتاتش يمين او شمال شبه الهيدر»): the same direction as the spotlight, the text
  // follows the hand a little, a page scroll stays a scroll, and a drag never opens the page
  var px = 0, py = 0, dx = 0, down = false, horiz = false, vert = false, blocked = false;
  var moving = [document.querySelector('.lvs-tx > a'), sEl, imEl];
  function follow(v) { moving.forEach(function (el) { if (el) el.style.transform = v ? 'translateX(' + v + 'px)' : ''; }); }
  box.addEventListener('dragstart', function (e) { e.preventDefault(); });
  box.addEventListener('pointerdown', function (e) {
    if ((e.button !== undefined && e.button !== 0) || list.length < 2 || e.target.closest('.lvs-nav')) return;
    down = true; horiz = vert = blocked = false; px = e.clientX; py = e.clientY; dx = 0;
    box.classList.add('is-paused');
  });
  box.addEventListener('pointermove', function (e) {
    if (!down) return;
    dx = e.clientX - px; var dy = e.clientY - py, ax = Math.abs(dx), ay = Math.abs(dy);
    if (!horiz && !vert) {
      if (ay > 7 && ay >= ax) { vert = blocked = true; return; }
      if (ax > 10 && ax > ay) {
        horiz = blocked = true; box.classList.add('is-dragging');
        try { box.setPointerCapture(e.pointerId); } catch (x) {}
      }
    }
    if (horiz) follow(Math.max(-60, Math.min(60, dx * 0.35)));
  });
  function up(e) {
    if (!down) return;
    down = false;
    box.classList.remove('is-dragging');
    try { if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId); } catch (x) {}
    // a mouse still over the strip keeps it paused; a finger lifted lets it carry on
    if (!(e.pointerType === 'mouse' && box.matches(':hover'))) box.classList.remove('is-paused');
    follow(0);
    if (horiz && Math.abs(dx) > 25) go(idx + (dx > 0 ? -1 : 1));
    if (blocked || Math.abs(dx) > 8) setTimeout(function () { blocked = false; dx = 0; }, 150);
  }
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  a.addEventListener('click', function (e) { if (blocked || Math.abs(dx) > 8) { e.preventDefault(); e.stopPropagation(); } });
  function load() {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('arwLiveStrip') || 'null'); } catch (e) { cached = null; }
    if (cached && Date.now() - cached.at < 120000) { skew = cached.skew; recent = cached.r || null; return use(cached.d); }
    var x = new XMLHttpRequest(), sent = Date.now();
    x.open('GET', API, true);
    x.timeout = 10000;
    x.onload = function () {
      try {
        var d = JSON.parse(x.responseText), got = Date.now();
        if (d.t) skew = d.t + (got - sent) / 2 - got;
        var keep = function () { try { sessionStorage.setItem('arwLiveStrip', JSON.stringify({ at: got, skew: skew, d: d, r: recent })); } catch (e) {} use(d); };
        // the site's own list of full shows (a static file), asked only when a show ended within the day
        var n = got + skew;
        if (!(d.shows || []).some(function (s) { return n >= s.end && n < s.end + DONE_KEEP && !s.vod; })) return keep();
        var y = new XMLHttpRequest();
        y.open('GET', RECENT + '?v=' + Math.floor(got / 120000), true);
        y.timeout = 8000;
        y.onload = function () { try { recent = JSON.parse(y.responseText); } catch (e) { recent = null; } keep(); };
        y.onerror = y.ontimeout = function () { keep(); };
        y.send();
      } catch (e) {}
    };
    x.send();
  }
  load();
  // a show close or on: the data again each two minutes while the page stays open
  setInterval(function () { var n = now(); if (!document.hidden && list.some(function (s) { return n < s.end; })) load(); }, 120000);
})();
