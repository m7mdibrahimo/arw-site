// «توقعات العروض الكبرى وترتيب أفضل المتوقعين» (owner 2026-10-15): pages/predictions.njk. The cards, the picks and the
// rankings come from the worker (worker/src/predict.ts); a pick is saved the moment it's chosen, until the show starts.
(function () {
  'use strict';
  var root = document.getElementById('pd');
  if (!root) return;
  var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
  var API = root.getAttribute('data-api') + '/predict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var session = null;
  try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); if (s && s.token && s.member) session = s; } catch (e) {}
  var data = null, timer = null;
  function srv(t) { if (!t) return ''; if (!EN) return t; return (window.arwMsg && window.arwMsg(t)) || ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function toast(t) {
    var old = $('.pd-toast'); if (old) old.remove();
    var x = el('div', 'pd-toast', t); x.setAttribute('role', 'status'); document.body.appendChild(x);
    requestAnimationFrame(function () { x.classList.add('is-on'); });
    setTimeout(function () { x.classList.remove('is-on'); setTimeout(function () { x.remove(); }, 300); }, 3500);
  }
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function when(ms) {
    var d = new Date(ms);
    if (EN) return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + '، الساعة ' + ((h % 12) || 12) + ':' + m + (h < 12 ? ' ص' : ' م');
  }
  // Arabic counted the way it's said: دقيقة واحدة، دقيقتان، 3 دقائق، 11 دقيقة
  function ar(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many; }
  function left(ms) {
    var m = Math.max(1, Math.round((ms - Date.now()) / 60000));
    if (m < 60) return EN ? m + ' min' : ar(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
    var h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return EN ? h + ' h' + (r ? ' ' + r + ' min' : '') : ar(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة') + (r ? ' و' + ar(r, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة') : '');
    var d = Math.floor(h / 24);
    return EN ? d + ' days' : ar(d, 'يوم', 'يومين', 'أيام', 'يوما');
  }
  function pts(n) { return EN ? (n === 1 ? '1 point' : n + ' points') : n === 1 ? 'نقطة' : n === 2 ? 'نقطتان' : n + ' نقاط'; }
  function avatar(p) {
    var a = el('span', 'pd-av'), pic = String(p.pic || ''), src = '';
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
  // the wrestlers' pictures the site already has (assets/avatars/credits.json): an option's face when its name is one
  var FACES = {};
  fetch('/avatars/credits.json').then(function (r) { return r.json(); }).then(function (l) {
    (l || []).forEach(function (w) { if (w && w.ar && w.slug) FACES[w.ar] = { slug: w.slug, en: w.en }; });
    if (data) drawEvents();
  }).catch(function () {});
  function label(o) { return EN && FACES[o] && FACES[o].en ? FACES[o].en : o; }
  function face(o) {
    var a = el('span', 'pd-face'), f = FACES[o];
    if (f) { var i = el('img'); i.src = '/avatars/' + f.slug + '.webp'; i.alt = ''; i.loading = 'lazy'; a.appendChild(i); }
    else a.textContent = (String(o).trim().replace(/^(ال|ذا\s)(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase();
    return a;
  }
  function poster(src, title) {
    var w = el('div', 'pd-lb'); w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', title);
    var i = el('img'); i.src = src; i.alt = title; w.appendChild(i);
    var x = el('button', 'pd-lb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', EN ? 'Close' : 'إغلاق'); w.appendChild(x);
    var close = function () { w.classList.remove('is-on'); document.removeEventListener('keydown', key); setTimeout(function () { w.remove(); }, 200); };
    var key = function (e) { if (e.key === 'Escape') close(); };
    w.addEventListener('click', close);
    document.addEventListener('keydown', key);
    document.body.appendChild(w);
    requestAnimationFrame(function () { w.classList.add('is-on'); });
  }
  function leaderRow(p, small) {
    var li = el('li', 'pd-leader' + (p.rank <= 3 ? ' is-top is-' + p.rank : '') + (session && session.member.username === p.user ? ' is-me' : ''));
    li.appendChild(el('span', 'pd-rank', String(p.rank)));
    li.appendChild(avatar(p));
    var who = el('span', 'pd-who');
    var nm = el('b'); nm.appendChild(el('span', null, p.name));
    if (p.gold || p.blue) { var bg = el('span', 'pd-badge'); bg.innerHTML = p.gold ? GOLD : BLUE; nm.appendChild(bg); }
    who.appendChild(nm);
    who.appendChild(el('small', null, EN ? p.right + ' right picks' : 'أصاب ' + p.right + ' توقعات'));
    li.appendChild(who);
    li.appendChild(el('span', 'pd-pts', small ? String(p.points) : pts(p.points)));
    return li;
  }
  function drawMe() {
    var box = $('.pd-me');
    box.hidden = false; box.textContent = '';
    if (!session) {
      box.className = 'pd-me is-guest';
      box.appendChild(el('span', null, 'سجل دخولك لتشارك في التوقعات وتنافس على الصدارة. الحساب مجاني.'));
      var a = el('a', 'pd-btn', 'أنشئ حسابا مجانيا'); a.href = HOME + '/account/?new&back=' + encodeURIComponent(location.pathname); box.appendChild(a);
      return;
    }
    var me = data.me || { rank: 0, points: 0, right: 0, of: 0 };
    box.className = 'pd-me';
    var cells = [[me.rank ? '#' + me.rank : '—', EN ? 'Your rank' : 'ترتيبك'], [String(me.points), EN ? 'Your points' : 'نقاطك'], [String(me.right), EN ? 'Right picks' : 'توقعات صحيحة']];
    cells.forEach(function (c) { var d = el('div'); d.appendChild(el('b', null, c[0])); d.appendChild(el('small', null, c[1])); box.appendChild(d); });
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
      var head = el('div', 'pd-ev-head');
      if (ev.image && /^(\/|https:\/\/)[^\s"'<>]*$/.test(ev.image)) { head.style.backgroundImage = 'linear-gradient(180deg, rgba(10,12,16,.25), rgba(10,12,16,.88)), url("' + ev.image.replace(/"/g, '') + '")'; head.classList.add('has-img'); }
      head.appendChild(el('span', 'pd-state', ev.status === 'done' ? 'النتائج' : locked ? 'أغلقت التوقعات' : 'التوقعات مفتوحة'));
      head.appendChild(el('h2', null, EN ? (ev.title_en || ev.title) : ev.title));
      var meta = el('p', 'pd-when');
      meta.textContent = ev.status === 'done' ? when(ev.starts) : locked ? (EN ? 'The show has started, picks are closed.' : 'بدأ العرض، وأغلقت التوقعات. النتائج بعد نهايته.') : (EN ? 'Picks close in ' : 'تغلق التوقعات بعد ') + left(ev.starts) + ' · ' + when(ev.starts);
      head.appendChild(meta);
      var total = ev.matches.reduce(function (t, m) { return t + (m.points || 1); }, 0);
      head.appendChild(el('p', 'pd-ev-sum', EN ? ev.matches.length + ' matches · up to ' + total + ' points' : ar(ev.matches.length, 'نزال واحد', 'نزالان', 'نزالات', 'نزالا') + ' · حتى ' + pts(total)));
      card.appendChild(head);
      var list = el('ol', 'pd-matches');
      var mine = 0;
      ev.matches.forEach(function (m) {
        if (m.mine) mine++;
        var li = el('li', 'pd-match' + (m.image ? ' has-img' : ''));
        // the match's own poster: the faces at a glance, the whole poster a tap away
        if (m.image && /^(\/|https:\/\/)[^\s"'<>]*$/.test(m.image)) {
          var pb = el('button', 'pd-m-poster'); pb.type = 'button'; pb.setAttribute('aria-label', EN ? 'Show the poster' : 'عرض البوستر');
          var im = el('img'); im.src = m.image; im.alt = m.title; im.loading = 'lazy'; im.decoding = 'async'; pb.appendChild(im);
          pb.addEventListener('click', function () { poster(m.image, m.title); });
          li.appendChild(pb);
        }
        var body = el('div', 'pd-m-body');
        var top = el('div', 'pd-m-top');
        top.appendChild(el('b', null, m.title));
        top.appendChild(el('span', 'pd-m-pts' + (m.points > 1 ? ' is-big' : ''), pts(m.points)));
        body.appendChild(top);
        if (m.note) body.appendChild(el('p', 'pd-m-note', m.note));
        var duel = m.options.length === 2;
        var opts = el('div', 'pd-opts' + (duel ? ' is-duel' : ''));
        m.options.forEach(function (o, k) {
          if (duel && k === 1) opts.appendChild(el('span', 'pd-vs', EN ? 'VS' : 'ضد'));
          var b = el('button', 'pd-opt');
          b.type = 'button';
          b.setAttribute('aria-pressed', String(m.mine === o));
          if (m.mine === o) b.classList.add('is-mine');
          if (m.winner) { if (o === m.winner) b.classList.add('is-win'); else if (m.mine === o) b.classList.add('is-wrong'); }
          b.appendChild(face(o));
          b.appendChild(el('span', 'pd-opt-name', label(o)));
          if (m.share) {
            var p = m.share[o] || 0;
            b.style.setProperty('--p', p + '%');
            b.appendChild(el('span', 'pd-opt-p', p + '%'));
          }
          if (locked) b.disabled = true;
          else b.addEventListener('click', function () { pick(ev, m, o, b); });
          opts.appendChild(b);
        });
        body.appendChild(opts);
        if (m.winner && m.mine) body.appendChild(el('p', 'pd-m-res ' + (m.mine === m.winner ? 'is-ok' : 'is-no'), m.mine === m.winner ? (EN ? '✓ Right, +' + m.points : '✓ توقع صحيح، +' + pts(m.points)) : (EN ? '✗ Not this time' : '✗ لم يصب هذه المرة')));
        li.appendChild(body);
        list.appendChild(li);
      });
      card.appendChild(list);
      if (!locked) {
        var pr = el('div', 'pd-progress' + (mine === ev.matches.length ? ' is-full' : ''));
        var bar = el('span', 'pd-bar'); var fill = el('i'); fill.style.width = Math.round(mine * 100 / Math.max(1, ev.matches.length)) + '%'; bar.appendChild(fill);
        pr.appendChild(bar);
        pr.appendChild(el('span', null, (EN ? 'Your picks: ' : 'توقعاتك: ') + mine + ' / ' + ev.matches.length + (mine === ev.matches.length ? (EN ? ' — all set ✓ you can change them until the show starts.' : ' — اكتملت ✓ يمكنك تغييرها حتى بداية العرض.') : '')));
        card.appendChild(pr);
      }
      if (ev.leaders && ev.leaders.length) {
        var lb = el('div', 'pd-ev-board');
        lb.appendChild(el('h3', null, 'الأفضل في هذا العرض'));
        var ol = el('ol', 'pd-leaders is-small');
        ev.leaders.forEach(function (p) { ol.appendChild(leaderRow(p, true)); });
        lb.appendChild(ol);
        card.appendChild(lb);
      }
      wrap.appendChild(card);
    });
  }
  function drawBoard() {
    var sec = $('.pd-board'), ol = $('.pd-leaders', sec);
    ol.textContent = '';
    var l = data.leaders || [];
    sec.hidden = !l.length;
    l.forEach(function (p) { ol.appendChild(leaderRow(p, false)); });
  }
  function draw() { drawMe(); drawEvents(); drawBoard(); }
  function pick(ev, m, o, b) {
    if (!session) { location.href = HOME + '/account/?new&back=' + encodeURIComponent(location.pathname + '#e' + ev.id); return; }
    var was = m.mine;
    m.mine = o; drawEvents();
    fetch(API + '/pick', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ match: m.id, pick: o }), credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.signedOut) { location.href = HOME + '/account/?back=' + encodeURIComponent(location.pathname); return; }
        if (!d.ok) { m.mine = was; if (d.locked) load(); else drawEvents(); toast(srv(d.error) || 'تعذر حفظ توقعك، حاول مرة أخرى.'); }
      })
      .catch(function () { m.mine = was; drawEvents(); toast('تعذر حفظ توقعك، تأكد من الاتصال وحاول مرة أخرى.'); });
  }
  function load() {
    var h = {}; if (session) h.Authorization = 'Bearer ' + session.token;
    fetch(API, { headers: h, credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error();
      data = d; draw();
      if (location.hash && /^#e\d+$/.test(location.hash)) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); }
      clearInterval(timer);
      // the countdown, and the card closing itself when the show starts
      timer = setInterval(function () { if (!document.hidden && data && (data.events || []).some(function (e) { return e.status === 'open'; })) drawEvents(); }, 30000);
    }).catch(function () {
      var w = $('.pd-events'); w.textContent = '';
      var e = el('div', 'pd-empty'); e.appendChild(el('b', null, 'تعذر تحميل التوقعات')); e.appendChild(el('p', null, 'تأكد من الاتصال، ثم أعد تحميل الصفحة.')); w.appendChild(e);
    });
  }
  load();
})();
