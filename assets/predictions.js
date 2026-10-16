// «توقعات العروض الكبرى وترتيب أفضل المتوقعين» (owner 2026-10-15): pages/predictions.njk. The cards, the picks and the
// rankings come from the worker (worker/src/predict.ts); a pick is saved the moment it's chosen, until the show starts.
// The look (owner 2026-10-16: «منظم اكتر والصور تكون باينة فيه كاملة وتتاقلم علي ابعادةها»، «كفاية الاسم بتاع
// المصارعيين»): each poster whole, at its own shape (an upright poster beside its match, a wide one above it on a phone),
// the names alone on the buttons; and the show's prize, a month of the paid membership for the top of its ranking.
// (INCIDENTS #612: a new version name after the deploy that cached the old file under the new one)
(function () {
  'use strict';
  var root = document.getElementById('pd');
  if (!root) return;
  var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
  var API = root.getAttribute('data-api') + '/predict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var session = null;
  try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); if (s && s.token && s.member) session = s; } catch (e) {}
  var data = null, timer = null;
  var SAFE = /^(\/|https:\/\/)[^\s"'<>]*$/;
  function srv(t) { if (!t) return ''; if (!EN) return t; return (window.arwMsg && window.arwMsg(t)) || ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function toast(t) {
    var old = $('.pd-toast'); if (old) old.remove();
    var x = el('div', 'pd-toast', t); x.setAttribute('role', 'status'); document.body.appendChild(x);
    requestAnimationFrame(function () { x.classList.add('is-on'); });
    setTimeout(function () { x.classList.remove('is-on'); setTimeout(function () { x.remove(); }, 300); }, 3500);
  }
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function when(ms) {
    var d = new Date(ms);
    if (EN) return d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + '، الساعة ' + ((h % 12) || 12) + ':' + m + (h < 12 ? ' صباحا' : ' مساء');
  }
  // Arabic counted the way it's said: دقيقة واحدة، دقيقتان، 3 دقائق، 11 دقيقة
  function ar(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many; }
  function pts(n) { return EN ? (n === 1 ? '1 point' : n + ' points') : n === 1 ? 'نقطة' : n === 2 ? 'نقطتان' : ar(n, 'نقطة', 'نقطتان', 'نقاط', 'نقطة'); }
  var I = {
    trophy: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    crown: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  function avatar(p, cls) {
    var a = el('span', 'pd-av' + (cls ? ' ' + cls : '')), pic = String(p.pic || ''), src = '';
    if (pic === 'official') src = EN ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png';
    else if (/^w:[a-z0-9-]+$/.test(pic)) src = '/avatars/' + pic.slice(2) + '.webp';
    else if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/(comments\/pic\/\d+\.webp|members\/pic\/\d+\/[a-f0-9]{16}\.(webp|jpg|png))$/.test(pic)) src = pic;
    if (src) { var i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; a.appendChild(i); }
    else a.textContent = (String(p.name || '?').trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase();
    if (p.prem) a.classList.add('is-prem');
    return a;
  }
  var BLUE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.82 2.42 13.53 1.5 12 1.5s-2.82.92-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.97 3.48-.03.17-.04.35-.04.52 0 2.21 1.71 4 3.82 4 .47 0 .92-.08 1.34-.25.6 1.33 1.89 2.25 3.42 2.25s2.82-.92 3.42-2.25c.42.17.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.17-.01-.35-.04-.52 1.17-.68 1.97-1.98 1.97-3.48z"/><path fill="#fff" d="M10.1 16.3 6.6 12.8l1.4-1.4 2.1 2.1 5-5 1.4 1.4z"/></svg>';
  var GOLD = BLUE.replace('#1d9bf0', '#e09a12');
  function nameLine(p) {
    var nm = el('b'); nm.appendChild(el('span', null, p.name));
    if (p.gold || p.blue) { var bg = el('span', 'pd-badge'); bg.innerHTML = p.gold ? GOLD : BLUE; nm.appendChild(bg); }
    return nm;
  }
  function isMe(p) { return !!(session && session.member.username === p.user); }

  // a poster opened whole, over the page
  function lightbox(src, title) {
    var w = el('div', 'pd-lb'); w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', title);
    var i = el('img'); i.src = src; i.alt = title; w.appendChild(i);
    var x = el('button', 'pd-lb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', EN ? 'Close' : 'إغلاق'); w.appendChild(x);
    var close = function () { w.classList.remove('is-on'); document.removeEventListener('keydown', key); setTimeout(function () { w.remove(); }, 200); };
    var key = function (e) { if (e.key === 'Escape') close(); };
    w.addEventListener('click', close);
    document.addEventListener('keydown', key);
    document.body.appendChild(w);
    requestAnimationFrame(function () { w.classList.add('is-on'); x.focus(); });
  }
  // each poster's own shape, remembered once it's known (the next drawing lays it out right away)
  var SHAPE = {};
  function shapeOf(img, box, src) {
    var set = function (k) { SHAPE[src] = k; box.classList.remove('is-tall', 'is-wide'); box.classList.add('is-' + k); };
    var read = function () { if (img.naturalWidth) set(img.naturalHeight > img.naturalWidth * 1.05 ? 'tall' : 'wide'); };
    if (SHAPE[src]) set(SHAPE[src]);
    if (img.complete) read(); else img.addEventListener('load', read);
  }
  function posterButton(src, title, box) {
    var b = el('button', 'pd-poster'); b.type = 'button'; b.setAttribute('aria-label', (EN ? 'Show the poster: ' : 'عرض البوستر كاملا: ') + title);
    var im = el('img'); im.src = src; im.alt = title; im.loading = 'lazy'; im.decoding = 'async'; b.appendChild(im);
    var z = el('span', 'pd-zoom'); z.innerHTML = I.zoom; b.appendChild(z);
    b.addEventListener('click', function () { lightbox(src, title); });
    shapeOf(im, box, src);
    return b;
  }

  function countdown(ms) {
    var m = Math.max(0, Math.floor((ms - Date.now()) / 60000));
    return [[Math.floor(m / 1440), EN ? 'days' : 'يوم'], [Math.floor(m / 60) % 24, EN ? 'hours' : 'ساعة'], [m % 60, EN ? 'min' : 'دقيقة']];
  }
  function drawCount(box, ms) {
    box.textContent = '';
    countdown(ms).forEach(function (c) { var d = el('span', 'pd-cd'); d.appendChild(el('b', null, String(c[0]).padStart(2, '0'))); d.appendChild(el('small', null, c[1])); box.appendChild(d); });
  }

  function leaderRow(p, small) {
    var li = el('li', 'pd-leader' + (p.rank <= 3 ? ' is-top is-' + p.rank : '') + (isMe(p) ? ' is-me' : ''));
    li.appendChild(el('span', 'pd-rank', String(p.rank)));
    li.appendChild(avatar(p));
    var who = el('span', 'pd-who');
    who.appendChild(nameLine(p));
    who.appendChild(el('small', null, EN ? p.right + ' right picks' : 'أصاب ' + ar(p.right, 'توقعا واحدا', 'توقعين', 'توقعات', 'توقعا')));
    li.appendChild(who);
    li.appendChild(el('span', 'pd-pts', small ? String(p.points) : pts(p.points)));
    return li;
  }
  // the top three on a podium, the rest in a list
  function podium(list) {
    var box = el('div', 'pd-podium');
    list.slice(0, 3).forEach(function (p) {
      var c = el('div', 'pd-pod is-' + p.rank + (isMe(p) ? ' is-me' : ''));
      var medal = el('span', 'pd-pod-rank', String(p.rank));
      if (p.rank === 1) { var cr = el('span', 'pd-pod-crown'); cr.innerHTML = I.crown; c.appendChild(cr); }
      c.appendChild(avatar(p, 'is-big'));
      c.appendChild(medal);
      var who = el('div', 'pd-who'); who.appendChild(nameLine(p)); c.appendChild(who);
      c.appendChild(el('span', 'pd-pod-pts', pts(p.points)));
      c.appendChild(el('span', 'pd-pod-step'));
      box.appendChild(c);
    });
    return box;
  }

  function drawMe() {
    var box = $('.pd-me');
    box.hidden = false; box.textContent = '';
    if (!session) {
      box.className = 'pd-me is-guest';
      box.appendChild(el('span', null, 'سجل دخولك لتشارك في التوقعات وتنافس على الصدارة وعلى جائزة كل عرض. الحساب مجاني.'));
      var a = el('a', 'pd-btn', 'أنشئ حسابا مجانيا'); a.href = HOME + '/account/?new&back=' + encodeURIComponent(location.pathname); box.appendChild(a);
      return;
    }
    var me = data.me || { rank: 0, points: 0, right: 0, of: 0 };
    box.className = 'pd-me';
    var cells = [[me.rank ? '#' + me.rank : '—', EN ? 'Your rank' : 'ترتيبك'], [String(me.points), EN ? 'Your points' : 'نقاطك'], [String(me.right), EN ? 'Right picks' : 'توقعات صحيحة']];
    cells.forEach(function (c) { var d = el('div'); d.appendChild(el('b', null, c[0])); d.appendChild(el('small', null, c[1])); box.appendChild(d); });
  }

  function paintOpts(li, m) {
    $$('.pd-opt', li).forEach(function (b) {
      var o = b.getAttribute('data-o'), on = m.mine === o;
      b.classList.toggle('is-mine', on);
      b.setAttribute('aria-pressed', String(on));
    });
    li.classList.toggle('is-picked', !!m.mine);
  }
  function paintProgress(card, ev) {
    var pr = $('.pd-progress', card); if (!pr) return;
    var mine = ev.matches.filter(function (m) { return m.mine; }).length, all = ev.matches.length;
    pr.classList.toggle('is-full', mine === all);
    $('.pd-bar i', pr).style.width = Math.round(mine * 100 / Math.max(1, all)) + '%';
    $('.pd-progress-t', pr).textContent = mine === all
      ? (EN ? 'All ' + all + ' picked ✓ You can change them until the show starts.' : 'اكتملت توقعاتك ✓ يمكنك تغييرها حتى بداية العرض.')
      : (EN ? 'Your picks: ' + mine + ' of ' + all : 'توقعاتك: ' + mine + ' من ' + all);
  }

  function drawMatch(ev, m, k, locked, card) {
    var img = m.image && SAFE.test(m.image) ? m.image : '';
    var li = el('li', 'pd-match' + (img ? ' has-img is-' + (SHAPE[img] || 'tall') : ' no-img') + (m.mine ? ' is-picked' : '') + (m.winner ? ' has-result' : ''));
    if (img) li.appendChild(posterButton(img, m.title, li));
    var head = el('div', 'pd-m-head');
    var kick = el('div', 'pd-m-kick');
    kick.appendChild(el('span', 'pd-m-no', (EN ? 'Match ' : 'النزال ') + (k + 1)));
    kick.appendChild(el('span', 'pd-m-pts' + (m.points > 1 ? ' is-big' : ''), pts(m.points)));
    head.appendChild(kick);
    head.appendChild(el('h3', 'pd-m-title', m.title));
    if (m.note) head.appendChild(el('p', 'pd-m-note', m.note));
    li.appendChild(head);
    var duel = m.options.length === 2;
    var opts = el('div', 'pd-opts' + (duel ? ' is-duel' : ' is-multi'));
    opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', (EN ? 'Who wins: ' : 'من يفوز: ') + m.title);
    m.options.forEach(function (o, j) {
      if (duel && j === 1) opts.appendChild(el('span', 'pd-vs', EN ? 'VS' : 'ضد'));
      var b = el('button', 'pd-opt');
      b.type = 'button';
      b.setAttribute('data-o', o);
      if (m.winner) { if (o === m.winner) b.classList.add('is-win'); else if (m.mine === o) b.classList.add('is-wrong'); }
      b.appendChild(el('span', 'pd-tick'));
      b.appendChild(el('span', 'pd-opt-name', o));
      if (m.share) {
        var p = m.share[o] || 0;
        b.style.setProperty('--p', p + '%');
        b.appendChild(el('span', 'pd-opt-p', p + '%'));
      }
      if (locked) b.disabled = true;
      else b.addEventListener('click', function () { pick(ev, m, o, li, card); });
      opts.appendChild(b);
    });
    li.appendChild(opts);
    paintOpts(li, m);
    if (m.winner && m.mine) li.appendChild(el('p', 'pd-m-res ' + (m.mine === m.winner ? 'is-ok' : 'is-no'), m.mine === m.winner ? (EN ? '✓ Right, +' + pts(m.points) : '✓ توقع صحيح، +' + pts(m.points)) : (EN ? '✗ Not this time' : '✗ لم يصب هذه المرة')));
    return li;
  }

  // the show's prize: what it is before the results, who won it after
  function drawPrize(ev) {
    var pz = ev.prize || {}, w = pz.winner;
    var box = el('div', 'pd-champ' + (w ? ' has-winner' : '') + (w && isMe(w) ? ' is-me' : ''));
    var ic = el('span', 'pd-champ-ic'); ic.innerHTML = I.trophy; box.appendChild(ic);
    var t = el('div', 'pd-champ-t');
    if (!w) {
      t.appendChild(el('small', null, EN ? 'This show\'s prize' : 'جائزة هذا العرض'));
      t.appendChild(el('b', null, EN ? 'A month of Premium for the top scorer' : 'شهر مجاني في العضوية المميزة لصاحب أعلى النقاط'));
      if (ev.status === 'done') t.appendChild(el('span', null, 'لم يحرز أحد نقاطا في هذا العرض.'));
      box.appendChild(t);
      return box;
    }
    t.appendChild(el('small', null, isMe(w) ? 'مبروك! أنت بطل توقعات هذا العرض' : 'بطل توقعات هذا العرض'));
    var row = el('div', 'pd-champ-who'); row.appendChild(avatar(w)); row.appendChild(nameLine(w)); t.appendChild(row);
    t.appendChild(el('span', null, pts(w.points) + ' · أصاب ' + ar(w.right, 'توقعا واحدا', 'توقعين', 'توقعات', 'توقعا')));
    box.appendChild(t);
    box.appendChild(el('span', 'pd-champ-prize' + (pz.granted ? ' is-given' : ''), pz.granted ? '✓ فاز بشهر في العضوية المميزة' : 'يفوز بشهر في العضوية المميزة · تفعل قريبا'));
    return box;
  }

  function drawEvents() {
    var wrap = $('.pd-events');
    wrap.textContent = '';
    var events = data.events || [];
    if (!events.length) {
      var e = el('div', 'pd-empty');
      e.appendChild(el('b', null, 'لا توجد توقعات مفتوحة الآن'));
      e.appendChild(el('p', null, 'قبل كل عرض كبير ننشر هنا نزالاته لتتوقع الفائزين. تابع الموقع، الجولة القادمة قريبا.'));
      wrap.appendChild(e);
      return;
    }
    events.forEach(function (ev) {
      var locked = ev.status === 'done' || Date.now() >= ev.starts;
      var card = el('article', 'pd-event is-' + (ev.status === 'done' ? 'done' : locked ? 'locked' : 'open'));
      card.id = 'e' + ev.id;
      card.setAttribute('data-starts', String(ev.starts));
      var title = EN ? (ev.title_en || ev.title) : ev.title;
      if (ev.image && SAFE.test(ev.image)) {
        var cover = el('div', 'pd-cover');
        cover.appendChild(posterButton(ev.image, title, cover));
        card.appendChild(cover);
      }
      var info = el('div', 'pd-ev-info');
      var main = el('div', 'pd-ev-main');
      main.appendChild(el('span', 'pd-state', ev.status === 'done' ? (EN ? 'Results' : 'النتائج') : locked ? (EN ? 'Picks closed' : 'أغلقت التوقعات') : (EN ? 'Picks open' : 'التوقعات مفتوحة')));
      main.appendChild(el('h2', null, title));
      var wh = el('p', 'pd-when'); wh.innerHTML = I.clock; wh.appendChild(el('span', null, when(ev.starts))); main.appendChild(wh);
      var total = ev.matches.reduce(function (t, m) { return t + (m.points || 1); }, 0);
      var tags = el('div', 'pd-tags');
      tags.appendChild(el('span', null, EN ? ev.matches.length + ' matches' : ar(ev.matches.length, 'نزال واحد', 'نزالان', 'نزالات', 'نزالا')));
      tags.appendChild(el('span', null, (EN ? 'up to ' : 'حتى ') + pts(total)));
      var pt = el('span', 'is-prize'); pt.innerHTML = I.crown; pt.appendChild(document.createTextNode(EN ? ' Prize: a month of Premium' : ' الجائزة: شهر في العضوية المميزة')); tags.appendChild(pt);
      main.appendChild(tags);
      info.appendChild(main);
      if (!locked) {
        var cdw = el('div', 'pd-count-w');
        cdw.appendChild(el('small', null, EN ? 'Picks close in' : 'تغلق التوقعات بعد'));
        var cd = el('div', 'pd-count'); drawCount(cd, ev.starts); cdw.appendChild(cd);
        info.appendChild(cdw);
      } else if (ev.status !== 'done') {
        info.appendChild(el('p', 'pd-locked', EN ? 'The show has started, picks are closed. Results after it ends.' : 'بدأ العرض وأغلقت التوقعات. النتائج بعد نهايته.'));
      }
      card.appendChild(info);
      if (ev.status === 'done') card.appendChild(drawPrize(ev));
      var list = el('ol', 'pd-matches');
      ev.matches.forEach(function (m, k) { list.appendChild(drawMatch(ev, m, k, locked, card)); });
      card.appendChild(list);
      if (!locked && session) {
        var pr = el('div', 'pd-progress');
        var bar = el('span', 'pd-bar'); bar.appendChild(el('i')); pr.appendChild(bar);
        pr.appendChild(el('span', 'pd-progress-t'));
        card.appendChild(pr);
        paintProgress(card, ev);
      }
      if (ev.leaders && ev.leaders.length) {
        var lb = el('div', 'pd-ev-board');
        lb.appendChild(el('h3', null, EN ? 'Best in this show' : 'الأفضل في هذا العرض'));
        var ol = el('ol', 'pd-leaders is-small');
        ev.leaders.forEach(function (p) { ol.appendChild(leaderRow(p, true)); });
        lb.appendChild(ol);
        card.appendChild(lb);
      }
      wrap.appendChild(card);
    });
  }
  function drawBoard() {
    var sec = $('.pd-board'), ol = $('.pd-leaders', sec), old = $('.pd-podium', sec);
    if (old) old.remove();
    ol.textContent = '';
    var l = data.leaders || [];
    sec.hidden = !l.length;
    var rest = l;
    if (l.length >= 3) { ol.parentNode.insertBefore(podium(l), ol); rest = l.slice(3); }
    rest.forEach(function (p) { ol.appendChild(leaderRow(p, false)); });
  }
  function draw() { drawMe(); drawEvents(); drawBoard(); }
  function pick(ev, m, o, li, card) {
    if (!session) { location.href = HOME + '/account/?new&back=' + encodeURIComponent(location.pathname + '#e' + ev.id); return; }
    var was = m.mine;
    var undo = function () { m.mine = was; paintOpts(li, m); paintProgress(card, ev); };
    m.mine = o; paintOpts(li, m); paintProgress(card, ev);
    fetch(API + '/pick', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ match: m.id, pick: o }), credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.signedOut) { location.href = HOME + '/account/?back=' + encodeURIComponent(location.pathname); return; }
        if (!d.ok) { undo(); if (d.locked) load(); toast(srv(d.error) || 'تعذر حفظ توقعك، حاول مرة أخرى.'); }
      })
      .catch(function () { undo(); toast('تعذر حفظ توقعك، تأكد من الاتصال وحاول مرة أخرى.'); });
  }
  // the countdowns, and a card closing itself when its show starts
  function tick() {
    if (document.hidden || !data) return;
    var closed = false;
    $$('.pd-event.is-open').forEach(function (card) {
      var at = Number(card.getAttribute('data-starts'));
      if (Date.now() >= at) closed = true;
      else { var c = $('.pd-count', card); if (c) drawCount(c, at); }
    });
    if (closed) load();
  }
  function load() {
    var h = {}; if (session) h.Authorization = 'Bearer ' + session.token;
    fetch(API, { headers: h, credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error();
      data = d; draw();
      if (location.hash && /^#e\d+$/.test(location.hash)) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); }
      clearInterval(timer);
      timer = setInterval(tick, 20000);
    }).catch(function () {
      var w = $('.pd-events'); w.textContent = '';
      var e = el('div', 'pd-empty'); e.appendChild(el('b', null, 'تعذر تحميل التوقعات')); e.appendChild(el('p', null, 'تأكد من الاتصال، ثم أعد تحميل الصفحة.')); w.appendChild(e);
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  load();
})();
