/* «بث مباشر» on the home page (INCIDENTS #1537): the strip under the hero tells of the section, and of the show that is
   on now («مباشر الآن») or the next one within two days (its countdown, in the visitor's own time). One request a visit,
   kept for two minutes in the tab; again each minute only while a show is close or on. */
(function () {
  var a = document.getElementById('lvStrip');
  if (!a) return;
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data';
  var tEl = document.getElementById('lvsT'), sEl = document.getElementById('lvsS'), tagEl = document.getElementById('lvsTag'), cdEl = document.getElementById('lvsCd'), goEl = document.getElementById('lvsGo'),
    imEl = document.getElementById('lvsIm'), fedEl = document.getElementById('lvsFed'), hEl = document.getElementById('lvsH'), mEl = document.getElementById('lvsM'), xEl = document.getElementById('lvsX'), shownImg = '';
  var skew = 0, show = null, tz = '', zone = 'بتوقيتك', timer = null;
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
  function paint() {
    if (!show) return;
    var n = now();
    if (n >= show.end) { show = null; return; }
    a.href = '/live/' + show.k + '/';
    // the show's own picture and its federation, once a show is known
    if (show.img && shownImg !== show.img) { shownImg = show.img; imEl.style.backgroundImage = "url('" + String(show.img).replace(/['\\()]/g, '') + "')"; }
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
    var n = now(), live = null, next = null;
    d.shows.forEach(function (s) {
      if (n >= s.start && n < s.end) { if (!live) live = s; }
      else if (s.start > n && s.start - n < 48 * 3600000 && (!next || s.start < next.start)) next = s;
    });
    show = live || next;
    paint();
    clearInterval(timer);
    if (show) timer = setInterval(paint, 1000);
  }
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
