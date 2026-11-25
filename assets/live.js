/* «بث مباشر» (INCIDENTS #1535, #1537): the section's cards, a program's page and a show's page — the ring and its
   countdown, the bell, then the servers playing right here like a show's own servers. Data: arw-site-bot /live/data
   (worker/src/live.ts), with the visitor's country and time zone from their address and the exact time of the answer. */
(function () {
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data';
  var RECENT = '/live/recent.json';
  var root = document.getElementById('lvRoot');
  if (!root) return;
  var key = root.getAttribute('data-key') || '';
  var prog = root.getAttribute('data-prog') || '';
  if (!key && !prog) { var m = location.pathname.match(/^\/live\/([a-z0-9-]+)\/?$/); if (m) key = m[1]; }
  var isShow = !!(key || prog);
  var HT = prog ? 'h2' : 'h1'; // a program's page has its own heading above
  // a show's address served by the section's page (site-worker/fast.js, before the show's own page is built)
  if (isShow && !document.getElementById('lvShow')) root.innerHTML = '<div id="lvShow"></div><section class="lv-more" id="lvMore"></section>';

  var skew = 0, data = null, recent = null, poll = null, rang = false, mode = '', built = '', sig = '', current = '', redirectT = null;
  var BELL = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a1 1 0 0 1 1 1v1.07A7 7 0 0 1 19 11v4.6l1.7 2.55A1.2 1.2 0 0 1 19.7 20H4.3a1.2 1.2 0 0 1-1-1.85L5 15.6V11a7 7 0 0 1 6-6.93V3a1 1 0 0 1 1-1Zm-2.5 19h5a2.5 2.5 0 0 1-5 0Z"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12.1-7.4a1 1 0 0 0 0-1.7L8.52 3.75A1 1 0 0 0 7 4.6Z"/></svg>';
  var FS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var RL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';
  var DAYS = { Sun: 'الأحد', Mon: 'الاثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت' };
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  // short names people use; the rest from the browser's own Arabic list of countries
  var SHORT = { SA: 'السعودية', AE: 'الإمارات', US: 'أمريكا', GB: 'بريطانيا', PS: 'فلسطين', SY: 'سوريا', KR: 'كوريا الجنوبية', NL: 'هولندا' };
  // countries with more than one time: the zone's own Arabic name says which
  var MULTI = /^(US|CA|RU|AU|BR|MX|ID|KZ|CD|MN|CL|ES|PT|NZ|EC|GL|KI|FM|PF|UM)$/;

  function now() { return Date.now() + skew; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(ms) { ms = Math.max(0, ms); var s = Math.floor(ms / 1000); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 }; }

  // ── the visitor's time: their country's zone from their address, else this device's ──
  var TZ = '', ZONE = 'بتوقيتك';
  function deviceTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function setZone(geo) {
    var tz = geo && geo.tz || deviceTz(), c = geo && geo.c || '';
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { tz = deviceTz(); }
    TZ = tz;
    var name = '';
    if (c && SHORT[c]) name = SHORT[c];
    else if (c) { try { name = new Intl.DisplayNames(['ar'], { type: 'region' }).of(c) || ''; } catch (e) { name = ''; } }
    if (name && c && MULTI.test(c)) {
      var z = '';
      try { var ps = new Intl.DateTimeFormat('ar', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()); for (var i = 0; i < ps.length; i++) if (ps[i].type === 'timeZoneName') z = ps[i].value; } catch (e) { z = ''; }
      ZONE = z && !/GMT|غرينتش|UTC/.test(z) ? 'حسب ' + z.replace(/^توقيت/, 'توقيت') : 'بتوقيت ' + name;
    } else ZONE = name ? 'بتوقيت ' + name : 'بتوقيتك';
  }
  var fmtCache = {};
  function zp(ts) {
    var f = fmtCache[TZ];
    if (!f) { try { f = fmtCache[TZ] = new Intl.DateTimeFormat('en-US', { timeZone: TZ || undefined, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); } catch (e) { f = fmtCache[TZ] = new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); } }
    var o = {}, ps = f.formatToParts(new Date(ts));
    for (var i = 0; i < ps.length; i++) o[ps[i].type] = ps[i].value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, wd: o.weekday };
  }
  function period(h) { return h < 3 ? 'بعد منتصف الليل' : h < 5 ? 'فجرًا' : h < 12 ? 'صباحًا' : h < 15 ? 'ظهرًا' : h < 18 ? 'عصرًا' : 'مساءً'; }
  function clock(ts) { var p = zp(ts); return (p.h % 12 || 12) + ':' + pad(p.mi) + ' ' + period(p.h); }
  function dayNo(p) { return Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 86400000); }
  /** «الليلة» for this evening and the small hours after it, «اليوم» for earlier today, never «tomorrow»: the day by name (owner 2026-11-25) */
  function dayWord(ts) {
    var p = zp(ts), t = zp(now()), diff = dayNo(p) - dayNo(t);
    if (diff === 0 && (p.h >= 17 || p.h < 6)) return 'الليلة';
    if (diff === 0) return 'اليوم';
    if (diff === 1 && p.h < 6 && t.h >= 6) return 'الليلة';
    var name = (DAYS[p.wd] || '') + ' ' + p.d + ' ' + MONTHS[p.mo - 1];
    return (p.h < 6 ? 'فجر ' : '') + name;
  }
  function when(ts) { return dayWord(ts) + ' · ' + clock(ts) + ' ' + ZONE; }

  function status(s) { var n = now(); return n >= s.end ? 'ended' : n >= s.start ? 'live' : 'soon'; }
  function img(s) { return s && s.img ? s.img : '/assets/hero-bg.jpg'; }
  function srcText(n) { return n > 2 ? n + ' مصادر' : n === 2 ? 'مصدران' : 'مصدر واحد'; }
  function svText(n) { return n > 10 ? n + ' سيرفرًا' : n > 2 ? n + ' سيرفرات' : n === 2 ? 'سيرفران' : 'سيرفر واحد'; }

  function load(cb) {
    var x = new XMLHttpRequest(), sent = Date.now();
    x.open('GET', API + '?t=' + Math.floor(Date.now() / 20000), true);
    x.timeout = 12000;
    x.onload = function () {
      try {
        var d = JSON.parse(x.responseText), got = Date.now();
        // the answer's own time, half the way back added: this device's clock may be minutes off, the countdown never is
        if (d.t) skew = d.t + (got - sent) / 2 - got;
        if (!TZ || d.geo) setZone(d.geo);
        data = d; cb && cb(d);
      } catch (e) { cb && cb(null); }
    };
    x.onerror = x.ontimeout = function () { if (!TZ) setZone(null); cb && cb(null); };
    x.send();
  }
  function loadRecent(cb) {
    if (recent) return cb();
    var x = new XMLHttpRequest();
    x.open('GET', RECENT + '?v=' + Math.floor(Date.now() / 120000), true);
    x.onload = function () { try { recent = JSON.parse(x.responseText); } catch (e) { recent = []; } cb(); };
    x.onerror = function () { recent = []; cb(); };
    x.send();
  }
  /** The full show on the site, once it is published: the owner's own link first, else the same program within a day */
  var ALIAS = { tna: ['tna', 'impact'], roh: ['roh', 'ringofhonor'], snme: ['saturdaynightsmainevent', 'snme'] };
  function vodOf(s) {
    if (!s) return null;
    if (s.vod) return { u: s.vod, t: s.t, img: s.img };
    if (!recent || !s.p || !s.d) return null;
    var keys = ALIAS[s.p] || [s.p.replace(/-/g, '')], day = Date.parse(s.d + 'T12:00:00Z');
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i], name = String(r.p || r.t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!r.d || Math.abs(Date.parse(r.d + 'T12:00:00Z') - day) > 36 * 3600000) continue;
      for (var j = 0; j < keys.length; j++) if (name.indexOf(keys[j]) > -1) return r;
    }
    return null;
  }

  // ── cards (the section, and «عروض أخرى» under a show) ──
  // the show's name as the owner wants it written (2026-11-25): «عرض داينامايت», and its English name beside it for
  // those who search in English («AEW Dynamite Live»)
  function nm(s) { var t = (s && s.t) || ''; return !t || /^عرض\s/.test(t) ? t : 'عرض ' + t; }
  function bare(t) { return String(t || '').replace(/^عرض\s+/, ''); }
  function enLine(s) { return s && s.en ? '<span class="lv-en" lang="en" dir="ltr">' + esc(s.en) + ' Live</span>' : ''; }
  function card(s) {
    var st = status(s), p = parts(s.start - now()), v = st === 'ended' ? vodOf(s) : null;
    var top = st === 'live' ? '<span class="tagl"><i></i>مباشر الآن</span>' : v ? '<span class="tagl v">نُشر كاملًا</span>' :
      st === 'ended' ? '<span class="tagl e">انتهى البث</span>' :
      '<div class="cd" data-start="' + s.start + '">' + (p.d ? '<b>' + p.d + '<small>يوم</small></b>' : '') + '<b>' + pad(p.h) + '<small>ساعة</small></b><b>' + pad(p.m) + '<small>دقيقة</small></b>' + (p.d ? '' : '<b>' + pad(p.s) + '<small>ثانية</small></b>') + '</div>';
    var line = st === 'live' ? 'بدأ ' + clock(s.start) + ' ' + ZONE : st === 'ended' ? (v ? 'شاهد العرض كاملًا على الموقع' : 'يُنشر العرض كاملًا على الموقع قريبًا') : 'يدقّ الجرس ' + when(s.start);
    var pill = st === 'live' ? '<span class="lv-pill c">' + (s.n ? svText(s.n) + ' · ' : '') + 'ادخل البث</span>' : v ? '<span class="lv-pill">شاهد الآن</span>' : st === 'ended' ? '' :
      s.n ? '<span class="lv-pill">' + svText(s.n) + ' جاهزة</span>' : '<span class="lv-pill g">بانتظار السيرفرات</span>';
    var href = v ? v.u : '/live/' + s.k + '/';
    return '<a class="lv-card' + (st === 'live' ? ' is-live' : '') + '" href="' + esc(href) + '"><div class="im" style="background-image:url(\'' + esc(img(s)) + '\')"><span class="fed">' + esc(s.fed) + '</span>' + top + '</div><div class="bd"><h3>' + esc(nm(s)) + '</h3>' + enLine(s) + '<p>' + line + '</p><div class="ft">' + pill + (s.srcs ? '<small class="lv-src-n">' + srcText(s.srcs) + '</small>' : '') + '</div></div></a>';
  }
  function listShows() {
    var shows = (data && data.shows || []).filter(function (s) { var st = status(s); return st !== 'ended' || vodOf(s); });
    shows.sort(function (a, b) { var o = { live: 0, soon: 1, ended: 2 }; return o[status(a)] - o[status(b)] || a.start - b.start; });
    return shows;
  }
  function renderList() {
    var box = document.getElementById('lvList');
    if (!box) return;
    var shows = listShows();
    box.innerHTML = shows.length ? '<div class="lv-grid">' + shows.map(card).join('') + '</div>' :
      '<div class="lv-empty"><b>لا يوجد عرض قادم الآن</b>يظهر هنا كل عرض فور الإعلان عن بثه المباشر: عدّاد حتى لحظة البداية، ثم سيرفرات المشاهدة تعمل داخل الموقع.<a href="/shows/">شاهد أحدث العروض كاملة</a></div>';
    var z = document.getElementById('lvZone'); if (z) z.textContent = 'كل المواعيد ' + ZONE;
  }

  // ── a show ──
  function show() {
    var all = data && data.shows || [];
    if (key) return all.filter(function (s) { return s.k === key; })[0] || null;
    // a program's page: the show on now, else the next, else the last one (six hours after its end)
    var mine = all.filter(function (s) { return s.p === prog; });
    var on = mine.filter(function (s) { return status(s) === 'live'; })[0];
    var next = mine.filter(function (s) { return status(s) === 'soon'; }).sort(function (a, b) { return a.start - b.start; })[0];
    return on || next || mine.sort(function (a, b) { return b.start - a.start; })[0] || null;
  }
  function base() {
    var s = show();
    if (s) return s;
    var a = root.getAttribute('data-start');
    if (!key || !a) return null;
    return { k: key, t: root.getAttribute('data-title') || '', fed: root.getAttribute('data-fed') || '', start: Date.parse(a), end: Date.parse(root.getAttribute('data-end') || a), img: root.getAttribute('data-img') || '', en: root.getAttribute('data-en') || '', srcs: 0, n: 0, sv: [], pending: 1 };
  }
  function stageHtml(s) {
    return '<div class="lv-stage" id="lvStage"><div class="bgimg" style="background-image:url(\'' + esc(img(s)) + '\')"></div>' +
      '<div class="lv-top"><div><' + HT + '>بث مباشر ' + esc(nm(s)) + '</' + HT + '>' + enLine(s) + '<p id="lvWhen">' + esc(when(s.start)) + '</p></div><span class="fed">' + esc(s.fed) + '</span></div>' +
      '<div class="lv-ring"><div class="post p1"></div><div class="post p2"></div><div class="mat"></div><div class="rope r1"></div><div class="rope r2"></div>' +
      '<div class="lv-digits" role="timer" aria-label="الوقت المتبقي على بداية العرض"><div class="lv-d"><b id="lvD">00</b><small>يوم</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvH">00</b><small>ساعة</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvM">00</b><small>دقيقة</small></div><div class="lv-sep">:</div><div class="lv-d"><b id="lvS">00</b><small>ثانية</small></div></div>' +
      '<div class="lv-tension"><div class="t"><i id="lvT"></i></div><div class="lab"><span>آخر 24 ساعة قبل العرض</span><span>الحبال تشتدّ كلما اقترب الجرس</span><span id="lvClock">' + esc(clock(s.start)) + '</span></div></div></div>' +
      '<div class="lv-chips"><span>' + BELL + ' يدقّ الجرس <b id="lvBellAt">' + esc(dayWord(s.start) + ' ' + clock(s.start)) + '</b> <em id="lvZoneC">' + esc(ZONE) + '</em></span><span id="lvReady">' + readyText(s) + '</span></div>' +
      '<div class="lv-bell" id="lvBell"><div>' + BELL + '<b>دقّ الجرس!</b></div></div></div>';
  }
  function readyText(s) { return s.n ? svText(s.n) + ' جاهزة للمشاهدة أدناه' + (s.srcs > 1 ? ' من ' + (s.srcs === 2 ? 'مصدرين' : srcText(s.srcs)) : '') : s.pending ? 'جارٍ تحميل سيرفرات المشاهدة…' : 'سيرفرات المشاهدة تُضاف هنا فور نشرها'; }
  function onAirHtml(s) {
    return '<div class="lv-onair"><div class="b">' + BELL + '</div><div><' + HT + '>بث مباشر ' + esc(nm(s)) + '</' + HT + '>' + enLine(s) + '<p>دقّ الجرس — العرض مباشر الآن · بدأ ' + esc(clock(s.start)) + ' ' + esc(ZONE) + '</p></div><div class="lv-el"><b id="lvE">00:00:00</b><small>منذ بداية العرض</small></div></div>';
  }
  // the servers: like a show's own page — the list on one side, the player on the other, nothing opens elsewhere
  function deckHtml(s, st) {
    // only what plays inside the page (owner 2026-11-25): a link that opens elsewhere is never listed, even from old data
    var sv = (s.sv || []).filter(function (v) { return !v.x; });
    var list = sv.map(function (v, i) {
      var q = v.q ? '<span class="lv-q ' + esc(v.q) + '">' + esc(v.q) + '</span>' : '';
      return '<button type="button" class="lv-srv' + (v.u === current ? ' active' : '') + '" data-play="' + esc(v.u) + '" data-n="' + (i + 1) + '" role="tab"><span class="n">' + (i + 1) + '</span><span class="nm"><b>سيرفر ' + (i + 1) + '</b><small>' + (v.m ? 'من عرب راسلنج' : 'يعمل داخل الصفحة') + '</small></span>' + q + '<span class="on">يعمل الآن</span></button>';
    }).join('');
    var poster = '<button type="button" class="lv-poster" id="lvPoster" aria-label="تشغيل البث"><img src="' + esc(img(s)) + '" alt="" decoding="async"><span class="pl">' + PLAY + '</span><span class="cap">' +
      (st === 'soon' ? 'يبدأ البث ' + esc(when(s.start)) + '<small>السيرفرات جاهزة: جرّبها الآن واختر الأفضل لك قبل البداية</small>' : 'اضغط للمشاهدة المباشرة') + '</span></button>';
    var screen = sv.length ? poster : '<div class="lv-nosrv">' + (s.pending ? 'جارٍ تحميل سيرفرات المشاهدة…' : 'سيرفرات المشاهدة تُضاف هنا فور نشرها، والصفحة تتحدّث وحدها كل دقيقة') + '</div>';
    return '<section class="lv-deck' + (sv.length < 2 ? ' is-single' : '') + '" id="lvDeck" aria-label="المشاهدة المباشرة">' +
      '<div class="lv-dh"><h2><i></i>المشاهدة المباشرة' + (sv.length ? ' <small>' + svText(sv.length) + '</small>' : '') + '</h2><div class="lv-acts"><button type="button" id="lvFs" title="ملء الشاشة">' + FS + '<span>ملء الشاشة</span></button><button type="button" id="lvReload" title="إعادة تشغيل المشغل">' + RL + '<span>تحديث المشغل</span></button></div></div>' +
      (s.note ? '<p class="lv-own-note">' + esc(s.note) + '</p>' : '') +
      '<div class="lv-db">' + (sv.length ? '<div class="lv-side"><div class="lv-list" role="tablist" aria-label="سيرفرات المشاهدة">' + list + '</div></div>' : '') +
      '<div class="lv-screen" id="lvScreen">' + screen + '</div></div>' +
      '<p class="lv-tip">' + (sv.length > 1 ? 'إذا توقّف البث أو تأخّر فاختر سيرفرًا آخر من القائمة؛ السيرفرات الجديدة تظهر هنا وحدها خلال دقيقة.' : 'السيرفرات الجديدة تظهر هنا وحدها خلال دقيقة، دون إعادة تحميل الصفحة.') + '</p></section>';
  }
  function vodHtml(v, s, ended) {
    return '<a class="lv-vod" href="' + esc(v.u) + '"><span class="im" style="background-image:url(\'' + esc(v.img || img(s)) + '\')"><span class="pl">' + PLAY + '</span></span><span class="tx"><small>' + (ended ? 'انتهى البث المباشر' : 'متاح الآن على الموقع') + '</small><b>نُشر العرض كاملًا: ' + esc(v.t || s.t) + '</b><em>شاهد العرض كاملًا بجودة عالية وسيرفرات متعددة' + (ended ? '<span id="lvGo"></span>' : '') + '</em></span><span class="go">شاهد الآن</span></a>';
  }
  function endedHtml(s) {
    var v = vodOf(s);
    if (v) return vodHtml(v, s, true) + '<button type="button" class="lv-stay" id="lvStay">البقاء في هذه الصفحة</button>';
    return '<div class="lv-ended"><b>انتهى البث المباشر' + (s.t ? ' لعرض ' + esc(bare(s.t)) : '') + '</b><p>يُنشر العرض كاملًا على الموقع فور جاهزيته، وتنقلك هذه الصفحة إليه تلقائيًا عند نشره.</p><a href="/shows/">شاهد أحدث العروض كاملة</a></div>';
  }
  function emptyProgHtml() {
    var t = root.getAttribute('data-title') || '';
    return '<div class="lv-ended"><b>لا يوجد بث قادم لعرض ' + esc(bare(t)) + ' الآن</b><p>تظهر هنا صفحة البث المباشر للحلقة القادمة فور الإعلان عنها: عدّاد حتى لحظة البداية، ثم سيرفرات المشاهدة داخل الموقع.</p><a href="/live/">كل عروض البث المباشر</a></div>';
  }
  function moreHtml(s) {
    var others = listShows().filter(function (x) { return !s || x.k !== s.k; }).slice(0, 3);
    // full rows only (owner 2026-11-25): four shows — one row of four on a computer, two of two on a phone
    var rec = (recent || []).filter(function (r) { var v = s && vodOf(s); return !v || v.u !== r.u; }).slice(0, 4);
    var h = '';
    if (others.length) h += '<div class="lv-mh"><h2><i class="dot"></i>عروض أخرى في البث المباشر</h2><a href="/live/">كل البث المباشر ←</a></div><div class="lv-grid sm">' + others.map(card).join('') + '</div>';
    if (rec.length) h += '<div class="lv-mh"><h2>أحدث العروض كاملة على الموقع</h2><a href="/shows/">كل العروض ←</a></div><div class="lv-rec">' + rec.map(function (r) {
      return '<a href="' + esc(r.u) + '"><span class="im" style="background-image:url(\'' + esc(r.img || '/assets/hero-bg.jpg') + '\')"><span class="pl">' + PLAY + '</span></span><b>' + esc(r.t) + '</b></a>';
    }).join('') + '</div>';
    if (!h) h = '<div class="lv-mh"><h2>تابع البث المباشر</h2><a href="/live/">كل البث المباشر ←</a></div>';
    return h;
  }
  function paintMore(s) { var m = document.getElementById('lvMore'); if (m) { var h = moreHtml(s); if (m.getAttribute('data-h') !== h) { m.innerHTML = h; m.setAttribute('data-h', h); } } }

  function paint() {
    var s = base(), box = document.getElementById('lvShow');
    if (!box) return;
    if (!s) { if (data) { box.innerHTML = key ? endedHtml({ t: root.getAttribute('data-title') || '' }) : emptyProgHtml(); mode = 'none'; } paintMore(null); return; }
    var st = status(s);
    if (s.t && document.title.indexOf(nm(s)) < 0 && key) document.title = 'بث مباشر ' + nm(s) + (s.en ? ' | ' + s.en + ' Live' : '') + ' | عرب راسلنج';
    var svSig = JSON.stringify([s.sv, s.note, s.t, s.img, ZONE, s.pending ? 1 : 0]);
    if (st === 'soon') {
      if (mode !== 'soon' || built !== s.k + s.start) { box.innerHTML = stageHtml(s) + '<div id="lvDeckBox">' + deckHtml(s, st) + '</div>'; mode = 'soon'; built = s.k + s.start; sig = svSig; prev = {}; }
      else if (sig !== svSig) { swapDeck(s, st); sig = svSig; var r = document.getElementById('lvReady'); if (r) r.innerHTML = readyText(s); }
      var put = function (id, v) { var el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
      put('lvWhen', when(s.start)); put('lvBellAt', dayWord(s.start) + ' ' + clock(s.start)); put('lvZoneC', ZONE); put('lvClock', clock(s.start));
    } else if (st === 'live') {
      if (mode === 'soon' && !rang) { rang = true; ring(function () { mode = ''; paint(); }); return; }
      if (mode !== 'live' || built !== s.k) { box.innerHTML = '<div class="lv-live">' + onAirHtml(s) + '</div><div id="lvDeckBox">' + deckHtml(s, st) + '</div>'; mode = 'live'; built = s.k; sig = svSig; keepPlayer(); }
      else if (sig !== svSig) { swapDeck(s, st); sig = svSig; }
    } else {
      var v = vodOf(s), es = 'ended' + (v ? v.u : '');
      if (mode !== es) {
        box.innerHTML = endedHtml(s); mode = es;
        // the full show is out: there in eight seconds unless the visitor stays
        if (v && key) { var left = 8, g = document.getElementById('lvGo'); clearInterval(redirectT); redirectT = setInterval(function () { left--; if (g) g.textContent = ' — ننقلك إليه خلال ' + left + ' ثوانٍ'; if (left <= 0) { clearInterval(redirectT); location.href = v.u; } }, 1000); }
      }
    }
    tick();
    paintMore(s);
  }
  // a new server list without stopping what plays
  function swapDeck(s, st) {
    var holder = document.getElementById('lvDeckBox'); if (!holder) return;
    var scr = document.getElementById('lvScreen'), playing = scr && scr.querySelector('iframe');
    holder.innerHTML = deckHtml(s, st);
    if (playing) { var n = document.getElementById('lvScreen'); n.innerHTML = ''; n.appendChild(playing); document.getElementById('lvDeck').classList.add('is-on'); }
  }
  var keptFrame = null;
  function keepPlayer() { if (keptFrame) { var n = document.getElementById('lvScreen'); if (n) { n.innerHTML = ''; n.appendChild(keptFrame); document.getElementById('lvDeck').classList.add('is-on'); } } }
  function play(u) {
    var scr = document.getElementById('lvScreen'); if (!scr || !u) return;
    current = u;
    var f = document.createElement('iframe');
    f.src = u; f.allowFullscreen = true; f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture'); f.setAttribute('scrolling', 'no'); f.title = 'البث المباشر';
    scr.innerHTML = '<div class="lv-loading"><i></i>جارٍ الاتصال بالسيرفر…</div>'; scr.appendChild(f);
    f.onload = function () { var l = scr.querySelector('.lv-loading'); if (l) l.remove(); };
    keptFrame = f;
    var d = document.getElementById('lvDeck'); if (d) d.classList.add('is-on');
    var bs = document.querySelectorAll('.lv-srv[data-play]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-play') === u);
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
      if (left <= 0) { if (isShow) paintMore(base()); else renderList(); return; }
      var p = parts(left), bs = cds[i].querySelectorAll('b');
      var vals = p.d ? [p.d, pad(p.h), pad(p.m)] : [pad(p.h), pad(p.m), pad(p.s)];
      for (var j = 0; j < bs.length && j < vals.length; j++) bs[j].firstChild.nodeValue = vals[j];
    }
  }
  // how often to ask again: every minute while a show is near, on or just over (its full show may come), else every ten
  function schedule() {
    clearTimeout(poll);
    var s = isShow ? base() : null, n = now(), wait = 600000;
    var list = isShow ? (s ? [s] : []) : (data && data.shows || []);
    list.forEach(function (x) {
      if (n >= x.start - 60 * 60000 && n < x.end + 6 * 3600000) wait = Math.min(wait, 60000);
      else if (x.start > n) wait = Math.min(wait, Math.max(5000, x.start - 60 * 60000 - n + 2000));
    });
    poll = setTimeout(refresh, wait);
  }
  function refresh() {
    if (document.hidden) return schedule();
    load(function () {
      var s = isShow ? base() : null;
      // a show over: the site's newest shows again (the full show may have just been published)
      if (s && status(s) === 'ended' && !vodOf(s)) recent = null;
      loadRecent(function () { isShow ? paint() : renderList(); schedule(); });
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b = t.closest('[data-play]');
    if (b) { play(b.getAttribute('data-play')); return; }
    if (t.closest('#lvPoster')) { var first = document.querySelector('.lv-srv[data-play]'); if (first) play(first.getAttribute('data-play')); return; }
    if (t.closest('#lvReload')) { if (current) play(current); return; }
    if (t.closest('#lvFs')) { var sc = document.getElementById('lvScreen'); if (sc) { var f = sc.requestFullscreen || sc.webkitRequestFullscreen; if (f) f.call(sc); } return; }
    if (t.closest('#lvStay')) { clearInterval(redirectT); var g = document.getElementById('lvGo'); if (g) g.textContent = ''; t.closest('#lvStay').remove(); }
  });

  if (isShow) { setZone(null); paint(); load(function () { loadRecent(function () { paint(); schedule(); }); }); setInterval(function () { tick(); tickList(); }, 1000); }
  else { setZone(null); load(function () { loadRecent(function () { renderList(); schedule(); }); }); setInterval(tickList, 1000); }
})();
