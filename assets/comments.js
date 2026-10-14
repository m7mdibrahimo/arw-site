// Visitors' comments (owner 2026-10-14): a name and a comment under every show, recap and story, on the site the moment
// they are sent (the owner reads them in the panel, and deletes what shouldn't stay). The comments come from the site's
// worker (worker/src/comments.ts) when the section nears the screen: one request, only for those who scroll that far.
// A comment can carry a picture: the visitor's own (cut to a small square here, before it is sent) or a wrestler's
// from /assets/avatars/ (scripts/avatars/). Every sentence is one whole string, «{n}» where a number goes, so the
// English copy of this file (lib/i18n/mirror.cjs) says it in English word order.
(function () {
  'use strict';
  var box = document.getElementById('comments');
  if (!box) return;
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/comments';
  var AVATARS = '/assets/avatars/';
  var EN = document.documentElement.lang === 'en';
  var page = box.getAttribute('data-page') || location.pathname;
  var form = box.querySelector('.arw-cm-form');
  var list = box.querySelector('.arw-cm-list');
  var countEl = box.querySelector('.arw-comments-count');
  var note = box.querySelector('.arw-cm-note');
  var nameIn = box.querySelector('.arw-cm-name');
  var textIn = box.querySelector('.arw-cm-text');
  var lenEl = box.querySelector('.arw-cm-len');
  var send = box.querySelector('.arw-cm-send');
  var shownAt = Date.now();
  var FIRST = 10;
  var NOTE = note.textContent;
  var NAME = 'arw-cm-name';
  var PIC = 'arw-cm-pic';

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function fill(s, n) { return s.replace('{n}', n); }

  // ── words ────────────────────────────────────────────────────────────────
  function countText(n) {
    if (n === 1) return 'تعليق واحد';
    if (n === 2) return 'تعليقان';
    return fill(n <= 10 ? '{n} تعليقات' : '{n} تعليقًا', n);
  }
  function ago(ms) {
    var s = Math.max(0, (Date.now() - ms) / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'الآن';
    if (m === 1) return 'منذ دقيقة';
    if (m === 2) return 'منذ دقيقتين';
    if (m < 60) return fill(m <= 10 ? 'منذ {n} دقائق' : 'منذ {n} دقيقة', m);
    if (h === 1) return 'منذ ساعة';
    if (h === 2) return 'منذ ساعتين';
    if (h < 24) return fill(h <= 10 ? 'منذ {n} ساعات' : 'منذ {n} ساعة', h);
    if (d === 1) return 'أمس';
    if (d === 2) return 'منذ يومين';
    if (d < 7) return fill('منذ {n} أيام', d);
    return new Date(ms).toLocaleDateString(EN ? 'en-US' : 'ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  var COLORS = ['#0e9594', '#ff6f59', '#e0962a', '#7c6ee8', '#0284c7', '#c73b2c', '#2f9e5b'];
  function colorOf(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function initial(name) { var n = String(name).trim().replace(/^ال(?=\S{2})/, ''); return (n.match(/\S/) || ['?'])[0].toUpperCase(); }
  // a comment's «pic»: «w:<slug>» a wrestler's, the https address of a visitor's own (kept by the worker), or the
  // «data:» picture its writer just chose
  function picSrc(pic) {
    pic = String(pic || '');
    if (/^w:[a-z0-9-]+$/.test(pic)) return AVATARS + pic.slice(2) + '.webp';
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(pic)) return pic;
    if (/^data:image\/(webp|jpeg|png);base64,/.test(pic)) return pic;
    return '';
  }

  // ── the list ─────────────────────────────────────────────────────────────
  function item(c) {
    var el = document.createElement('article');
    el.className = 'arw-cm';
    var av = document.createElement('span');
    av.className = 'arw-cm-av';
    av.setAttribute('aria-hidden', 'true');
    av.style.setProperty('--c', colorOf(c.name));
    var src = picSrc(c.pic);
    if (src) {
      var im = document.createElement('img');
      im.src = src; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.width = 40; im.height = 40;
      im.onerror = function () { av.textContent = initial(c.name); };
      av.appendChild(im);
    } else av.textContent = initial(c.name);
    var body = document.createElement('div');
    body.className = 'arw-cm-body';
    var meta = document.createElement('div');
    meta.className = 'arw-cm-meta';
    var who = document.createElement('b');
    who.className = 'arw-cm-who';
    who.textContent = c.name;
    var when = document.createElement('time');
    when.className = 'arw-cm-when';
    when.dateTime = new Date(c.at).toISOString();
    when.textContent = ago(c.at);
    meta.appendChild(who);
    meta.appendChild(when);
    var text = document.createElement('p');
    text.className = 'arw-cm-text-out';
    text.textContent = c.text;
    body.appendChild(meta);
    body.appendChild(text);
    el.appendChild(av);
    el.appendChild(body);
    return el;
  }

  var shown = [];
  function draw(all) {
    list.textContent = '';
    var n = all ? shown.length : Math.min(FIRST, shown.length);
    for (var i = 0; i < n; i++) list.appendChild(item(shown[i]));
    if (!all && shown.length > FIRST) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'arw-cm-more';
      more.textContent = fill('عرض كل التعليقات ({n})', shown.length);
      more.onclick = function () { draw(true); };
      list.appendChild(more);
    }
    if (!shown.length) {
      var empty = document.createElement('p');
      empty.className = 'arw-cm-empty';
      empty.textContent = 'لا توجد تعليقات بعد، كن أول من يعلّق.';
      list.appendChild(empty);
    }
    countEl.hidden = !shown.length;
    countEl.textContent = shown.length ? countText(shown.length) : '';
  }

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    fetch(API + '?p=' + encodeURIComponent(page), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (d) { shown = (d && d.items) || []; draw(false); })
      .catch(function () { draw(false); });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '600px 0px' });
    io.observe(box);
  } else load();
  if (location.hash === '#comments') load();

  // ── the picture ──────────────────────────────────────────────────────────
  var pick = box.querySelector('.arw-cm-pick');
  var pickImg = box.querySelector('.arw-cm-pick-img');
  var picker = box.querySelector('.arw-cm-picker');
  var grid = box.querySelector('.arw-cm-grid');
  var fileIn = box.querySelector('.arw-cm-file');
  var credits = box.querySelector('.arw-cm-credits ul');
  var EMPTY = pickImg.innerHTML;
  var pic = store.get(PIC, '') || '';
  if (!picSrc(pic)) pic = '';
  var stars = null, fed = 'WWE';
  function showPic() {
    var src = picSrc(pic);
    pickImg.innerHTML = src ? '<img alt="" width="46" height="46">' : EMPTY;
    if (src) pickImg.firstChild.src = src;
    pick.classList.toggle('has-pic', !!src);
    Array.prototype.forEach.call(grid.children, function (b) { b.setAttribute('aria-selected', String('w:' + b.getAttribute('data-slug') === pic)); });
  }
  function setPic(p) { pic = p; store.set(PIC, p); showPic(); }
  function drawStars() {
    grid.textContent = '';
    stars.filter(function (w) { return w.fed === fed; }).forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arw-cm-star';
      b.setAttribute('role', 'option');
      b.setAttribute('data-slug', w.slug);
      b.setAttribute('aria-selected', String('w:' + w.slug === pic));
      b.innerHTML = '<img alt="" width="64" height="64" loading="lazy"><span></span>';
      b.firstChild.src = AVATARS + w.slug + '.webp';
      b.lastChild.textContent = EN ? w.en : w.ar;
      b.onclick = function () { setPic('w:' + w.slug); openPicker(false); };
      grid.appendChild(b);
    });
  }
  function drawCredits() {
    var groups = {};
    stars.forEach(function (w) {
      var key = w.license ? w.owner + ' · ' + w.license : w.owner;
      (groups[key] = groups[key] || []).push(EN ? w.en : w.ar);
    });
    Object.keys(groups).forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = groups[k].join(EN ? ', ' : '\u060C ') + ': ' + k;
      credits.appendChild(li);
    });
  }
  function openPicker(open) {
    picker.hidden = !open;
    pick.setAttribute('aria-expanded', String(open));
    if (!open || stars) return;
    stars = [];
    fetch(AVATARS + 'credits.json').then(function (r) { return r.json(); }).then(function (l) { stars = l; drawStars(); drawCredits(); }).catch(function () {});
  }
  pick.addEventListener('click', function () { openPicker(picker.hidden); });
  Array.prototype.forEach.call(box.querySelectorAll('.arw-cm-fed'), function (b) {
    b.addEventListener('click', function () {
      fed = b.getAttribute('data-fed');
      Array.prototype.forEach.call(box.querySelectorAll('.arw-cm-fed'), function (x) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      if (stars && stars.length) drawStars();
    });
  });
  box.querySelector('.arw-cm-none').addEventListener('click', function () { setPic(''); openPicker(false); });
  // a visitor's own picture: a 160px square round its middle (a little above, where a face usually is), a few kB
  fileIn.addEventListener('change', function () {
    var f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f || !/^image\//.test(f.type)) return;
    if (f.size > 20 * 1024 * 1024) { say('الصورة كبيرة جدًا، اختر صورة أصغر.', 'bad'); return; }
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var c = document.createElement('canvas');
      c.width = c.height = 160;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, Math.max(0, (img.naturalHeight - side) / 2.6), side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      var out = c.toDataURL('image/webp', 0.82);
      if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', 0.85);
      setPic(out);
      openPicker(false);
    };
    img.onerror = function () { URL.revokeObjectURL(url); say('تعذّر فتح هذه الصورة، جرّب صورة أخرى.', 'bad'); };
    img.src = url;
  });
  showPic();

  // ── the form ─────────────────────────────────────────────────────────────
  nameIn.value = store.get(NAME, '') || '';
  function count() {
    var n = textIn.value.length;
    lenEl.textContent = n + ' / 1000';
    lenEl.classList.toggle('is-near', n > 900);
  }
  textIn.addEventListener('input', count);
  count();
  function say(text, kind) {
    note.textContent = text;
    note.classList.toggle('is-ok', kind === 'ok');
    note.classList.toggle('is-bad', kind === 'bad');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameIn.value.replace(/\s+/g, ' ').trim();
    var text = textIn.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    nameIn.value = name;
    if (name.length < 2 || text.length < 2) {
      form.classList.add('is-wrong');
      say(name.length < 2 ? 'اكتب اسمك أولًا.' : 'اكتب تعليقك أولًا.', 'bad');
      (name.length < 2 ? nameIn : textIn).focus();
      return;
    }
    form.classList.remove('is-wrong');
    send.disabled = true;
    say('جارٍ النشر…');
    var h1 = document.querySelector('h1');
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: page, title: h1 ? h1.textContent.trim() : document.title, name: name, text: text, pic: pic, website: form.website.value, t: Date.now() - shownAt })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || ''); return d; }); })
      .then(function (d) {
        store.set(NAME, name);
        // a picture the worker kept: its address from now on, not the picture itself
        if (d.pic && /^https:/.test(d.pic)) setPic(d.pic);
        shown.unshift({ id: d.id, name: name, text: text, pic: d.pic || pic, at: Date.now() });
        textIn.value = '';
        count();
        say('تم نشر تعليقك، شكرًا لك!', 'ok');
        loaded = true;
        draw(false);
      })
      // the worker's own words (in Arabic) say why; on the English pages, a general line
      .catch(function (err) { say(err && err.message && !EN ? err.message : 'تعذّر نشر التعليق، حاول مرة أخرى.', 'bad'); })
      .then(function () { send.disabled = false; });
  });
  [nameIn, textIn].forEach(function (el) { el.addEventListener('input', function () { if (note.classList.contains('is-bad') || note.classList.contains('is-ok')) say(NOTE); }); });
})();
