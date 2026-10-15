// «سجل المشاهدة» (owner 2026-10-15): pages/history.njk. Everything a signed-in member watched (worker/src/watch.ts),
// grouped by day, newest first; each one can be removed, or all of it at once.
(function () {
  'use strict';
  var root = document.getElementById('hs');
  if (!root) return;
  var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
  var API = root.getAttribute('data-api') + '/watch';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var session = null;
  try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); if (s && s.token && s.member) session = s; } catch (e) {}
  var items = [], kind = '', more = false, busy = false;
  var list = $('.hs-list'), moreBtn = $('.hs-more'), bar = $('.hs-bar');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function call(q, body) {
    return fetch(API + (q || ''), { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' }).then(function (r) { return r.json(); });
  }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function group(t) {
    var today = dayStart(Date.now()), d = dayStart(t), days = Math.round((today - d) / 864e5);
    if (days === 0) return EN ? 'Today' : 'اليوم';
    if (days === 1) return EN ? 'Yesterday' : 'أمس';
    if (days < 7) return EN ? 'This week' : 'هذا الأسبوع';
    var dt = new Date(t);
    return EN ? dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }
  function kindName(k) { return k === 'recap' ? 'ملخص' : k === 'nostalgia' ? 'نوستالجيا' : 'عرض'; }
  function line(it) {
    var m = Math.round((it.watched || 0) / 60), d = Math.round((it.duration || 0) / 60);
    if (it.done) return EN ? 'Watched to the end ✓' : 'شاهدته حتى النهاية ✓';
    if (!m) return EN ? 'Started' : 'بدأت المشاهدة';
    return d ? (EN ? m + ' of ' + d + ' min' : 'شاهدت ' + m + ' من ' + d + ' دقيقة') : (EN ? m + ' min watched' : 'شاهدت ' + m + ' دقيقة');
  }
  function time(t) { var d = new Date(t), h = d.getHours(), mi = String(d.getMinutes()).padStart(2, '0'); return EN ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ((h % 12) || 12) + ':' + mi + (h < 12 ? ' ص' : ' م'); }
  function empty(title, text, link) {
    list.textContent = '';
    var e = el('div', 'hs-empty');
    e.appendChild(el('span', 'hs-empty-ic')).innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
    e.appendChild(el('b', null, title)); e.appendChild(el('p', null, text));
    if (link) { var a = el('a', 'hs-btn', link[0]); a.href = link[1]; e.appendChild(a); }
    list.appendChild(e);
  }
  function draw() {
    var shown = items.filter(function (it) { return !kind || it.kind === kind; });
    if (!items.length) { bar.hidden = true; moreBtn.hidden = true; return empty('سجلك فارغ', 'أي عرض أو ملخص أو حلقة نوستالجيا تبدأ مشاهدتها وأنت مسجل الدخول ستجدها هنا.', ['تصفح العروض', HOME + '/shows/']); }
    bar.hidden = false;
    list.textContent = '';
    if (!shown.length) { var p = el('p', 'hs-none', 'لا يوجد شيء من هذا النوع في سجلك.'); list.appendChild(p); }
    var last = '', ol = null;
    shown.forEach(function (it) {
      if (!/^\/(shows|recaps|nostalgia)\/[^\s"'<>]*$/.test(String(it.url || ''))) return;
      var g = group(it.last);
      if (g !== last) { last = g; list.appendChild(el('h2', 'hs-day', g)); ol = el('ol', 'hs-items'); list.appendChild(ol); }
      var li = el('li', 'hs-item');
      var a = el('a', 'hs-link'); a.href = HOME + it.url;
      var img = el('span', 'hs-img');
      if (it.image && /^(\/|https:\/\/)[^\s"'<>]*$/.test(it.image)) { var im = el('img'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; im.onerror = function () { this.remove(); }; img.appendChild(im); }
      if (it.duration) { var bar2 = el('i', 'hs-bar2'), fill = el('i'); fill.style.width = Math.max(4, Math.min(100, Math.round((it.watched / it.duration) * 100))) + '%'; bar2.appendChild(fill); img.appendChild(bar2); }
      a.appendChild(img);
      var tx = el('span', 'hs-tx');
      tx.appendChild(el('small', null, kindName(it.kind) + (it.fed ? ' · ' + it.fed : '')));
      tx.appendChild(el('b', null, it.title || it.url));
      tx.appendChild(el('em', it.done ? 'is-done' : null, line(it) + ' · ' + time(it.last)));
      a.appendChild(tx);
      li.appendChild(a);
      var x = el('button', 'hs-x', '×'); x.type = 'button'; x.title = 'حذف من السجل'; x.setAttribute('aria-label', 'حذف من السجل');
      x.addEventListener('click', function () {
        items = items.filter(function (y) { return y.url !== it.url; });
        try { localStorage.removeItem('arw-cw'); } catch (e) {}
        call('', { op: 'remove', url: it.url }).catch(function () {});
        draw();
      });
      li.appendChild(x);
      ol.appendChild(li);
    });
    moreBtn.hidden = !more;
  }
  function load(next) {
    if (busy) return;
    busy = true;
    var before = next && items.length ? items[items.length - 1].last : 0;
    call(before ? '?before=' + before : '').then(function (d) {
      busy = false;
      if (d.signedOut) { session = null; return start(); }
      if (!d.ok) throw new Error();
      items = next ? items.concat(d.items || []) : (d.items || []);
      more = !!d.more;
      draw();
    }).catch(function () { busy = false; if (!items.length) empty('تعذر تحميل السجل', 'تأكد من الاتصال، ثم أعد تحميل الصفحة.'); });
  }
  function start() {
    if (!session) return empty('سجل الدخول لترى سجل مشاهدتك', 'عندما تشاهد وأنت مسجل الدخول، نحفظ لك ما شاهدته لتكمل من حيث توقفت على أي جهاز. الحساب مجاني.', ['تسجيل الدخول', HOME + '/account/?back=' + encodeURIComponent(location.pathname)]);
    load(false);
  }
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]');
    if (!b) return;
    kind = b.getAttribute('data-kind');
    bar.querySelectorAll('[data-kind]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    draw();
  });
  $('.hs-clear').addEventListener('click', function () {
    var b = this;
    if (!b.classList.contains('is-sure')) {
      b.classList.add('is-sure'); b.textContent = 'اضغط مرة أخرى لمسح السجل كله';
      setTimeout(function () { b.classList.remove('is-sure'); b.textContent = 'مسح السجل'; }, 4000);
      return;
    }
    b.classList.remove('is-sure'); b.textContent = 'مسح السجل';
    items = []; more = false;
    try { localStorage.removeItem('arw-cw'); localStorage.setItem('arw-cw-n', '0'); } catch (e) {}
    call('', { op: 'clear' }).catch(function () {});
    draw();
  });
  moreBtn.addEventListener('click', function () { load(true); });
  start();
})();
