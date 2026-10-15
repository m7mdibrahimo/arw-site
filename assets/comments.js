// Visitors' comments (owner 2026-10-14): a name and a comment under every show, recap and story, on the site the moment
// they are sent (the owner reads them in the panel, and deletes what shouldn't stay). The comments come from the site's
// worker (worker/src/comments.ts) when the section nears the screen: one request, only for those who scroll that far.
// A comment can carry a picture: the visitor's own (cut to a small square here, before it is sent) or a wrestler's
// from /avatars/ (scripts/avatars/). Every sentence is one whole string, «{n}» where a number goes, so the
// English copy of this file (lib/i18n/mirror.cjs) says it in English word order.
// Visitors answer each other too («رد» under every comment), and whoever is answered is told (owner 2026-10-14): this
// browser's secret key (made here, kept in localStorage) goes with each comment, so the worker knows whose it is
// without an account; assets/features.js shows the answers on any page, and sw.js as a notification if they allowed it
// (worker/src/comment-push.ts).
(function () {
  'use strict';
  var box = document.getElementById('comments');
  if (!box) return;
  var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/comments';
  var AVATARS = '/avatars/';
  // the pictures' version (_includes/comments.njk): /avatars/ is kept a day by browsers, and a new set has to show at once
  var AV = box.getAttribute('data-avatars') ? '?v=' + box.getAttribute('data-avatars') : '';
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
  // a member of the site (assets/account.js keeps the session): comments under their own name and picture
  // a message from the worker, in English on the English pages (lib/i18n/server-en.cjs through assets/features.js)
  function srv(t) { if (!t) return ''; if (document.documentElement.lang !== 'en') return t; return (window.arwMsg && window.arwMsg(t)) || ''; }

  var member = null;
  try { var ms = JSON.parse(localStorage.getItem('arw-member') || 'null'); if (ms && ms.token && ms.member) member = ms; } catch (e) {}
  function headers() { var h = { 'Content-Type': 'application/json' }; if (member) h.Authorization = 'Bearer ' + member.token; return h; }
  var FIRST = 10;
  var NOTE = note.textContent;
  var NAME = 'arw-cm-name';
  var PIC = 'arw-cm-pic';
  var KEY = 'arw-cm-key', SEEN = 'arw-cm-seen', PUSHED = 'arw-cm-push';

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function fill(s, n) { return s.replace('{n}', n); }
  // this browser's secret key: the answers to its comments are asked for with it (only its hash is kept with them)
  function myKey() {
    var k = store.get(KEY, '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(k)) {
      var a = new Uint8Array(24);
      (window.crypto || window.msCrypto).getRandomValues(a);
      k = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      store.set(KEY, k);
    }
    // answers are counted from the first comment on
    if (!store.get(SEEN, 0)) store.set(SEEN, Date.now());
    return k;
  }

  // ── words ────────────────────────────────────────────────────────────────
  function countText(n) {
    if (n === 1) return 'تعليق واحد';
    if (n === 2) return 'تعليقان';
    return fill(n <= 10 ? '{n} تعليقات' : '{n} تعليقا', n);
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
    if (pic === 'official') return LOGO;
    if (/^w:[a-z0-9-]+$/.test(pic)) return AVATARS + pic.slice(2) + '.webp' + AV;
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/(comments\/pic\/\d+\.webp|members\/pic\/\d+\/[a-f0-9]{16}\.(webp|jpg|png))$/.test(pic)) return pic;
    if (/^data:image\/(webp|jpeg|png);base64,/.test(pic)) return pic;
    return '';
  }

  // ── the list ─────────────────────────────────────────────────────────────
  // the site's own replies (written in the panel, or by its account on the site): its logo, its name and the gold badge
  var OFFICIAL = EN ? 'Arab Wrestling' : 'عرب راسلنج';
  var LOGO = EN ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png';
  // the site's heart on a comment, as YouTube's: the site's picture with a small red heart under it
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#e8264b" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" d="M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 0 1 6.6 6.7z"/></svg>';
  // the site's own account: a gold badge; a member of the site: the blue one (owner 2026-10-14: «اي حد هيسجل هيحصل علي
  // علامة التوثيق … وخليني انا علامة ذهبي»)
  var BADGE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><defs><linearGradient id="arwGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#e09a12"/></linearGradient></defs><path fill="url(#arwGold)" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';
  var BLUE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';
  // the gold badge the owner gives by hand (owner 2026-10-15)
  var GOLD = BLUE.replace('fill="#1d9bf0"', 'fill="url(#cmGoldV)"').replace('<path', '<defs><linearGradient id="cmGoldV" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#e09a12"/></linearGradient></defs><path');
  var CROWN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
  var USER = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function item(c) {
    var el = document.createElement('article');
    el.className = 'arw-cm' + (c.official ? ' is-official' : '') + (c.parent ? ' is-reply' : '');
    el.id = 'c-' + c.id;
    var av = document.createElement('span');
    av.className = 'arw-cm-av';
    av.setAttribute('aria-hidden', 'true');
    av.style.setProperty('--c', colorOf(c.name));
    var src = c.official ? LOGO : picSrc(c.pic);
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
    who.textContent = c.official ? OFFICIAL : c.name;
    who.dir = 'auto'; // an English name on the Arabic page (and an Arabic one on the English page) reads its own way
    meta.appendChild(who);
    if (c.prem) {
      // «العضوية المميزة» (pages/premium.njk): a golden name and the crown
      who.classList.add('is-prem');
    }
    if (c.member && !c.official && c.blue !== false) {
      var mb = document.createElement('span');
      mb.className = 'arw-cm-member';
      mb.title = c.gold ? 'عضو موثق بالعلامة الذهبية' : 'عضو موثق في عرب راسلنج';
      mb.setAttribute('role', 'img');
      mb.setAttribute('aria-label', mb.title);
      mb.innerHTML = c.gold ? GOLD : BLUE;
      meta.appendChild(mb);
    }
    if (c.prem && !c.official) {
      var pr = document.createElement('a');
      pr.className = 'arw-cm-prem';
      pr.href = (document.documentElement.lang === 'en' ? '/en' : '') + '/premium/';
      pr.title = 'عضو مميز في عرب راسلنج';
      pr.innerHTML = CROWN;
      pr.appendChild(document.createTextNode('مميز'));
      meta.appendChild(pr);
    }
    if (c.official) {
      var badge = document.createElement('span');
      badge.className = 'arw-cm-badge';
      badge.title = 'حساب رسمي موثق';
      badge.innerHTML = BADGE;
      meta.appendChild(badge);
    }
    var when = document.createElement('time');
    when.className = 'arw-cm-when';
    when.dateTime = new Date(c.at).toISOString();
    when.textContent = ago(c.at);
    meta.appendChild(when);
    var text = document.createElement('p');
    text.className = 'arw-cm-text-out';
    text.dir = 'auto';
    // an answer to a reply (not to the comment on top): «@name» first, as YouTube writes it
    var to = c.reply_to && c.reply_to !== c.parent ? byId(c.reply_to) : null;
    if (to) {
      var at = document.createElement('span');
      at.className = 'arw-cm-to';
      at.textContent = '@' + (to.official ? OFFICIAL : to.name);
      text.appendChild(at);
      text.appendChild(document.createTextNode(' '));
    }
    text.appendChild(document.createTextNode(c.text));
    body.appendChild(meta);
    body.appendChild(text);
    var acts = document.createElement('div');
    acts.className = 'arw-cm-acts';
    if (c.id) {
      var rb = document.createElement('button');
      rb.type = 'button';
      rb.className = 'arw-cm-reply-btn';
      rb.textContent = 'رد';
      rb.onclick = function () { openReply(c, el); };
      acts.appendChild(rb);
    }
    body.appendChild(acts);
    if (member && member.member.official && c.id && !c.official) {
      // the site's own account: a heart, or the comment gone, right here
      var hb = document.createElement('button');
      hb.type = 'button'; hb.className = 'arw-cm-mod';
      hb.textContent = c.hearted ? '💔 إزالة القلب' : '❤️ قلب';
      hb.onclick = function () { mod(c, c.hearted ? 'unheart' : 'heart'); };
      var db = document.createElement('button');
      db.type = 'button'; db.className = 'arw-cm-mod is-del';
      db.textContent = 'حذف';
      db.onclick = function () { if (window.confirm('حذف هذا التعليق نهائيا؟')) mod(c, 'delete'); };
      acts.appendChild(hb); acts.appendChild(db);
    }
    if (c.hearted && !c.official) {
      var liked = document.createElement('span');
      liked.className = 'arw-cm-liked';
      liked.title = 'أعجب عرب راسلنج بهذا التعليق';
      liked.setAttribute('role', 'img');
      liked.setAttribute('aria-label', 'أعجب عرب راسلنج بهذا التعليق');
      liked.innerHTML = '<img src="' + LOGO + '" alt="" width="22" height="22">' + HEART;
      acts.appendChild(liked);
    }
    el.appendChild(av);
    el.appendChild(body);
    return el;
  }

  function mod(c, op) {
    fetch(API + '/mod', { method: 'POST', headers: headers(), body: JSON.stringify({ id: c.id, op: op }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        if (op === 'delete') shown = shown.filter(function (x) { return x.id !== c.id && x.parent !== c.id; });
        else c.hearted = op === 'heart';
        draw(expanded);
      }).catch(function () {});
  }

  var shown = [], expanded = false;
  function byId(id) { for (var i = 0; i < shown.length; i++) if (shown[i].id === id) return shown[i]; return null; }
  function draw(all) {
    expanded = !!all;
    list.textContent = '';
    // a comment, then the site's replies to it (oldest first), the newest comments on top
    var tops = shown.filter(function (c) { return !c.parent; });
    var replies = {};
    shown.filter(function (c) { return c.parent; }).sort(function (a, b) { return a.at - b.at; })
      .forEach(function (c) { (replies[c.parent] = replies[c.parent] || []).push(c); });
    var n = all ? tops.length : Math.min(FIRST, tops.length);
    for (var i = 0; i < n; i++) {
      list.appendChild(item(tops[i]));
      (replies[tops[i].id] || []).forEach(function (r) { list.appendChild(item(r)); });
    }
    if (!all && tops.length > FIRST) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'arw-cm-more';
      more.textContent = fill('عرض كل التعليقات ({n})', tops.length);
      more.onclick = function () { draw(true); };
      list.appendChild(more);
    }
    if (!tops.length) {
      var empty = document.createElement('p');
      empty.className = 'arw-cm-empty';
      empty.textContent = 'لا توجد تعليقات بعد، كن أول من يعلق.';
      list.appendChild(empty);
    }
    countEl.hidden = !tops.length;
    countEl.textContent = tops.length ? countText(tops.length) : '';
  }

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    fetch(API + '?p=' + encodeURIComponent(page), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (d) { shown = (d && d.items) || []; draw(false); jump(); })
      .catch(function () { draw(false); });
  }
  // opened from a notification («…#c-123»): that comment, shown and lit up
  function jump() {
    var m = location.hash.match(/^#c-(\d+)$/);
    if (!m) return;
    var el = document.getElementById('c-' + m[1]);
    if (!el && !expanded) { draw(true); el = document.getElementById('c-' + m[1]); }
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 2600);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '600px 0px' });
    io.observe(box);
  } else load();
  if (location.hash === '#comments' || /^#c-\d+$/.test(location.hash)) load();

  // ── the picture ──────────────────────────────────────────────────────────
  var pick = box.querySelector('.arw-cm-pick');
  var pickImg = box.querySelector('.arw-cm-pick-img');
  var picker = box.querySelector('.arw-cm-picker');
  var grid = box.querySelector('.arw-cm-grid');
  var fileIn = box.querySelector('.arw-cm-file');
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
      b.firstChild.src = AVATARS + w.slug + '.webp' + AV;
      b.lastChild.textContent = EN ? w.en : w.ar;
      b.onclick = function () { setPic('w:' + w.slug); openPicker(false); };
      grid.appendChild(b);
    });
  }
  function openPicker(open) {
    picker.hidden = !open;
    pick.setAttribute('aria-expanded', String(open));
    if (!open || stars) return;
    stars = [];
    fetch(AVATARS + 'credits.json' + AV).then(function (r) { return r.json(); }).then(function (l) {
      stars = l;
      // a promotion with no picture yet: no tab; the first tab that has some is the one open
      var tabs = Array.prototype.slice.call(box.querySelectorAll('.arw-cm-fed'));
      tabs.forEach(function (t) { t.hidden = !l.some(function (w) { return w.fed === t.getAttribute('data-fed'); }); });
      if (!l.some(function (w) { return w.fed === fed; })) { var first = tabs.filter(function (t) { return !t.hidden; })[0]; if (first) first.click(); }
      drawStars();
    }).catch(function () {});
  }
  pick.addEventListener('click', function () { if (member) { location.href = EN ? '/en/account/' : '/account/'; return; } openPicker(picker.hidden); });
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
    if (f.size > 20 * 1024 * 1024) { say('الصورة كبيرة جدا، اختر صورة أصغر.', 'bad'); return; }
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
    img.onerror = function () { URL.revokeObjectURL(url); say('تعذر فتح هذه الصورة، جرب صورة أخرى.', 'bad'); };
    img.src = url;
  });
  showPic();

  // ── the form ─────────────────────────────────────────────────────────────
  nameIn.value = store.get(NAME, '') || '';
  if (member) {
    // the member's name and picture, as their account has them (changed on /account/)
    nameIn.value = member.member.official ? OFFICIAL : (member.member.display || member.member.username);
    nameIn.readOnly = true;
    nameIn.classList.add('is-member');
    pick.title = member.member.official ? 'الحساب الرسمي لعرب راسلنج' : 'غير صورتك من صفحة حسابك';
    pic = member.member.official ? 'official' : (member.member.pic || '');
    showPic();
  } else {
    // a visitor: comments are the members' (owner 2026-10-14: «التعليق … لازم يكون مسجل في الموقع فقط»)
    form.hidden = true;
    var back = encodeURIComponent(location.pathname + '#comments');
    var acct = EN ? '/en/account/' : '/account/';
    var gate = document.createElement('div');
    gate.className = 'arw-cm-gate';
    gate.innerHTML = '<span class="arw-cm-gate-ic">' + USER + '</span><div class="arw-cm-gate-tx"><b></b><p></p></div><div class="arw-cm-gate-btns"><a class="arw-cm-gate-join"></a><a class="arw-cm-gate-in"></a></div>';
    gate.querySelector('b').textContent = 'سجل دخولك لتكتب تعليقا';
    gate.querySelector('p').textContent = 'التعليق والرد للأعضاء. الحساب مجاني ويستغرق أقل من دقيقة.';
    var gj = gate.querySelector('.arw-cm-gate-join'); gj.href = acct + '?new&back=' + back; gj.textContent = 'أنشئ حسابا مجانيا';
    var gi = gate.querySelector('.arw-cm-gate-in'); gi.href = acct + '?back=' + back; gi.textContent = 'تسجيل الدخول';
    form.parentNode.insertBefore(gate, form);
  }
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
      say(name.length < 2 ? 'اكتب اسمك أولا.' : 'اكتب تعليقك أولا.', 'bad');
      (name.length < 2 ? nameIn : textIn).focus();
      return;
    }
    form.classList.remove('is-wrong');
    send.disabled = true;
    say('جار النشر…');
    var h1 = document.querySelector('h1');
    fetch(API, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p: page, title: h1 ? h1.textContent.trim() : document.title, name: name, text: text, pic: pic, website: form.website.value, t: Date.now() - shownAt, k: myKey() })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.ok) throw new Error(srv(d.error) || ''); return d; }); })
      .then(function (d) {
        if (!member) store.set(NAME, name);
        if (d.name) name = d.name;
        // a picture the worker kept: its address from now on, not the picture itself
        if (d.pic && /^https:/.test(d.pic)) setPic(d.pic);
        shown.unshift({ id: d.id, name: name, text: text, pic: d.pic || pic, at: Date.now(), member: d.member || '', official: !!d.official, blue: d.blue, gold: !!d.gold, prem: !!d.prem });
        textIn.value = '';
        count();
        say('تم نشر تعليقك، شكرا لك!', 'ok');
        loaded = true;
        draw(expanded);
        offerPush(form);
      })
      // the worker's own words (in Arabic) say why; on the English pages, a general line
      .catch(function (err) { say(err && err.message && !EN ? err.message : 'تعذر نشر التعليق، حاول مرة أخرى.', 'bad'); })
      .then(function () { send.disabled = false; });
  });
  [nameIn, textIn].forEach(function (el) { el.addEventListener('input', function () { if (note.classList.contains('is-bad') || note.classList.contains('is-ok')) say(NOTE); }); });

  // ── an answer to a comment ───────────────────────────────────────────────
  // a small form right under the comment: the name the visitor already wrote (or a field for it), the answer, «رد»
  var replyForm = null;
  function openReply(c, el) {
    if (!member) { var g = box.querySelector('.arw-cm-gate'); if (g) { g.scrollIntoView({ behavior: 'smooth', block: 'center' }); g.classList.remove('is-flash'); void g.offsetWidth; g.classList.add('is-flash'); } return; }
    if (replyForm) { var was = replyForm.target; replyForm.el.remove(); replyForm = null; if (was === c.id) return; }
    var who = c.official ? OFFICIAL : c.name;
    var saved = member ? (member.member.display || member.member.username) : (store.get(NAME, '') || '');
    var f = document.createElement('form');
    f.className = 'arw-cm-rform';
    f.noValidate = true;
    f.innerHTML = '<input class="arw-cm-rname" maxlength="40" autocomplete="nickname"><textarea class="arw-cm-rtext" rows="2" maxlength="1000"></textarea>' +
      '<div class="arw-cm-rbar"><span class="arw-cm-rnote" role="status" aria-live="polite"></span><button type="button" class="arw-cm-rcancel"></button><button type="submit" class="arw-cm-rsend"></button></div>';
    var rn = f.querySelector('.arw-cm-rname'), rt = f.querySelector('.arw-cm-rtext'), rnote = f.querySelector('.arw-cm-rnote'), rs = f.querySelector('.arw-cm-rsend');
    rn.placeholder = 'اسمك';
    rn.value = saved;
    rn.hidden = !!saved;
    rt.placeholder = fill('ردك على {n}…', who);
    f.querySelector('.arw-cm-rcancel').textContent = 'إلغاء';
    rs.textContent = 'رد';
    if (saved) rnote.textContent = fill('باسم {n}', saved);
    f.querySelector('.arw-cm-rcancel').onclick = function () { f.remove(); replyForm = null; };
    var opened = Date.now();
    f.onsubmit = function (e) {
      e.preventDefault();
      var name = rn.value.replace(/\s+/g, ' ').trim();
      var text = rt.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (name.length < 2) { rn.hidden = false; rn.focus(); rnote.textContent = 'اكتب اسمك أولا.'; return; }
      if (text.length < 2) { rt.focus(); rnote.textContent = 'اكتب ردك أولا.'; return; }
      rs.disabled = true;
      rnote.textContent = 'جار النشر…';
      var h1 = document.querySelector('h1');
      fetch(API, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ p: page, title: h1 ? h1.textContent.trim() : document.title, name: name, text: text, pic: pic, website: '', t: Math.max(Date.now() - opened, Date.now() - shownAt), k: myKey(), parent: c.id })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.ok) throw new Error(srv(d.error) || ''); return d; }); })
        .then(function (d) {
          if (!member) store.set(NAME, name);
          if (d.name) name = d.name;
          if (d.pic && /^https:/.test(d.pic) && !member) setPic(d.pic);
          shown.push({ id: d.id, name: name, text: text, pic: d.pic || pic, at: Date.now(), parent: d.parent || c.parent || c.id, reply_to: d.reply_to || c.id, member: d.member || '', official: !!d.official, blue: d.blue, gold: !!d.gold, prem: !!d.prem });
          replyForm = null;
          draw(expanded);
          var mine = document.getElementById('c-' + d.id);
          if (mine) { mine.classList.add('is-flash'); offerPush(mine); }
        })
        .catch(function (err) { rnote.textContent = err && err.message && !EN ? err.message : 'تعذر نشر الرد، حاول مرة أخرى.'; rs.disabled = false; });
    };
    el.parentNode.insertBefore(f, el.nextSibling);
    replyForm = { el: f, target: c.id };
    (saved ? rt : rn).focus();
  }

  // ── told when someone answers ────────────────────────────────────────────
  // after a comment or an answer: a line offering a notification on this phone or computer when someone answers.
  // Only where the browser can (not iPhones' Safari outside an installed app), never asked twice.
  function canPush() {
    try { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Notification.permission !== 'denied' && !store.get(PUSHED, false); }
    catch (e) { return false; }
  }
  function b64key(s) {
    var b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    var a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function offerPush(after) {
    if (!canPush() || box.querySelector('.arw-cm-alert')) return;
    var card = document.createElement('div');
    card.className = 'arw-cm-alert';
    card.innerHTML = '<span class="arw-cm-alert-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>' +
      '<span class="arw-cm-alert-tx"></span><button type="button" class="arw-cm-alert-on"></button><button type="button" class="arw-cm-alert-no"></button>';
    card.querySelector('.arw-cm-alert-tx').textContent = 'هل تريد أن يصلك إشعار عند الرد على تعليقك؟';
    var on = card.querySelector('.arw-cm-alert-on'), no = card.querySelector('.arw-cm-alert-no');
    on.textContent = 'فعل الإشعارات';
    no.textContent = 'ليس الآن';
    no.onclick = function () { store.set(PUSHED, 'no'); card.remove(); };
    on.onclick = function () {
      on.disabled = true;
      var k = myKey();
      navigator.serviceWorker.register('/sw.js')
        .then(function () { return Notification.requestPermission(); })
        .then(function (p) { if (p !== 'granted') throw new Error('denied'); return navigator.serviceWorker.ready; })
        .then(function (reg) {
          // the key goes to the service worker too: it asks for the answers when a push wakes it
          if (reg.active) reg.active.postMessage({ type: 'ARW_CM_KEY', k: k, since: store.get(SEEN, Date.now()), en: EN });
          return fetch(API + '/push-key').then(function (r) { return r.json(); }).then(function (d) {
            return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(d.key) }); });
          });
        })
        .then(function (sub) { return fetch(API + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: k, endpoint: sub.endpoint }) }); })
        .then(function (r) {
          if (!r.ok) throw new Error('');
          store.set(PUSHED, true);
          card.querySelector('.arw-cm-alert-tx').textContent = 'تم التفعيل، سيصلك إشعار عند الرد على تعليقك.';
          on.remove(); no.remove();
          setTimeout(function () { card.remove(); }, 4000);
        })
        .catch(function (e) {
          if (e && e.message === 'denied') { store.set(PUSHED, 'no'); card.remove(); return; }
          on.disabled = false;
          card.querySelector('.arw-cm-alert-tx').textContent = 'تعذر تفعيل الإشعارات، حاول مرة أخرى.';
        });
    };
    after.parentNode.insertBefore(card, after.nextSibling);
  }
})();
