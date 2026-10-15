// «مجتمع المصارعة» (owner 2026-10-14: «نظام دردشات للمسجلين في الموقع فقط … جروب لكل محبين كل اتحاد … يترد في وقتها
// مباشرة … يرفق صور او ملف وخانة ايموجي … وخانة الصوت … تفاعل علي الرسايل بالايموجي زي ماسنجر … ريبلاي علي الرسالة»).
// The page: pages/community.njk. The rooms: worker/src/chat.ts (a Durable Object each, over a WebSocket).
// A member's session is the one assets/account.js keeps (localStorage «arw-member»); it buys a one-minute ticket for the
// room's socket. Everything a person wrote is put on the page as text (textContent), never as markup.
(function () {
  'use strict';
  var root = document.getElementById('cm');
  if (root && document.documentElement.lang === 'en') { var hm = root.querySelector('.cm-home'); if (hm) { hm.href = '/en/'; hm.setAttribute('aria-label', 'Back to the site'); hm.title = 'Back to the site'; } }
  if (!root) return;
  var API = root.getAttribute('data-api');
  var WS = API.replace(/^http/, 'ws');
  var AV = root.getAttribute('data-avatars') ? '?v=' + root.getAttribute('data-avatars') : '';
  var app = root.querySelector('.cm-app');
  var chat = root.querySelector('.cm-chat');
  var list = root.querySelector('.cm-list');
  var scroller = root.querySelector('.cm-scroll');
  var compose = root.querySelector('.cm-compose');
  var input = compose.querySelector('textarea');
  var sendBtn = compose.querySelector('[data-act="mic"]');
  // a phone: sending keeps the keyboard up, as in WhatsApp (the tap never takes the focus from the box, and no click
  // follows it; the microphone, with nothing written, works as before)
  sendBtn.addEventListener('touchend', function (e) {
    if (!e.cancelable || !canSend()) return;
    e.preventDefault();
    send();
  }, { passive: false });
  var TOUCH = window.matchMedia('(hover: none)').matches;
  var LOGO = '/assets/brand-logo.png?v=2';
  var QUICK = ['❤️', '😂', '😮', '😢', '😡', '👍'];
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var BLUE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';
  var GOLD = BLUE.replace('fill="#1d9bf0"', 'fill="url(#cmGold)"').replace('<path', '<defs><linearGradient id="cmGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#e09a12"/></linearGradient></defs><path');
  var IC = {
    reply: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9 19 14l-5 5"/><path d="M19 14H9a5 5 0 0 1-5-5V5"/></svg>',
    smile: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M8 14.5s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 7 4 3v2H6v-2l4-3z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    swipe: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9 19 14l-5 5"/><path d="M19 14H9a5 5 0 0 1-5-5V5"/></svg>',
    replyCap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 9 5 14l5 5"/><path d="M5 14h10a5 5 0 0 0 5-5V5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    // a message of mine: waiting, sent, not sent (WhatsApp's marks)
    clock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 7v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.4" fill="#fff"/></svg>'
  };
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the picker: the site's own row first (always there), then every emoji there is (assets/emoji-data.json, loaded the
  // first time the picker opens: ١٨٥٠ in nine groups, with Arabic and English words to search by)
  var WRESTLING = '🤼🏆🥇🥈🥉🏅🎖️👑🔔🎤🎙️🔥💥⚡💫⭐🌟✨🎉🎊🏟️📺🎬📣🥊🥋🏋️💯🆕🔝⏰🗓️🎟️💰💎🐐🦁🐍🦅🐺🦂🆚💪👊👏🙌🤝🙏👀😱🤯😤🤬😂😭🥶🫡';
  var CAT_ICONS = ['😀', '👋', '🐻', '🍔', '⚽', '✈️', '💡', '🔣', '🏁'];
  var TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'];
  // stickers (owner 2026-10-15: «استيكرات … ملصقات»): the site's own, drawn here (no file to load), and animated emoji
  // (Google's Noto, free to use: https://googlefonts.github.io/noto-emoji-animation/)
  var ARW = [
    ['three', '1.. 2.. 3!', '🔔', 4], ['tapout', 'تاب أوت!', '✋', 24], ['champ', 'بطل جديد', '🏆', 42], ['fire', 'ماتش خرافي', '🔥', 12],
    ['five', '5 نجوم', '⭐', 45], ['yes', 'نعم! نعم! نعم!', '☝️', 120], ['goat', 'الأفضل', '🐐', 177], ['return', 'عودة أسطورية', '💥', 20],
    ['belt', 'الحزام لنا', '🥇', 38], ['deserve', 'يستحق', '👏', 150], ['robbed', 'ظلم!', '😤', 0], ['heel', 'خيانة!', '🗡️', 350],
    ['what', 'مستحيل!', '😱', 270], ['crazy', 'غير طبيعي', '🤯', 330], ['who', 'من هذا؟!', '😳', 300], ['botch', 'بوتش', '😬', 200],
    ['boo', 'بووو', '👎', 8], ['lol', 'هههههه', '😂', 50], ['ready', 'جاهز للعرض', '📺', 212], ['here', 'نحن هنا', '🙋', 100],
    ['thanks', 'شكرا', '🙏', 160], ['luck', 'حظا أوفر', '😅', 190], ['morning', 'صباح المصارعة', '☀️', 40], ['night', 'تصبحون على خير', '🌙', 230]
  ];
  var ARW_BY = {}; ARW.forEach(function (x, i) { ARW_BY[x[0]] = { t: x[1], e: x[2], h: x[3], i: i }; });
  var NOTO = '1f600 1f603 1f604 1f601 1f606 1f605 1f923 1f602 1f642 1f609 1f60a 1f607 1f970 1f60d 1f929 1f618 1f60b 1f61b 1f61c 1f92a 1f911 1f917 1f92d 1f92b 1f914 1f910 1f928 1f610 1f611 1f636 1f60f 1f612 1f644 1f62c 1f60c 1f614 1f62a 1f924 1f634 1f637 1f912 1f915 1f922 1f92e 1f975 1f976 1f974 1f635 1f92f 1f920 1f973 1f60e 1f913 1f9d0 1f615 1f61f 1f641 1f62e 1f62f 1f632 1f633 1f97a 1f626 1f627 1f628 1f630 1f625 1f622 1f62d 1f631 1f616 1f623 1f61e 1f613 1f629 1f62b 1f971 1f624 1f621 1f620 1f92c 1f608 1f47f 1f480 1f4a9 1f921 1f47b 1f47d 1f916 1f63a 1f648 1f649 1f64a 1f4af 1f4a5 1f4ab 1f525 26a1 2728 1f389 1f38a 1f3c6 1f947 1f514 1f451 1f4aa 1f44f 1f64c 1f44d 1f44e 1f44a 270a 1f91d 1f64f 1f44b 1f91e 270c 1f918 1f44c 1fae1 1faf6 1f440 2764 1f9e1 1f49b 1f49a 1f499 1f49c 1f5a4 1f90d 1f494 2764_200d_1f525 1f498 1f339 1f410 1f981 1f40d 1f985 1f43a 1f982 1f422 1f680 23f0 1f48e 1f37f 2615 1f382 1f31f 2b50 1f308 2744 1f4a3 1f3af 1f3b2 1f3c1 1f6a8 26a0 274c 2705 2753 2757 1f192 1f195'.split(' ');
  function notoChar(code) { return String.fromCodePoint.apply(null, code.split('_').map(function (h) { return parseInt(h, 16); })); }
  function notoSrc(code) { return 'https://fonts.gstatic.com/s/e/notoemoji/latest/' + code + '/512.webp'; }
  var GIF_TAGS = [['مصارعة', 'wrestling'], ['احتفال', 'celebrate'], ['ضحك', 'lol'], ['صدمة', 'shocked'], ['تصفيق', 'applause'], ['فوز', 'winner'], ['غضب', 'angry'], ['حزن', 'sad'], ['رقص', 'dance'], ['نعم', 'yes'], ['لا', 'no'], ['شكرا', 'thank you']];
  var SEG = window.Intl && Intl.Segmenter ? new Intl.Segmenter('ar', { granularity: 'grapheme' }) : null;
  function graphemes(s) { if (SEG) return Array.from(SEG.segment(s), function (x) { return x.segment; }); return Array.from(s); }

  // ── small helpers ────────────────────────────────────────────────────────
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  var toastT;
  function toast(t) { var b = $('.cm-toast'); b.textContent = t; b.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { b.hidden = true; }, 2800); }
  var COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b', '#c2417a'];
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function colorOf(s) { return COLORS[hash(s) % COLORS.length]; }
  function hueOf(s) { return hash(s + 'h') % 360; }
  function initial(n) { return (String(n).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase(); }
  function picSrc(p) {
    p = String(p || '');
    if (p === 'official') return LOGO;
    if (/^w:[a-z0-9-]+$/.test(p)) return '/avatars/' + p.slice(2) + '.webp' + AV;
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/(comments\/pic\/\d+\.webp|members\/pic\/\d+\/[a-f0-9]{16}\.(webp|jpg|png))$/.test(p)) return p;
    return '';
  }
  function avatar(p) {
    var a = el('span', 'cm-av' + (p.pic === 'official' ? ' is-official' : ''));
    var src = picSrc(p.pic);
    if (src) { var i = new Image(); i.alt = ''; i.loading = 'lazy'; i.src = src; i.onerror = function () { a.textContent = initial(p.name); }; a.appendChild(i); }
    else { a.textContent = initial(p.name); a.style.setProperty('--c', colorOf(p.name)); }
    return a;
  }
  var CROWN = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
  // the site's account: gold; «العضوية المميزة»: the blue badge and the crown (pages/premium.njk); a member given it: blue
  // gold: the site's account, or a member the owner gave the gold badge (vgold); blue: verified or premium
  // a message from the worker, in English on the English pages (lib/i18n/server-en.cjs through assets/features.js)
  function srv(t) { if (!t) return ''; if (document.documentElement.lang !== 'en') return t; return (window.arwMsg && window.arwMsg(t)) || ''; }

  function badge(b) { return b === 'gold' || b === 'vgold' || b === 'gprem' ? GOLD : b === 'blue' || b === 'premium' ? BLUE : ''; }
  function isPrem(b) { return b === 'premium' || b === 'gprem'; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  // «2:17 م» (the English page: «2:17 PM», lib/i18n/mirror.cjs turns the language)
  function clock(ms) { return new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' }); }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ms) {
    var d = new Date(ms), now = new Date();
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= t0) return 'اليوم';
    if (ms >= t0 - 864e5) return 'أمس';
    if (ms >= t0 - 6 * 864e5) return DAYS[d.getDay()];
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  var AND = ' و ', EN = document.documentElement.lang === 'en';
  // the owner's rooms come from the worker in Arabic: their English on the English page when there is one (server-en)
  function roomWord(t) { return EN && t && window.arwMsg ? window.arwMsg(t) || t : t; }
  // the room's own background (the owner's, from the panel: worker/src/chat.ts roomBg): blurred and veiled behind the
  // messages in the site's light or dark colour (assets/community.css «has-bg»); only a picture the worker keeps
  var BG_OK = new RegExp('^' + API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/chat/media/chat/[a-z][a-z0-9]{1,23}/\\d{6}/[a-f0-9]{24}\\.(webp|jpg|png)$');
  function paintBg() {
    var R = current && ROOMS[current], url = R && R.bg && BG_OK.test(R.bg) ? R.bg : '';
    var num = function (v, d) { v = Number(v); return isFinite(v) ? v : d; };
    if (url) {
      chat.style.setProperty('--cm-bg-blur', Math.max(0, Math.min(30, num(R.bgBlur, 12))) + 'px');
      chat.style.setProperty('--cm-bg-dim', Math.max(0, Math.min(90, num(R.bgDim, 50))) / 100);
    }
    if (chat.getAttribute('data-bg') === url) return;
    chat.setAttribute('data-bg', url);
    chat.classList.toggle('has-bg', !!url);
    if (!url) { chat.style.removeProperty('--cm-bg'); return; }
    // shown once the picture is here (no half-drawn picture over the room)
    var img = new Image();
    img.onload = function () { if (chat.getAttribute('data-bg') === url) chat.style.setProperty('--cm-bg', 'url("' + url + '")'); };
    img.src = url;
  }
  function size(b) { b = Number(b) || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' ميجا' : Math.max(1, Math.round(b / 1024)) + ' كيلو'; }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function plural(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many; }
  // what a message holds, in a word (the rooms' list, a quote, the pinned bar)
  function kindLabel(k) { return k === 'image' ? '📷 صورة' : k === 'voice' ? '🎤 رسالة صوتية' : k === 'sticker' ? '🌟 ملصق' : k === 'gif' ? '🎞️ GIF' : k === 'video' ? '🎬 فيديو' : '📎 ملف'; }
  function typingText(names) { return names.length === 1 ? names[0] + ' يكتب…' : names.length === 2 ? names[0] + AND + names[1] + ' يكتبان…' : names.length + ' يكتبون الآن…'; }

  // ── who's here ───────────────────────────────────────────────────────────
  function session() { var s = store('arw-member'); return s && s.token ? s : null; }
  var ROOMS = {};
  $$('.cm-room').forEach(function (b) {
    ROOMS[b.getAttribute('data-room')] = { id: b.getAttribute('data-room'), btn: b, name: $('b', b).textContent, about: $('.cm-room-last', b).textContent, hue: b.style.getPropertyValue('--h'), mark: $('.cm-mark', b).innerHTML, built: true };
  });
  var seen = store('arw-cm-seen') || {};
  // the list as the owner keeps it (the panel's «الغرف»): new rooms added, names and colours updated, hidden ones gone,
  // the owner's order kept. The page was built with the first list; /chat/rooms is the one in force.
  var nav = $('.cm-rooms');
  var want = location.hash.slice(1);
  function syncRooms(list) {
    if (!list || !list.length) return;
    var keep = {};
    list.forEach(function (s, i) {
      keep[s.id] = 1;
      var R = ROOMS[s.id];
      if (!R) {
        var b = el('button', 'cm-room');
        b.type = 'button'; b.setAttribute('data-room', s.id);
        b.innerHTML = '<span class="cm-mark" aria-hidden="true"></span><span class="cm-room-tx"><b></b><small class="cm-room-last"></small></span><span class="cm-room-meta"><em class="cm-room-on" hidden></em><i class="cm-room-new" hidden></i></span>';
        R = ROOMS[s.id] = { id: s.id, btn: b };
      }
      // the English page keeps the English names it was built with (the worker sends the Arabic ones, owner 2026-10-15:
      // «الاسماء دي مترجمتش في النسخة الانجليزي»); a room added later shows its English when there is one
      if (!(EN && R.built)) { R.name = roomWord(s.name) || R.name; R.about = roomWord(s.about) || ''; }
      R.hue = s.hue; R.closed = !!s.closed; R.bg = s.bg || ''; R.bgBlur = s.bgBlur; R.bgDim = s.bgDim;
      if (s.id !== 'general') { R.mark = s.mark; $('.cm-mark', R.btn).textContent = s.mark; } else R.mark = $('.cm-mark', R.btn).innerHTML;
      R.btn.style.setProperty('--h', s.hue);
      $('b', R.btn).textContent = R.name;
      R.btn.classList.toggle('is-closed', R.closed);
      R.secret = !!s.secret; R.btn.classList.toggle('is-secret', R.secret);
      if (nav.children[i] !== R.btn) nav.insertBefore(R.btn, nav.children[i] || null);
    });
    Object.keys(ROOMS).forEach(function (id) { if (!keep[id]) { ROOMS[id].btn.remove(); delete ROOMS[id]; if (current === id) leaveRoom(); } });
    if (current && ROOMS[current]) { $('.cm-head-name').textContent = ROOMS[current].name; $('.cm-head').classList.toggle('is-secret', !!ROOMS[current].secret); setMuted(); paintBg(); }
    // a link to a room the page didn't know yet (added from the panel) opens it once the list arrives
    if (want && ROOMS[want] && current !== want) open(want, false);
    want = '';
  }

  // ── the rooms' list: who's in each, the last message ─────────────────────
  // what was being written in each room stays there (WhatsApp's «مسودة»)
  var drafts = store('arw-cm-drafts') || {}, draftT;
  function saveDraft() {
    if (!current || editing) return;
    var v = input.value;
    if (v.trim()) drafts[current] = v.slice(0, 2000); else delete drafts[current];
    clearTimeout(draftT); draftT = setTimeout(function () { store('arw-cm-drafts', drafts); }, 400);
  }
  function roomLine(R) {
    var last = $('.cm-room-last', R.btn), d = current !== R.id && drafts[R.id];
    last.textContent = '';
    if (d) { last.appendChild(el('span', 'cm-draft', 'مسودة: ')); last.appendChild(document.createTextNode(d.replace(/\s+/g, ' '))); }
    else last.textContent = R.last || R.about || '';
  }
  var summaryT;
  function summaries() {
    clearTimeout(summaryT);
    if (document.hidden) { summaryT = setTimeout(summaries, 30000); return; }
    // signed in: the secret rooms this member was added to come with the list (worker/src/chat.ts roomOpenTo)
    var sx = session();
    fetch(API + '/chat/rooms', { credentials: 'omit', headers: sx ? { Authorization: 'Bearer ' + sx.token } : {} }).then(function (r) { return r.json(); }).then(function (d) {
      var total = 0;
      syncRooms(d.rooms);
      (d.rooms || []).forEach(function (s) {
        var R = ROOMS[s.id];
        if (!R) return;
        total += s.online || 0;
        R.online = s.online || 0;
        var on = $('.cm-room-on', R.btn);
        on.hidden = !s.online; on.textContent = s.online ? String(s.online) : '';
        R.last = s.last ? (s.last.name + ': ' + (s.last.spoiler ? 'رسالة مخفية (حرق نتائج)' : s.last.kind && s.last.kind !== 'text' ? kindLabel(s.last.kind) + (s.last.text ? ' ' + s.last.text : '') : s.last.text)) : R.about;
        roomLine(R);
        // no «unread» outside a room (owner 2026-10-15: «مش عايز موضوع الرساله من بره غير مقروءه … الرسايل تتبعت عادي»):
        // no bold room, no green dot or count, just its last message
        if (current === s.id) setStatus();
      });
      var t = $('.cm-total');
      t.hidden = !total; $('.cm-total-n').textContent = total;
    }).catch(function () {}).then(function () { summaryT = setTimeout(summaries, 20000); });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopTyping(); return; }
    summaries(); unreadTitle(0); markSeen();
    if (current) { if (!ws || ws.readyState > 1) { retry = 0; connect(); } else probe(); }
  });
  // the phone lost and found the network: back at once, not after the next try
  window.addEventListener('online', function () { if (current && (!ws || ws.readyState > 1)) { retry = 0; connect(); } else if (ws) probe(); });
  window.addEventListener('offline', function () { if (current) conn('لا يوجد اتصال بالإنترنت، سترسل رسائلك عند عودته…'); });

  // ── one room ─────────────────────────────────────────────────────────────
  var current = null, ws = null, me = null, msgs = [], byId = {}, done = false, loadingMore = false, pinned = null, people = [], typing = {}, retry = 0, retryT, pingT, pongT, mutedUntil = 0, replyTo = null, editing = null, spoiler = false;
  var pending = {}; // nonce → {el, payload, ghost, sentAt, failed}
  var cache = {}; // room → what it showed (going back to a room shows it at once, then adds what's new)
  var firstHello = true, connecting = false;
  function open(room, push) {
    want = '';
    if (!ROOMS[room]) return;
    if (current === room && ws && ws.readyState <= 1) { showRoom(); return; }
    close(); closeFloat(); closeFocus();
    // an edit or a reply started elsewhere never follows into this room
    cancelEdit(); cancelReply();
    if (current !== room) input.value = '';
    current = room;
    var R = ROOMS[room];
    $$('.cm-room').forEach(function (b) { b.classList.toggle('is-on', b === R.btn); });
    R.btn.classList.remove('has-new'); $('.cm-room-new', R.btn).hidden = true;
    chat.classList.add('is-open');
    $('.cm-head').hidden = false;
    var mark = $('.cm-head-mark');
    mark.innerHTML = R.mark; mark.style.setProperty('--h', R.hue); mark.classList.toggle('cm-mark-logo', room === 'general');
    $('.cm-head').classList.toggle('is-secret', !!R.secret);
    paintBg();
    $('.cm-head-name').textContent = R.name;
    var c = cache[room];
    msgs = c ? c.msgs.slice() : []; byId = {}; msgs.forEach(function (m) { byId[m.id] = m; });
    done = c ? c.done : false; pinned = null; people = []; typing = {}; replyTo = null; pending = {}; firstHello = true;
    list.textContent = ''; $('.cm-more').hidden = true; $('.cm-pinned').hidden = true; $('.cm-jump').hidden = true;
    cancelReply(); clearAttached(); renderTyping(); setStatus('');
    if (c) { renderAll(); setPinned(c.pinned); toBottom(); }
    // what was being written here before
    input.value = drafts[room] || ''; autosize(); updateSendBtn(); roomLine(R);
    showRoom();
    if (push !== false && location.hash !== '#' + room) history.pushState({ room: room }, '', '#' + room);
    drawSound();
    document.title = R.name + ' | مجتمع المصارعة';
    if (!session()) { gate(true); return; }
    gate(false);
    compose.hidden = false; autosize();
    if (!store('arw-cm-rules')) rules();
    connect();
  }
  // a room this member may no longer open (a secret one they were taken out of): closed, back to the list
  function leaveRoom() {
    close(); cancelEdit(); cancelReply();
    current = null;
    chat.classList.remove('is-open', 'has-bg'); chat.removeAttribute('data-bg');
    $('.cm-head').hidden = true; compose.hidden = true; list.textContent = '';
    $$('.cm-room').forEach(function (b) { b.classList.remove('is-on'); });
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    showRooms();
  }
  function showRoom() { app.setAttribute('data-view', 'room'); document.body.classList.add('cm-in-room'); }
  function showRooms() {
    app.setAttribute('data-view', 'rooms'); document.body.classList.remove('cm-in-room'); closeFloat(); closeFocus();
    if (window.matchMedia('(max-width: 1150px)').matches) { close(); cancelEdit(); cancelReply(); current = null; $$('.cm-room').forEach(function (b) { b.classList.remove('is-on'); }); document.title = 'مجتمع المصارعة | عرب راسلنج'; }
  }
  function gate(on) {
    $('.cm-gate').hidden = !on;
    compose.hidden = on;
    if (on) {
      var back = encodeURIComponent('/community/' + (current ? '#' + current : ''));
      $('[data-join]').href = '/account/?new&back=' + back;
      $('[data-login]').href = '/account/?back=' + back;
      setStatus(ROOMS[current] ? ROOMS[current].about : '');
    }
  }
  function close() {
    clearTimeout(retryT); clearInterval(pingT); clearTimeout(pongT); connecting = false;
    stopTyping();
    if (current && msgs.length) cache[current] = { msgs: msgs.slice(-120), done: done && msgs.length <= 120, pinned: pinned };
    if (current && ROOMS[current]) { var was = current; setTimeout(function () { if (ROOMS[was]) roomLine(ROOMS[was]); }, 0); }
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch (e) {} ws = null; }
    stopRecording(true);
  }
  function conn(text) {
    var c = $('.cm-conn');
    if (!text) { if (c) c.remove(); return; }
    if (!c) { c = el('div', 'cm-conn'); chat.appendChild(c); }
    c.textContent = text;
  }
  // the next try: sooner at first, at most 15 seconds, never all at the same moment
  function later() { var d = Math.min(15000, 800 * Math.pow(2, retry++)) * (0.7 + Math.random() * 0.6); clearTimeout(retryT); retryT = setTimeout(connect, d); }
  function lastId() { for (var i = msgs.length - 1; i >= 0; i--) if (typeof msgs[i].id === 'number') return msgs[i].id; return 0; }
  function connect() {
    var s = session(), room = current;
    if (!s || !room || connecting) return;
    clearTimeout(retryT);
    connecting = true;
    if (!msgs.length) conn('جار الاتصال…');
    fetch(API + '/chat/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + s.token }, credentials: 'omit' })
      .then(function (r) { return r.json().then(function (d) { d.status = r.status; return d; }); })
      .then(function (d) {
        connecting = false;
        if (room !== current) return;
        if (d.status === 401) { gate(true); conn(''); return; }
        if (!d.ok) throw new Error(srv(d.error) || '');
        if (ws) { ws.onclose = null; try { ws.close(1000); } catch (x) {} }
        // coming back: the room sends what came after the last message here, the page keeps its place
        var since = lastId();
        var sock = new WebSocket(WS + '/chat/ws/' + room + '?ticket=' + d.ticket + (since ? '&since=' + since : ''));
        ws = sock;
        sock.onopen = function () { retry = 0; conn(''); clearInterval(pingT); pingT = setInterval(probe, 20000); };
        sock.onmessage = function (e) { alive(); if (e.data === 'pong') return; var m; try { m = JSON.parse(e.data); } catch (x) { return; } handle(m); };
        sock.onclose = function (e) {
          // an old socket closing late must not stop the new one's checks
          if (ws !== sock) return;
          clearInterval(pingT); clearTimeout(pongT);
          ws = null;
          if (e.code === 4003) { toast('تم إيقاف حسابك.'); gate(true); return; }
          // taken out of a secret room by the owner: out of it at once, and it leaves the list
          if (e.code === 4004) { toast('هذه المجموعة لم تعد متاحة لك.'); if (current === room) leaveRoom(); summaries(); return; }
          if (current === room) { conn(navigator.onLine === false ? 'لا يوجد اتصال بالإنترنت، سترسل رسائلك عند عودته…' : 'انقطع الاتصال، جار إعادة الاتصال…'); later(); }
        };
      })
      .catch(function () { connecting = false; if (current !== room) return; conn('تعذر الاتصال، جار إعادة المحاولة…'); later(); });
  }
  // a socket that went quiet without closing (a phone that slept, a network that changed): asked, and dropped if it
  // doesn't answer within 8 seconds, so a new one opens at once
  function probe() {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send('ping'); } catch (e) { return; }
    clearTimeout(pongT);
    var sock = ws;
    pongT = setTimeout(function () { if (ws === sock) { var h = sock.onclose; sock.onclose = null; try { sock.close(4000); } catch (e) {} if (h) h.call(sock, { code: 4000 }); } }, 8000);
  }
  function alive() { clearTimeout(pongT); }
  function wsSend(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); return true; } catch (e) {} } return false; }

  // ── what the room says ───────────────────────────────────────────────────
  function handle(d) {
    if (d.t === 'hello') {
      me = d.me; mutedUntil = d.me.muted || 0; setMuted();
      var got = d.msgs || [], wasBottom = nearBottom(), keep = scroller.scrollHeight - scroller.scrollTop;
      // coming back (or back to a room seen before): only what's new is added, and the reader stays where they were
      if (d.since && msgs.length && got.length && got[0].id <= d.since) {
        msgs = msgs.filter(function (m) { return m.id < got[0].id; }).concat(got);
      } else { msgs = got.slice(); done = !!d.done; }
      byId = {}; msgs.forEach(function (m) { byId[m.id] = m; });
      $('.cm-more').hidden = done;
      renderAll(); setPinned(d.pinned);
      // a room opens at its latest message
      if (firstHello || wasBottom) toBottom();
      else scroller.scrollTop = scroller.scrollHeight - keep;
      firstHello = false;
      markSeen(); renderStack();
      // what was written while away: sent again (the room knows each by its nonce, so nothing comes twice)
      Object.keys(pending).forEach(function (n) { var p = pending[n]; if (p.payload && !p.failed) push(p); });
      return;
    }
    if (d.t === 'msg') {
      var m = d.m;
      var p = d.nonce && pending[d.nonce];
      if (p) delete pending[d.nonce];
      if (byId[m.id]) { if (p && p.el && p.el.parentNode) p.el.remove(); return; }
      var near = nearBottom();
      // in order (a message can come back after one sent later)
      var at = msgs.length; while (at > 0 && msgs[at - 1].id > m.id) at--;
      msgs.splice(at, 0, m); byId[m.id] = m;
      // mine: the grey copy becomes the message, where it is
      if (p && p.el && p.el.parentNode) p.el.replaceWith(buildMsg(m, cont(m, msgs[at - 1])));
      else arrive(appendMsg(m));
      delete typing[m.uid]; renderTyping(); setStatus();
      var mine = me && m.uid === me.uid;
      if (!mine) ding('in');
      if (mine || near) toBottom(true); else bumpJump();
      // a long evening in one room: the oldest messages leave the page (they come back with «رسائل أقدم»)
      if (msgs.length > 600 && near) { msgs.splice(0, 200); byId = {}; msgs.forEach(function (x) { byId[x.id] = x; }); done = false; renderAll(); toBottom(); }
      markSeen();
      return;
    }
    if (d.t === 'edit') {
      var ed = byId[d.id];
      if (ed) { ed.text = d.text; ed.edited = d.edited; replaceMsg(ed); if (pinned && pinned.id === ed.id) setPinned(ed); }
      return;
    }
    if (d.t === 'react') { var x = byId[d.id]; if (x) { x.reacts = d.reacts; refreshReacts(x); } return; }
    if (d.t === 'del') {
      var y = byId[d.id];
      if (!y) return;
      if (d.gone) {
        // taken away by the site's account: as if it had never been written (and quotes of it go too)
        var keepY = scroller.scrollHeight - scroller.scrollTop, atEnd = nearBottom();
        msgs = msgs.filter(function (x) { return x !== y; }); delete byId[d.id];
        msgs.forEach(function (x) { if (x.reply && x.reply.id === d.id) x.reply = null; });
        renderAll();
        if (atEnd) toBottom(); else scroller.scrollTop = scroller.scrollHeight - keepY;
        return;
      }
      y.del = true; y.text = ''; y.att = null; y.reacts = {}; replaceMsg(y); return;
    }
    if (d.t === 'pin') { setPinned(d.m); return; }
    if (d.t === 'badge') { var hit = false; msgs.forEach(function (x) { if (x.uid === d.uid && x.badge !== d.badge) { x.badge = d.badge; hit = true; } }); if (me && me.uid === d.uid) me.badge = d.badge; if (hit) { var keep = scroller.scrollHeight - scroller.scrollTop; renderAll(); scroller.scrollTop = scroller.scrollHeight - keep; } return; }
    if (d.t === 'typing') {
      if (d.stop) delete typing[d.uid];
      else typing[d.uid] = { name: d.name, pic: d.pic, until: Date.now() + 6000 };
      renderTyping(); return;
    }
    if (d.t === 'presence') { people = d.people || []; Object.keys(typing).forEach(function (k) { if (!people.some(function (p) { return String(p.uid) === k; })) delete typing[k]; }); setStatus(); renderStack(); renderTyping(); return; }
    if (d.t === 'more') {
      loadingMore = false;
      var before = scroller.scrollHeight - scroller.scrollTop;
      (d.msgs || []).forEach(function (m) { if (!byId[m.id]) { byId[m.id] = m; msgs.push(m); } });
      msgs.sort(function (a, b) { return a.id - b.id; });
      done = !!d.done; $('.cm-more').hidden = done;
      renderAll();
      scroller.scrollTop = scroller.scrollHeight - before;
      if (wantJump) { var w = wantJump; wantJump = 0; jumpTo(w); }
      return;
    }
    if (d.t === 'muted') { mutedUntil = d.until || 0; setMuted(); return; }
    if (d.t === 'reported') { toast('شكرا لك، وصل بلاغك وسيراجعه فريق الموقع.'); return; }
    if (d.t === 'error') {
      // not sent: «too fast» can be tried again with a tap; the rest can't
      if (d.nonce && pending[d.nonce]) failed(pending[d.nonce], d.code === 'slow');
      if (d.code === 'muted') { mutedUntil = d.until || 0; setMuted(); }
      if (d.code === 'readonly' && ROOMS[current]) { ROOMS[current].closed = true; setMuted(); }
      toast(srv(d.error) || 'تعذر الإرسال.');
    }
  }
  function markSeen() {
    if (!current || !msgs.length || document.hidden || !nearBottom()) return;
    var id = lastId();
    if (id > (seen[current] || 0)) { seen[current] = id; store('arw-cm-seen', seen); }
  }
  var titleN = 0, baseTitle = document.title;
  function unreadTitle(n) {
    titleN = n ? titleN + n : 0;
    var t = current && ROOMS[current] ? ROOMS[current].name + ' | مجتمع المصارعة' : baseTitle;
    document.title = titleN ? '(' + titleN + ') ' + t : t;
  }

  // ── status line, people ──────────────────────────────────────────────────
  function setStatus(text) {
    var st = $('.cm-head-status');
    if (text != null && text !== undefined && arguments.length) { st.textContent = text; st.classList.remove('is-live', 'is-typing'); return; }
    var n = people.length || (ROOMS[current] && ROOMS[current].online) || 0;
    $('.cm-people-n').textContent = n ? String(n) : '';
    // someone writing: their name in the header, as WhatsApp does
    var names = Object.keys(typing).map(function (k) { return typing[k].name; });
    st.classList.toggle('is-typing', !!names.length);
    if (names.length) { st.textContent = typingText(names); st.classList.remove('is-live'); return; }
    st.textContent = n ? plural(n, 'متصل واحد الآن', 'اثنان متصلان الآن', 'متصلين الآن', 'متصلا الآن') : ROOMS[current] ? ROOMS[current].about : '';
    st.classList.toggle('is-live', !!n);
  }
  function renderStack() {
    var s = $('.cm-stack');
    s.textContent = '';
    people.slice(0, 4).forEach(function (p) { s.appendChild(avatar(p)); });
    $('.cm-people-btn').hidden = !people.length;
    var l = $('.cm-people-list');
    l.textContent = '';
    people.forEach(function (p) {
      var row = el('div', 'cm-person' + (typing[p.uid] ? ' is-typing' : ''));
      row.appendChild(avatar(p));
      var tx = el('span', 'cm-person-tx');
      var n = el('b', null, p.name);
      if (p.badge) { var b = el('span'); b.innerHTML = badge(p.badge); n.appendChild(b.firstChild); }
      tx.appendChild(n);
      tx.appendChild(el('small', null, typing[p.uid] ? 'يكتب…' : p.user ? '@' + p.user : ''));
      row.appendChild(tx);
      l.appendChild(row);
    });
  }
  // «فلان يكتب…» (owner 2026-10-15): their picture and name over the box, the dots moving; the header says it too
  var typingT, typingSig = '';
  function renderTyping() {
    var now = Date.now();
    Object.keys(typing).forEach(function (k) { if (typing[k].until < now) delete typing[k]; });
    var keys = Object.keys(typing), names = keys.map(function (k) { return typing[k].name; });
    var sig = keys.join(',');
    clearTimeout(typingT);
    if (keys.length) typingT = setTimeout(renderTyping, 1000);
    if (sig === typingSig) return;
    typingSig = sig;
    var box = $('.cm-typing');
    box.textContent = '';
    box.classList.toggle('is-on', !!keys.length);
    if (keys.length) {
      var avs = el('span', 'cm-typing-avs');
      keys.slice(0, 3).forEach(function (k) { avs.appendChild(avatar({ name: typing[k].name, pic: typing[k].pic })); });
      box.appendChild(avs);
      var bub = el('span', 'cm-typing-bub');
      bub.appendChild(el('span', 'cm-typing-tx', typingText(names)));
      var dots = el('i'); dots.innerHTML = '<b></b><b></b><b></b>';
      bub.appendChild(dots);
      box.appendChild(bub);
    }
    setStatus();
    if (!$('.cm-people-pop').hidden) renderStack();
  }

  // ── the messages ─────────────────────────────────────────────────────────
  function cont(m, prev) { return prev && !prev.del && !m.del && prev.uid === m.uid && m.at - prev.at < 5 * 60e3 && dayKey(m.at) === dayKey(prev.at); }
  function renderAll() {
    list.textContent = '';
    var frag = document.createDocumentFragment(), prev = null;
    msgs.forEach(function (m) {
      if (!prev || dayKey(prev.at) !== dayKey(m.at)) frag.appendChild(el('div', 'cm-day', dayLabel(m.at)));
      // «رسائل جديدة»: where the last visit stopped
      frag.appendChild(buildMsg(m, cont(m, prev)));
      prev = m;
    });
    list.appendChild(frag);
    if (!msgs.length && !Object.keys(pending).length) list.appendChild(el('div', 'cm-sys', 'لا رسائل بعد. كن أول من يكتب هنا 👋'));
    // mine still on their way stay at the end
    Object.keys(pending).forEach(function (n) { if (pending[n].el) list.appendChild(pending[n].el); });
  }
  // a message that comes in while mine are still on their way goes above them, where it belongs
  function appendMsg(m) {
    var i = msgs.indexOf(m), prev = msgs[i - 1];
    var sys = $('.cm-sys', list); if (sys) sys.remove();
    var before = list.querySelector('.cm-msg.is-pending, .cm-msg.is-failed');
    if (!prev || dayKey(prev.at) !== dayKey(m.at)) list.insertBefore(el('div', 'cm-day', dayLabel(m.at)), before);
    var row = buildMsg(m, cont(m, prev));
    list.insertBefore(row, before);
    return row;
  }
  // one that comes while the room is open slides in (once: moved later, e.g. mine kept at the end, it doesn't again)
  function arrive(row) {
    if (REDUCED) return;
    row.classList.add('is-new');
    row.addEventListener('animationend', function (e) { if (e.animationName === 'cm-msg-in') row.classList.remove('is-new'); });
  }
  function replaceMsg(m) {
    var old = list.querySelector('[data-id="' + m.id + '"]');
    if (!old) return;
    var i = msgs.indexOf(m);
    old.replaceWith(buildMsg(m, cont(m, msgs[i - 1])));
    var next = msgs[i + 1], nextEl = next && list.querySelector('[data-id="' + next.id + '"]');
    if (nextEl) nextEl.replaceWith(buildMsg(next, cont(next, m)));
  }
  function onlyEmoji(t) {
    if (!t || t.length > 40 || /[\p{L}\p{N}]/u.test(t.replace(/[‍️]/g, ''))) return false;
    var g = graphemes(t.replace(/\s+/g, ''));
    return g.length > 0 && g.length <= 3 && g.every(function (x) { return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(x); });
  }
  function textNode(t, mineName) {
    var p = el('p', 'cm-text');
    var re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|@[A-Za-zء-ي0-9_.]{3,20})/g, last = 0, mt;
    while ((mt = re.exec(t))) {
      if (mt.index > last) p.appendChild(document.createTextNode(t.slice(last, mt.index)));
      var s = mt[0];
      if (s.charAt(0) === '@') { p.appendChild(el('span', 'cm-mention', s)); }
      else {
        var url = s.replace(/[.,!?؟،)]+$/, ''), rest = s.slice(url.length);
        var a = el('a', null, url); a.href = /^www\./.test(url) ? 'https://' + url : url; a.target = '_blank'; a.rel = 'nofollow ugc noopener';
        p.appendChild(a); if (rest) p.appendChild(document.createTextNode(rest));
      }
      last = mt.index + s.length;
    }
    if (last < t.length) p.appendChild(document.createTextNode(t.slice(last)));
    return p;
  }
  // a sticker: the site's own (drawn here) or an animated emoji (its still self until the picture comes)
  function stickerNode(id) {
    var box = el('div', 'cm-stk');
    if (id.indexOf('noto:') === 0) {
      var code = id.slice(5), ch = '';
      try { ch = notoChar(code); } catch (e) {}
      box.classList.add('cm-stk-noto');
      var f = el('span', 'cm-stk-ch', ch); box.appendChild(f);
      var i = new Image(); i.alt = ch; i.width = 140; i.height = 140; i.loading = 'lazy'; i.decoding = 'async'; i.src = notoSrc(code);
      i.onload = function () { box.classList.add('is-ready'); };
      i.onerror = function () { i.remove(); };
      box.appendChild(i);
      return box;
    }
    var s = ARW_BY[id.slice(4)];
    if (!s) { box.appendChild(el('span', 'cm-stk-ch', '🌟')); return box; }
    box.classList.add('cm-stk-arw', s.i % 2 ? 'is-r' : 'is-l');
    box.style.setProperty('--sh', s.h);
    box.appendChild(el('span', 'cm-stk-e', s.e));
    box.appendChild(el('b', null, s.t));
    box.setAttribute('role', 'img'); box.setAttribute('aria-label', 'ملصق: ' + s.t);
    return box;
  }
  // a GIF: a short looping video, playing only while it's on screen
  var gifSeen = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { var v = e.target; if (e.isIntersecting && !REDUCED) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
  }, { threshold: 0.3 }) : null;
  function gifNode(a) {
    var v = document.createElement('video');
    v.className = 'cm-gif'; v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.preload = 'metadata'; if (a.still) v.poster = a.still; v.src = a.url; v.setAttribute('aria-label', 'صورة GIF');
    if (a.w && a.h) v.style.aspectRatio = a.w + ' / ' + a.h;
    if (gifSeen) gifSeen.observe(v); else if (!REDUCED) v.autoplay = true;
    v.addEventListener('click', function () { if (v.paused) v.play().catch(function () {}); else v.pause(); });
    return v;
  }
  function attNode(a, m) {
    if (a.kind === 'sticker') return stickerNode(a.id || '');
    if (a.kind === 'gif') return gifNode(a);
    if (a.kind === 'image') {
      var b = el('button', 'cm-img'); b.type = 'button'; b.setAttribute('aria-label', 'فتح الصورة');
      var img = new Image(); img.alt = 'صورة من ' + m.name; img.loading = 'lazy'; img.decoding = 'async'; img.src = a.url;
      if (a.w && a.h) { img.width = a.w; img.height = a.h; b.style.aspectRatio = a.w + ' / ' + a.h; }
      b.appendChild(img);
      b.addEventListener('click', function () { viewer(a.url); });
      return b;
    }
    if (a.kind === 'video') {
      var v = document.createElement('video'); v.className = 'cm-video'; v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.src = a.url;
      return v;
    }
    if (a.kind === 'voice') return voiceNode(a);
    var f = el('a', 'cm-file'); f.href = a.url; f.target = '_blank'; f.rel = 'noopener'; f.setAttribute('download', a.name || '');
    var ext = ((a.name || '').match(/\.([a-z0-9]+)$/i) || [, 'ملف'])[1].toUpperCase().slice(0, 4);
    var ic = el('span', 'cm-file-ic', ext); ic.style.setProperty('--fc', /PDF/.test(ext) ? '#d93a2b' : /DOC/.test(ext) ? '#2b6fd6' : /XLS/.test(ext) ? '#1f8a4c' : /PPT/.test(ext) ? '#d9661f' : /ZIP|RAR|7Z/.test(ext) ? '#7c6ee8' : '#0e9594');
    var tx = el('span', 'cm-file-tx'); var fn = el('b', null, (a.name || 'ملف').replace(/\.[a-z0-9]{1,5}$/i, '')); fn.dir = 'auto'; fn.title = a.name || ''; tx.appendChild(fn); tx.appendChild(el('small', null, size(a.size) + ' · تنزيل'));
    f.appendChild(ic); f.appendChild(tx);
    return f;
  }
  var playing = null;
  function voiceNode(a) {
    var box = el('div', 'cm-voice');
    var btn = el('button', 'cm-play'); btn.type = 'button'; btn.innerHTML = IC.play; btn.setAttribute('aria-label', 'تشغيل الرسالة الصوتية');
    var wave = el('div', 'cm-wave');
    var src = a.wave && a.wave.length ? a.wave : Array.apply(null, Array(32)).map(function (_, i) { return 30 + ((i * 37) % 50); });
    // 32 bars, the loudest of each stretch, scaled so the loudest one fills the line
    var bars = [], top = Math.max.apply(null, src.concat([1]));
    for (var k = 0; k < 32; k++) { var s0 = Math.floor(k * src.length / 32), s1 = Math.max(s0 + 1, Math.floor((k + 1) * src.length / 32)), mx = 0; for (var q = s0; q < s1 && q < src.length; q++) mx = Math.max(mx, src[q]); bars.push(mx / top * 100); }
    bars.forEach(function (h) { var i = el('i'); i.style.height = Math.max(16, Math.round(h)) + '%'; wave.appendChild(i); });
    var time = el('span', 'cm-vtime', mmss(a.dur));
    var speed = el('button', 'cm-speed', '1x'); speed.type = 'button'; speed.setAttribute('aria-label', 'سرعة التشغيل');
    var audio = null, rates = [1, 1.5, 2], ri = 0;
    function paint() {
      var p = audio && audio.duration && isFinite(audio.duration) ? audio.currentTime / audio.duration : 0;
      var n = Math.round(p * bars.length);
      Array.prototype.forEach.call(wave.children, function (b, i) { b.classList.toggle('is-past', i < n); });
      time.textContent = audio && audio.currentTime ? mmss(audio.currentTime) : mmss(a.dur);
    }
    function ensure() {
      if (audio) return audio;
      audio = new Audio(a.url); audio.preload = 'metadata'; audio.playbackRate = rates[ri];
      audio.addEventListener('timeupdate', paint);
      audio.addEventListener('ended', function () { btn.innerHTML = IC.play; audio.currentTime = 0; paint(); if (playing === audio) playing = null; });
      audio.addEventListener('pause', function () { btn.innerHTML = IC.play; });
      audio.addEventListener('play', function () { btn.innerHTML = IC.pause; });
      return audio;
    }
    btn.addEventListener('click', function () {
      var au = ensure();
      if (au.paused) { if (playing && playing !== au) playing.pause(); playing = au; au.play().catch(function () { toast('تعذر تشغيل الرسالة الصوتية.'); }); }
      else au.pause();
    });
    wave.addEventListener('click', function (e) {
      var au = ensure(), r = wave.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      var seek = function () { if (au.duration && isFinite(au.duration)) { au.currentTime = p * au.duration; paint(); } };
      if (au.readyState >= 1) seek(); else au.addEventListener('loadedmetadata', seek, { once: true });
    });
    speed.addEventListener('click', function () { ri = (ri + 1) % rates.length; speed.textContent = rates[ri] + 'x'; if (audio) audio.playbackRate = rates[ri]; });
    box.appendChild(btn); box.appendChild(wave); box.appendChild(time); box.appendChild(speed);
    return box;
  }
  function buildMsg(m, isCont) {
    var mine = me && m.uid === me.uid;
    var row = el('div', 'cm-msg');
    row.setAttribute('data-id', m.id);
    if (isCont) row.classList.add('is-cont');
    if (mine) row.classList.add('is-mine');
    if (m.badge === 'gold') row.classList.add('is-gold');
    if (isPrem(m.badge)) row.classList.add('is-prem');
    if (m.att && (m.att.kind === 'image' || m.att.kind === 'video' || m.att.kind === 'gif')) row.classList.add('is-media');
    if (m.att && m.att.kind === 'sticker' && !m.text) row.classList.add('is-sticker');
    if (me && me.user && !mine && m.text && new RegExp('@' + (me.user || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.])', 'i').test(m.text)) row.classList.add('mentions-me');
    row.appendChild(avatar(m));
    var bw = el('div', 'cm-bwrap');
    var bub = el('div', 'cm-bubble');
    if (!mine && !isCont) {
      var nm = el('div', 'cm-name');
      nm.style.setProperty('--nh', hueOf(m.user || m.name));
      var nmt = el('span', null, m.name); nmt.dir = 'auto'; nm.appendChild(nmt);
      if (m.badge) { var bg = el('span'); bg.innerHTML = badge(m.badge); bg.title = m.badge === 'gold' ? 'الحساب الرسمي لعرب راسلنج' : m.badge === 'vgold' || m.badge === 'gprem' ? 'عضو موثق بالعلامة الذهبية' : 'عضو موثق'; nm.appendChild(bg.firstChild); }
      if (isPrem(m.badge)) { var pc = el('a', 'cm-prem'); pc.href = (document.documentElement.lang === 'en' ? '/en' : '') + '/premium/'; pc.title = 'عضو مميز'; pc.innerHTML = CROWN; pc.appendChild(document.createTextNode('مميز')); nm.appendChild(pc); }
      bub.appendChild(nm);
    }
    if (m.del) {
      // deleted: it stays in its place, saying so (as WhatsApp and Messenger)
      var dl = el('p', 'cm-deleted'); dl.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>';
      dl.appendChild(document.createTextNode(mine ? 'حذفت هذه الرسالة' : 'تم حذف هذه الرسالة'));
      bub.appendChild(dl);
    } else {
      var body = el('div', 'cm-body');
      if (m.att) body.appendChild(attNode(m.att, m));
      if (m.text) {
        var big = !m.att && onlyEmoji(m.text);
        var tn = textNode(m.text);
        if (big) { tn.classList.add('cm-big'); row.classList.add('is-big'); }
        // words only, written the page's way: the time sits at the end of the last line when there's room (WhatsApp's)
        else if (!m.att && !m.spoiler) {
          var strong = m.text.match(/[A-Za-z\u00C0-\u024F\u0590-\u08FF]/);
          if (!strong || /[\u0590-\u08FF]/.test(strong[0]) === RTL) row.classList.add('is-text');
        }
        if (m.edited && !m.del) row.classList.add('is-edited');
        body.appendChild(tn);
      }
      if (m.spoiler) {
        var tag = el('span', 'cm-spoil-tag', '⚠️ حرق نتائج');
        bub.appendChild(tag);
        body.classList.add('cm-spoiler');
        var cover = el('button', 'cm-spoiler-cover', 'اضغط لإظهار الرسالة'); cover.type = 'button';
        cover.addEventListener('click', function (e) { e.stopPropagation(); body.classList.add('is-shown'); });
        body.appendChild(cover);
        if (mine) body.classList.add('is-shown');
      }
      bub.appendChild(body);
    }
    var meta = el('div', 'cm-meta');
    if (m.edited && !m.del) meta.appendChild(el('span', 'cm-edited', 'معدلة'));
    meta.appendChild(el('span', null, clock(m.at)));
    // mine: 🕓 on its way, ✓ sent, ! not sent (a tap sends it again)
    if (mine && !m.del) { var tk = el('span', 'cm-tick'); tk.innerHTML = m.pending ? IC.clock : IC.check; tk.setAttribute('aria-label', m.pending ? 'جار الإرسال' : 'تم الإرسال'); meta.appendChild(tk); }
    bub.appendChild(meta);
    // an answer (owner 2026-10-15: «زي ماسنجر … من غير البرتاح الخضرا»): «↩ رد على فلان» over it, the message it answers
    // as a faded bubble the answer sits on; a tap goes to it
    if (m.reply && !m.del) {
      var orig = byId[m.reply.id], toMe = !!(me && orig && orig.uid === me.uid);
      var cap = el('div', 'cm-reply-cap'); cap.innerHTML = IC.replyCap;
      cap.appendChild(document.createTextNode(mine ? (toMe ? 'رددت على نفسك' : 'رددت على ' + m.reply.name) : toMe ? 'رد عليك' : 'رد على ' + m.reply.name));
      var q = el('button', 'cm-quote'); q.type = 'button'; q.setAttribute('aria-label', 'اذهب إلى الرسالة الأصلية');
      var qt = el('span', null, m.reply.text || (m.reply.kind === 'text' ? 'رسالة مخفية (حرق نتائج)' : kindLabel(m.reply.kind))); qt.dir = 'auto';
      q.appendChild(qt);
      q.addEventListener('click', function () { jumpTo(m.reply.id); });
      bw.appendChild(cap); bw.appendChild(q);
      row.classList.add('has-quote');
    }
    bw.appendChild(bub);
    var rx = el('div', 'cm-reacts');
    bw.appendChild(rx);
    row.appendChild(bw);
    fillReacts(rx, m);
    if (!m.del || (me && me.mod)) addTools(row, m, mine);
    return row;
  }
  function fillReacts(box, m) {
    // the same as shown (the room's echo of mine): left as it is, so a chip popping in isn't cut short
    var sig = JSON.stringify(m.reacts || {}) + (me ? me.uid : '');
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig);
    box.textContent = '';
    var keys = Object.keys(m.reacts || {});
    keys.sort(function (a, b) { return m.reacts[b].length - m.reacts[a].length; });
    keys.forEach(function (k) {
      var b = el('button'); b.type = 'button';
      var mineR = me && m.reacts[k].indexOf(me.uid) >= 0;
      if (mineR) b.classList.add('is-mine');
      if (m.pop === k) b.classList.add('is-pop');
      b.appendChild(el('span', null, k));
      if (m.reacts[k].length > 1 || !mineR) b.appendChild(document.createTextNode(String(m.reacts[k].length)));
      b.title = mineR ? 'أنت' + (m.reacts[k].length > 1 ? ' و' + (m.reacts[k].length - 1) + ' آخرون' : '') : m.reacts[k].length + ' تفاعلات';
      b.addEventListener('click', function () { react(m, k); });
      box.appendChild(b);
    });
  }
  function refreshReacts(m) { var row = list.querySelector('[data-id="' + m.id + '"]'); if (row) fillReacts($('.cm-reacts', row), m); }
  function react(m, e) {
    if (typeof m.id !== 'number') return;
    if (!wsSend({ t: 'react', id: m.id, e: e })) return toast('لا يوجد اتصال الآن.');
    // shown at once, as the room will (one a person; the same again takes it back)
    if (me) {
      var r = {}, had = '';
      Object.keys(m.reacts || {}).forEach(function (k) { var l = m.reacts[k].filter(function (u) { if (u === me.uid) had = k; return u !== me.uid; }); if (l.length) r[k] = l; });
      if (had !== e) (r[e] = r[e] || []).push(me.uid);
      m.reacts = r; m.pop = had !== e ? e : ''; refreshReacts(m);
      setTimeout(function () { m.pop = ''; }, 600);
    }
    // the picked one stays first in the picker's «recent»
    var rec = store('arw-cm-recent') || []; rec = [e].concat(rec.filter(function (x) { return x !== e; })).slice(0, 24); store('arw-cm-recent', rec);
  }

  // mine can be edited or deleted for 6 hours after sending (owner 2026-10-15); the site's account deletes any, any time
  var WINDOW = 6 * 36e5;
  // the site's account edits any message, any time (and no «معدلة» shows), and deletes any for good
  function canEdit(m) { return !!(me && (m.uid === me.uid || me.mod) && typeof m.id === 'number' && !m.del && (me.mod || Date.now() - m.at < WINDOW) && (m.text || (m.att && m.att.kind !== 'sticker' && m.att.kind !== 'voice' && m.att.kind !== 'gif'))); }
  function canDelete(m) { return !!(me && typeof m.id === 'number' && (me.mod || (!m.del && m.uid === me.uid && Date.now() - m.at < WINDOW))); }
  // the tools of a message (owner 2026-10-15: «زي الماسنجر»). A pointer: ☺ ↩ ⋮ by its side on hover; ☺ floats the
  // reactions over it, ⋮ the options. A finger: a long press lifts the message (iOS), a swipe toward the middle answers it.
  var RTL = getComputedStyle(root).direction === 'rtl';
  function addTools(row, m, mine) {
    if (!TOUCH) {
      var tools = el('div', 'cm-tools');
      var acts = m.del ? [] : [['smile', 'تفاعل', reactPop], ['reply', 'ردّ', function () { startReply(m); }]];
      acts.push(['more', 'المزيد', menuPop]);
      acts.forEach(function (t) {
        var b = el('button'); b.type = 'button'; b.innerHTML = IC[t[0]]; b.setAttribute('aria-label', t[1]); b.title = t[1];
        b.addEventListener('click', function (e) { e.stopPropagation(); closePops(); t[2](m, row, b); });
        tools.appendChild(b);
      });
      $('.cm-bubble', row).appendChild(tools);
      row.addEventListener('dblclick', function (e) { if (!e.target.closest('a, button, video, .cm-voice')) react(m, '❤️'); });
      return;
    }
    var bub = $('.cm-bubble', row), x0 = 0, y0 = 0, lp = null, pressT = null, swiping = false, armed = false, fired = false;
    var canSwipe = !m.del && typeof m.id === 'number';
    // toward the middle of the room: an incoming one away from its side, mine away from mine
    var sign = (RTL ? -1 : 1) * (mine ? -1 : 1);
    var ic = el('span', 'cm-swipe-ic'); ic.innerHTML = IC.swipe; row.appendChild(ic);
    function release() { clearTimeout(lp); clearTimeout(pressT); lp = pressT = null; row.classList.remove('is-pressing'); }
    bub.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) return release();
      var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; swiping = false; armed = false; fired = false;
      // held: it sinks a little, then lifts out with the options
      pressT = setTimeout(function () { row.classList.add('is-pressing'); }, 110);
      lp = setTimeout(function () { lp = null; fired = true; if (navigator.vibrate) navigator.vibrate(10); focusMenu(m, row); }, 420);
    }, { passive: true });
    bub.addEventListener('touchmove', function (e) {
      var t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if ((lp || pressT) && (Math.abs(mx) > 8 || Math.abs(my) > 8)) release();
      if (!canSwipe || fired) return;
      if (!swiping && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) { swiping = true; row.classList.add('is-swiping'); }
      if (!swiping) return;
      // past the point it pulls harder (a rubber band), as in WhatsApp
      var d = Math.max(0, mx * sign);
      d = Math.min(110, d < 64 ? d : 64 + (d - 64) * 0.3);
      row.style.setProperty('--sx', (d * sign) + 'px');
      var k = Math.min(1, d / 64);
      ic.style.opacity = k; ic.style.transform = 'scale(' + (0.35 + 0.65 * k) + ')';
      if (d >= 64 && !armed) { armed = true; ic.classList.add('is-armed'); if (navigator.vibrate) navigator.vibrate(8); }
      else if (d < 54 && armed) { armed = false; ic.classList.remove('is-armed'); }
    }, { passive: true });
    function end(e) {
      // the long press opened the options: no tap after it
      if (fired && e && e.cancelable) e.preventDefault();
      release();
      if (swiping) {
        row.classList.remove('is-swiping'); row.style.setProperty('--sx', '0px');
        ic.style.opacity = ''; ic.style.transform = ''; ic.classList.remove('is-armed');
        if (armed) startReply(m);
      }
      swiping = false; armed = false;
    }
    bub.addEventListener('touchend', end);
    bub.addEventListener('touchcancel', end);
    bub.addEventListener('contextmenu', function (e) { if (!e.target.closest('a, img, video')) e.preventDefault(); });
  }

  // what can be done with a message: answering first, then copy, edit, pin; what can't be taken back after a line
  function actionsFor(m) {
    var mine = me && m.uid === me.uid, items = [], danger = [];
    if (!m.del) items.push(['reply', 'ردّ', function () { startReply(m); }]);
    if (m.text && !m.del) items.push(['copy', 'نسخ النص', function () { copy(m.text); }]);
    // mine for 6 hours (a picture's words too); the site's account any message
    if (canEdit(m)) items.push(['edit', 'تعديل الرسالة', function () { startEdit(m); }]);
    if (me && me.mod && !m.del) items.push(['pin', pinned && pinned.id === m.id ? 'إلغاء التثبيت' : 'تثبيت الرسالة', function () { wsSend({ t: 'pin', id: pinned && pinned.id === m.id ? 0 : m.id }); }]);
    // a deleted one (the site's account only gets here): taking it away for good is all there is to do
    if (canDelete(m)) danger.push(['trash', 'حذف الرسالة', function () { confirmDelete(m); }, 'is-danger']);
    if (!mine && !m.del) danger.push(['flag', 'إبلاغ عن الرسالة', function () { report(m); }, 'is-danger']);
    if (me && me.mod && !mine && !m.del && m.badge !== 'gold') danger.push(['flag', 'إيقاف ' + m.name + ' عن الكتابة', function () { muteFromRoom(m); }, 'is-danger']);
    if (items.length && danger.length) items.push(null);
    return items.concat(danger);
  }
  function menuNode(m, done) {
    var box = el('div', 'cm-menu'); box.setAttribute('role', 'menu');
    actionsFor(m).forEach(function (it) {
      if (!it) { box.appendChild(el('i', 'cm-menu-sep')); return; }
      var b = el('button', it[3] || null); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.appendChild(el('span', null, it[1]));
      var ic = el('span', 'cm-menu-ic'); ic.innerHTML = IC[it[0]] || ''; b.appendChild(ic);
      // done first: an answer's box takes the focus (and the phone's keyboard) right after
      b.addEventListener('click', function (e) { e.stopPropagation(); done(); it[2](); });
      box.appendChild(b);
    });
    return box;
  }
  // the six (Messenger's), then «+» for any other
  function reactBar(m, done) {
    var bar = el('div', 'cm-rbar'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'تفاعل');
    var mineR = me ? Object.keys(m.reacts || {}).filter(function (k) { return m.reacts[k].indexOf(me.uid) >= 0; })[0] : '';
    QUICK.forEach(function (e, i) {
      var b = el('button', e === mineR ? 'is-mine' : null, e); b.type = 'button'; b.setAttribute('aria-label', 'تفاعل ' + e); b.style.setProperty('--i', i);
      b.addEventListener('click', function (ev) { ev.stopPropagation(); react(m, e); done(); });
      bar.appendChild(b);
    });
    var plus = el('button', 'cm-rb-plus'); plus.type = 'button'; plus.setAttribute('aria-label', 'إيموجي آخر'); plus.style.setProperty('--i', QUICK.length);
    plus.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    plus.addEventListener('click', function (ev) { ev.stopPropagation(); done(); openEmoji(function (e) { react(m, e); }, true); });
    bar.appendChild(plus);
    return bar;
  }

  // a pointer: the reactions or the options float by the message; a click elsewhere, the message moving or Esc closes them
  var float = null;
  function closeFloat() {
    if (!float) return;
    var f = float; float = null;
    f.row.classList.remove('is-active');
    f.box.classList.add('is-out');
    setTimeout(function () { f.box.remove(); }, 170);
  }
  function openFloat(kind, row, node, anchor, x, prefer) {
    closeFloat();
    var box = el('div', 'cm-float'); box.appendChild(node);
    root.appendChild(box);
    var w = box.offsetWidth, h = box.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var b = scroller.getBoundingClientRect(), lo = Math.max(8, b.top + 6), hi = Math.min(vh - 8, b.bottom - 6);
    var above = anchor.top - h - 8, below = anchor.bottom + 8;
    var top = prefer === 'above' ? (above >= lo ? above : below) : (below + h <= hi ? below : above);
    top = Math.max(8, Math.min(vh - h - 8, top));
    var left = Math.max(8, Math.min(vw - w - 8, x - w / 2));
    box.style.left = left + 'px'; box.style.top = top + 'px';
    box.style.transformOrigin = Math.round(x - left) + 'px ' + (top < anchor.top ? '100%' : '0');
    row.classList.add('is-active');
    float = { kind: kind, box: box, row: row, y: row.getBoundingClientRect().top };
  }
  function reactPop(m, row, btn) {
    if (float && float.kind === 'react' && float.row === row) return closeFloat();
    var r = btn.getBoundingClientRect();
    openFloat('react', row, reactBar(m, closeFloat), $('.cm-bubble', row).getBoundingClientRect(), r.left + r.width / 2, 'above');
  }
  function menuPop(m, row, btn) {
    if (float && float.kind === 'menu' && float.row === row) return closeFloat();
    var r = btn.getBoundingClientRect(), b = scroller.getBoundingClientRect();
    openFloat('menu', row, menuNode(m, closeFloat), r, r.left + r.width / 2, r.top > (b.top + b.bottom) / 2 ? 'above' : 'below');
  }
  document.addEventListener('mousedown', function (e) { if (float && !float.box.contains(e.target) && !e.target.closest('.cm-tools')) closeFloat(); });
  scroller.addEventListener('scroll', function () { if (float && (!float.row.isConnected || Math.abs(float.row.getBoundingClientRect().top - float.y) > 2)) closeFloat(); }, { passive: true });
  window.addEventListener('resize', function () { closeFloat(); closeFocus(); });

  // a finger: a long press lifts the message over the blurred room, the reactions over it, the options under it (iOS),
  // moved up or down so all of it fits the screen
  var focus = null;
  function insets() {
    var p = el('div'); p.style.cssText = 'position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(p); var cs = getComputedStyle(p), r = [parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0]; p.remove(); return r;
  }
  function focusMenu(m, row) {
    if (focus || !row.isConnected) return;
    closeFloat(); closePops();
    var bw = $('.cm-bwrap', row);
    // measured as it stands, not sunk by the press
    bw.style.transition = 'none'; row.classList.remove('is-pressing');
    var rr = row.getBoundingClientRect(), br = bw.getBoundingClientRect();
    bw.style.transition = '';
    var mine = !!(me && m.uid === me.uid), right = RTL ? !mine : mine;
    var ov = el('div', 'cm-focus'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'خيارات الرسالة');
    var bg = el('div', 'cm-focus-bg'); ov.appendChild(bg);
    var c = row.cloneNode(true);
    $$('.cm-tools, .cm-swipe-ic', c).forEach(function (x) { x.remove(); });
    c.classList.remove('is-pressing', 'is-swiping', 'is-new', 'is-flash', 'is-active');
    c.classList.add('cm-focus-msg'); c.removeAttribute('data-id'); c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'left:' + rr.left + 'px;top:' + rr.top + 'px;width:' + rr.width + 'px';
    ov.appendChild(c);
    var bar = m.del ? null : reactBar(m, function () { fillReacts($('.cm-reacts', c), m); closeFocus(); });
    var menu = menuNode(m, closeFocus);
    if (bar) ov.appendChild(bar);
    if (menu.children.length) ov.appendChild(menu); else menu = null;
    root.appendChild(ov);
    var vv = window.visualViewport, ins = insets(), gap = 8;
    var vTop = (vv ? vv.offsetTop : 0) + ins[0] + 12, vBot = (vv ? vv.offsetTop + vv.height : window.innerHeight) - ins[1] - 12;
    var vw = document.documentElement.clientWidth;
    var barH = bar ? bar.offsetHeight + gap : 0, menuH = menu ? menu.offsetHeight + gap : 0;
    // a long message: as much of it as fits, fading out
    var h = br.height, space = vBot - vTop - barH - menuH;
    if (h > space) { h = Math.max(90, space); $('.cm-bwrap', c).style.maxHeight = h + 'px'; c.classList.add('is-clipped'); }
    var top = Math.min(Math.max(br.top, vTop + barH), vBot - menuH - h);
    var ox = right ? '100%' : '0';
    function place(n, y, oy) {
      var w = n.offsetWidth, x = right ? br.right - w : br.left;
      n.style.left = Math.max(10, Math.min(vw - w - 10, x)) + 'px'; n.style.top = y + 'px';
      n.style.transformOrigin = ox + ' ' + oy;
    }
    if (bar) place(bar, top - barH, '100%');
    if (menu) place(menu, top + h + gap, '0');
    c.style.transformOrigin = ox + ' 50%';
    c.style.transform = 'scale(.95)';
    row.style.visibility = 'hidden';
    focus = { ov: ov, row: row, c: c, at: Date.now() };
    void ov.offsetWidth;
    ov.classList.add('is-open');
    c.style.transform = 'translateY(' + (top - br.top) + 'px) scale(1)';
    bg.addEventListener('click', function () { if (focus && Date.now() - focus.at > 350) closeFocus(); });
    ov.addEventListener('touchmove', function (e) { if (!e.target.closest('.cm-menu')) e.preventDefault(); }, { passive: false });
  }
  function closeFocus() {
    var f = focus; if (!f) return; focus = null;
    f.ov.classList.remove('is-open'); f.ov.classList.add('is-closing');
    f.c.style.transform = 'translateY(0) scale(1)';
    setTimeout(function () { f.row.style.visibility = ''; f.ov.remove(); }, 320);
  }
  function copy(t) {
    var ok = function () { toast('تم النسخ'); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () {}); else ok();
  }
  function confirmDelete(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2>حذف الرسالة؟</h2><p>' + (me && me.mod ? 'ستحذف الرسالة نهائيا عند الجميع كأنها لم تكتب، ولا يمكن التراجع.' : 'ستحذف الرسالة عند الجميع، ولا يمكن التراجع.') + '</p><div class="cm-modal-btns"><button type="button" class="cm-btn" data-ok style="background:var(--coral)">احذف</button><button type="button" class="cm-btn cm-btn-ghost" data-no>إلغاء</button></div>';
    mo.hidden = false;
    var fin = function () { mo.hidden = true; card.innerHTML = keep; bindRules(); };
    card.querySelector('[data-ok]').onclick = function () { fin(); if (!wsSend({ t: 'del', id: m.id })) toast('لا يوجد اتصال الآن.'); };
    card.querySelector('[data-no]').onclick = fin;
  }
  // a report (owner 2026-10-15: «اسباب اختياريه … ممكن هو يكتب عادي ده او ده»): a reason picked, words written, or both
  var REASONS = ['إساءة أو سب', 'عنصرية أو تعصب', 'حرق نتائج بلا تحذير', 'إعلان أو رابط مشبوه', 'محتوى غير لائق', 'انتحال شخصية'];
  function report(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2>إبلاغ عن الرسالة</h2><p>اختر السبب، أو اكتبه بنفسك، أو الاثنين معا.</p><div class="cm-report-opts">' +
      REASONS.map(function (w) { return '<label><input type="radio" name="why" value="' + w + '"> ' + w + '</label>'; }).join('') +
      '</div><textarea class="cm-report-why" maxlength="300" placeholder="اكتب السبب أو أي تفاصيل تساعد فريق الموقع (اختياري)" aria-label="سبب البلاغ" dir="auto"></textarea>' +
      '<div class="cm-modal-btns"><button type="button" class="cm-btn" data-ok>إرسال البلاغ</button><button type="button" class="cm-btn cm-btn-ghost" data-no>إلغاء</button></div>';
    mo.hidden = false;
    var fin = function () { mo.hidden = true; card.innerHTML = keep; bindRules(); };
    var ta = card.querySelector('.cm-report-why');
    // a tap on the chosen one again un-chooses it
    Array.prototype.forEach.call(card.querySelectorAll('input[name="why"]'), function (r) {
      r.addEventListener('click', function () { if (r.dataset.was === '1') { r.checked = false; r.dataset.was = ''; } else { Array.prototype.forEach.call(card.querySelectorAll('input[name="why"]'), function (x) { x.dataset.was = ''; }); r.dataset.was = '1'; } });
    });
    card.querySelector('[data-ok]').onclick = function () {
      var w = card.querySelector('input:checked'), words = ta.value.replace(/\s+/g, ' ').trim();
      if (!w && !words) { toast('اختر سببا أو اكتبه.'); ta.focus(); return; }
      var why = (w ? w.value : '') + (w && words ? ': ' : '') + words;
      fin();
      if (!wsSend({ t: 'report', id: m.id, why: why })) toast('لا يوجد اتصال الآن.');
    };
    card.querySelector('[data-no]').onclick = fin;
  }
  // the site's own account: a member stopped from writing in every room, from here
  function muteFromRoom(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2></h2><p>لن يستطيع الكتابة في أي مجموعة حتى تنتهي المدة، ويمكنه القراءة.</p><div class="cm-report-opts">' +
      [[1, 'ساعة واحدة'], [24, 'يوم واحد'], [168, 'أسبوع واحد'], [720, 'شهر واحد'], [8760, 'سنة واحدة']].map(function (o, i) { return '<label><input type="radio" name="h" value="' + o[0] + '"' + (i === 1 ? ' checked' : '') + '> ' + o[1] + '</label>'; }).join('') +
      '</div><div class="cm-modal-btns"><button type="button" class="cm-btn" data-ok style="background:var(--coral)">أوقفه</button><button type="button" class="cm-btn cm-btn-ghost" data-no>إلغاء</button></div>';
    card.querySelector('h2').textContent = 'إيقاف ' + m.name + ' عن الكتابة';
    mo.hidden = false;
    var fin = function () { mo.hidden = true; card.innerHTML = keep; bindRules(); };
    card.querySelector('[data-no]').onclick = fin;
    card.querySelector('[data-ok]').onclick = function () {
      var h = Number((card.querySelector('input:checked') || {}).value || 24);
      fin();
      var s = session();
      fetch(API + '/chat/mod/mute', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s ? s.token : '') }, body: JSON.stringify({ uid: m.uid, hours: h }) })
        .then(function (r) { return r.json(); }).then(function (d) { toast(d.ok ? 'تم إيقافه عن الكتابة ✓' : (srv(d.error) || 'تعذر ذلك.')); })
        .catch(function () { toast('تعذر الاتصال.'); });
    };
  }
  function rules() { $('.cm-modal').hidden = false; }
  function bindRules() { var b = $('[data-act="rules-ok"]'); if (b) b.onclick = function () { $('.cm-modal').hidden = true; store('arw-cm-rules', 1); input.focus(); }; }
  bindRules();
  $('.cm-modal').addEventListener('click', function (e) { if (e.target === this && $('[data-act="rules-ok"]')) { this.hidden = true; store('arw-cm-rules', 1); } });

  // pinned, jumping, scrolling
  function setPinned(m) {
    pinned = m && !m.del ? m : null;
    var bar = $('.cm-pinned');
    bar.hidden = !pinned;
    if (!pinned) return;
    var tx = $('.cm-pinned-tx');
    tx.textContent = '';
    tx.appendChild(el('b', null, pinned.name));
    tx.appendChild(document.createTextNode(pinned.spoiler ? 'رسالة مخفية (حرق نتائج)' : pinned.text || (pinned.att ? kindLabel(pinned.att.kind) : '')));
    $('.cm-pinned-x').hidden = !(me && me.mod);
  }
  var wantJump = 0;
  function jumpTo(id) {
    var row = list.querySelector('[data-id="' + id + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
      return;
    }
    if (done || !msgs.length) return toast('الرسالة قديمة جدا أو محذوفة.');
    wantJump = id; more();
  }
  function more() {
    if (loadingMore || done || !msgs.length) return;
    loadingMore = true;
    if (!wsSend({ t: 'more', before: msgs[0].id })) loadingMore = false;
  }
  function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140; }
  function toBottom(smooth) {
    requestAnimationFrame(function () { scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); });
    jumpN = 0; $('.cm-jump').hidden = true; $('.cm-jump-n').hidden = true;
  }
  var jumpN = 0;
  function bumpJump() { jumpN++; var j = $('.cm-jump'), n = $('.cm-jump-n'); j.hidden = false; n.hidden = false; n.textContent = jumpN > 99 ? '99+' : String(jumpN); }
  scroller.addEventListener('scroll', function () {
    if (scroller.scrollTop < 60) more();
    if (nearBottom()) { jumpN = 0; $('.cm-jump').hidden = true; $('.cm-jump-n').hidden = true; markSeen(); }
    else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 500) $('.cm-jump').hidden = false;
  }, { passive: true });
  // pictures load after the list is drawn: stay at the bottom if that's where one was
  list.addEventListener('load', function () { if (nearBottomBefore) scroller.scrollTop = scroller.scrollHeight; }, true);
  var nearBottomBefore = true;
  scroller.addEventListener('scroll', function () { nearBottomBefore = nearBottom(); }, { passive: true });

  // ── writing ──────────────────────────────────────────────────────────────
  function startReply(m) {
    if (typeof m.id !== 'number' || m.del) return;
    if (editing) cancelEdit();
    replyTo = m;
    var r = $('.cm-replying'); r.hidden = false; r.classList.remove('is-edit');
    $('.cm-replying-ic', r).innerHTML = IC.replyCap;
    $('.cm-replying-tx b', r).textContent = me && m.uid === me.uid ? 'الرد على نفسك' : 'الرد على ' + m.name;
    $('.cm-replying-tx span', r).textContent = m.spoiler ? 'رسالة مخفية (حرق نتائج)' : m.text || (m.att ? kindLabel(m.att.kind) : '');
    input.focus();
  }
  function cancelReply() { replyTo = null; if (!editing) $('.cm-replying').hidden = true; }
  // editing one of mine: its words in the box, «تعديل الرسالة» over it; what was being written comes back after
  var draftBeforeEdit = '';
  function startEdit(m) {
    cancelReply();
    editing = m; draftBeforeEdit = input.value;
    var r = $('.cm-replying'); r.hidden = false; r.classList.add('is-edit');
    $('.cm-replying-ic', r).innerHTML = IC.edit;
    $('.cm-replying-tx b', r).textContent = me && m.uid !== me.uid ? 'تعديل رسالة ' + m.name : 'تعديل الرسالة';
    $('.cm-replying-tx span', r).textContent = m.text || kindLabel(m.att && m.att.kind);
    input.value = m.text || ''; autosize(); updateSendBtn();
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  function cancelEdit() {
    if (!editing) return;
    editing = null;
    var r = $('.cm-replying'); r.hidden = true; r.classList.remove('is-edit');
    input.value = draftBeforeEdit; draftBeforeEdit = ''; autosize(); updateSendBtn();
  }
  // as tall as what's written (not measured while the box is hidden, which would leave it a thin line)
  function autosize() { input.style.height = 'auto'; var h = input.scrollHeight; input.style.height = h ? Math.min(150, h) + 'px' : ''; }
  function canSend() { return !!(input.value.trim() || attached.length); }
  function updateSendBtn() {
    var s = canSend();
    sendBtn.classList.toggle('is-send', s);
    sendBtn.setAttribute('aria-label', s ? 'إرسال' : 'تسجيل رسالة صوتية');
    compose.classList.toggle('is-typing', !!input.value.trim());
  }
  // «يكتب»: said every 2.5 seconds while writing, taken back when the box empties, the message goes, or 5 quiet seconds pass
  var lastTyping = 0, typingStopT;
  function stopTyping() { clearTimeout(typingStopT); if (lastTyping) { lastTyping = 0; wsSend({ t: 'typing', stop: true }); } }
  input.addEventListener('input', function () {
    autosize(); updateSendBtn(); saveDraft(); mentionCheck();
    if (!input.value.trim() || editing) return stopTyping();
    if (Date.now() - lastTyping > 2500 && wsSend({ t: 'typing' })) lastTyping = Date.now();
    clearTimeout(typingStopT); typingStopT = setTimeout(stopTyping, 5000);
  });
  input.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== input) stopTyping(); }, 200); });
  input.addEventListener('focus', function () { if (TOUCH && !$('.cm-emoji-pop').hidden) closePops(); });
  input.addEventListener('keydown', function (e) {
    if (mentionKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !TOUCH && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { if (editing) cancelEdit(); else cancelReply(); }
    // ↑ in an empty box: edit my last message (as Discord)
    if (e.key === 'ArrowUp' && !input.value && !TOUCH && me) {
      for (var i = msgs.length - 1; i >= 0 && i > msgs.length - 30; i--) { var x = msgs[i]; if (x.uid === me.uid && x.text && canEdit(x)) { e.preventDefault(); startEdit(x); break; } }
    }
  });

  // @: the people here (and who wrote lately), to pick from
  var mention = null; // {from, items, at}
  function mentionCheck() {
    var pop = $('.cm-mention-pop'), pos = input.selectionStart || 0, before = input.value.slice(0, pos);
    var mt = before.match(/(^|\s)@([A-Za-z0-9_.ء-ي]{0,20})$/);
    if (!mt || !me) { mention = null; pop.hidden = true; return; }
    var q = mt[2].toLowerCase(), seenU = {}, list = [];
    var add = function (p) { if (!p || !p.user || p.uid === me.uid || seenU[p.uid]) return; seenU[p.uid] = 1; list.push({ uid: p.uid, user: p.user, name: p.name, pic: p.pic, badge: p.badge }); };
    people.forEach(add);
    for (var i = msgs.length - 1; i >= 0 && list.length < 60; i--) add(msgs[i]);
    list = list.filter(function (p) { return !q || p.user.toLowerCase().indexOf(q) === 0 || String(p.name).toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
    if (!list.length) { mention = null; pop.hidden = true; return; }
    mention = { from: pos - mt[2].length - 1, items: list, at: 0 };
    drawMention();
  }
  function drawMention() {
    var pop = $('.cm-mention-pop');
    pop.textContent = '';
    mention.items.forEach(function (p, i) {
      var b = el('button', 'cm-mention-row' + (i === mention.at ? ' is-on' : '')); b.type = 'button';
      b.appendChild(avatar(p));
      var tx = el('span', 'cm-person-tx'); tx.appendChild(el('b', null, p.name)); tx.appendChild(el('small', null, '@' + p.user)); b.appendChild(tx);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); pickMention(i); });
      pop.appendChild(b);
    });
    pop.hidden = false;
  }
  function pickMention(i) {
    var p = mention && mention.items[i]; if (!p) return;
    var pos = input.selectionStart || 0, t = '@' + p.user + ' ';
    input.value = input.value.slice(0, mention.from) + t + input.value.slice(pos);
    var c = mention.from + t.length; input.setSelectionRange(c, c);
    mention = null; $('.cm-mention-pop').hidden = true;
    autosize(); updateSendBtn(); saveDraft(); input.focus();
  }
  function mentionKey(e) {
    if (!mention) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mention.at = (mention.at + (e.key === 'ArrowDown' ? 1 : mention.items.length - 1)) % mention.items.length; drawMention(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mention.at); return true; }
    if (e.key === 'Escape') { mention = null; $('.cm-mention-pop').hidden = true; return true; }
    return false;
  }
  input.addEventListener('paste', function (e) {
    var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
    if (files.length) { e.preventDefault(); files.forEach(addImage); }
  });
  // a room the owner closed for writing: read only (the site's account still writes)
  function readOnly() { return !!(current && ROOMS[current] && ROOMS[current].closed && !(me && me.mod)); }
  function setMuted() {
    var muted = mutedUntil > Date.now(), ro = readOnly(), on = muted || ro;
    compose.classList.toggle('is-muted', on);
    var b = $('.cm-muted'); b.hidden = !on;
    if (ro) b.textContent = 'هذه المجموعة للقراءة فقط، والكتابة فيها لفريق الموقع.';
    else if (muted) { var d = new Date(mutedUntil); b.textContent = 'لا يمكنك الكتابة في المجتمع حتى ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + clock(mutedUntil) + '.'; }
  }
  var nonceN = 0;
  function send() {
    if (mutedUntil > Date.now() || readOnly()) return setMuted();
    var text = input.value.trim();
    if (editing) return sendEdit(text);
    var ready = attached.filter(function (a) { return a.att; });
    if (attached.some(function (a) { return !a.att && !a.failed; })) return toast('انتظر حتى يكتمل رفع المرفق.');
    if (!text && !ready.length) return;
    if (ready.length) ready.forEach(function (a, i) { dispatch(i === ready.length - 1 ? text : '', a.att); });
    else dispatch(text, null);
    input.value = ''; autosize(); cancelReply(); clearAttached(); saveDraft(); stopTyping();
    mention = null; $('.cm-mention-pop').hidden = true;
    if (spoiler) toggleSpoiler(false);
    updateSendBtn();
    if (!TOUCH) input.focus();
  }
  function sendEdit(text) {
    var m = editing;
    if (!text && !m.att) return toast('اكتب رسالتك أولا.');
    if (text !== m.text) {
      if (!wsSend({ t: 'edit', id: m.id, text: text })) return toast('لا يوجد اتصال الآن.');
      m.text = text; if (!me.mod) m.edited = Date.now(); replaceMsg(m);
    }
    draftBeforeEdit = drafts[current] || '';
    cancelEdit();
  }
  // a message on its way: shown at once (grey, 🕓), the room's copy takes its place when it arrives
  function dispatch(text, att) {
    if (mutedUntil > Date.now() || readOnly()) return setMuted();
    var nonce = 'n' + Date.now().toString(36) + (nonceN++) + Math.random().toString(36).slice(2, 6);
    var payload = { t: 'send', text: text, att: att, reply: replyTo ? replyTo.id : 0, spoiler: spoiler, nonce: nonce };
    var ghost = { id: 'p' + nonce, uid: me ? me.uid : 0, user: '', name: me ? me.name : '', pic: '', badge: '', text: text, att: att, reply: replyTo ? { id: replyTo.id, name: replyTo.name, text: (replyTo.text || '').slice(0, 140), kind: replyTo.att ? replyTo.att.kind : 'text' } : null, spoiler: spoiler, reacts: {}, at: Date.now(), pending: true };
    var sys = $('.cm-sys', list); if (sys) sys.remove();
    var days = list.querySelectorAll('.cm-day'), lastDay = days[days.length - 1];
    if (!lastDay || lastDay.textContent !== dayLabel(ghost.at)) list.appendChild(el('div', 'cm-day', dayLabel(ghost.at)));
    var ks = Object.keys(pending), prev = ks.length ? pending[ks[ks.length - 1]].ghost : msgs[msgs.length - 1];
    var row = buildMsg(ghost, cont(ghost, prev));
    row.classList.add('is-pending');
    row.setAttribute('data-nonce', nonce);
    list.appendChild(row);
    arrive(row);
    var p = pending[nonce] = { el: row, payload: payload, ghost: ghost, sentAt: 0, failed: false };
    if (!push(p)) { conn(navigator.onLine === false ? 'لا يوجد اتصال بالإنترنت، سترسل رسائلك عند عودته…' : 'انقطع الاتصال، سترسل الرسالة عند عودته…'); if (!ws && !connecting) { retry = 0; connect(); } }
    ding('out');
    toBottom(true);
  }
  function push(p) { if (wsSend(p.payload)) { p.sentAt = Date.now(); return true; } return false; }
  function failed(p, canRetry) {
    p.failed = true;
    if (!canRetry) p.payload = null;
    var row = p.el; if (!row) return;
    row.classList.remove('is-pending'); row.classList.add('is-failed');
    var tk = $('.cm-tick', row); if (tk) { tk.innerHTML = IC.alert; tk.setAttribute('aria-label', 'لم ترسل'); }
    row.title = canRetry ? 'لم ترسل الرسالة، اضغط لإعادة الإرسال' : 'لم ترسل الرسالة';
  }
  // a tap on a message that didn't go: again
  list.addEventListener('click', function (e) {
    var row = e.target.closest('.cm-msg.is-failed'); if (!row) return;
    var p = pending[row.getAttribute('data-nonce')]; if (!p) return;
    if (!p.payload) { row.remove(); delete pending[row.getAttribute('data-nonce')]; return; }
    p.failed = false; row.classList.remove('is-failed'); row.classList.add('is-pending'); row.title = '';
    var tk = $('.cm-tick', row); if (tk) tk.innerHTML = IC.clock;
    if (!push(p) && !ws && !connecting) { retry = 0; connect(); }
  });
  // one sent but not heard back in 15 seconds on an open socket: the socket is checked, the message shows «!»
  setInterval(function () {
    var now = Date.now(), late = false;
    Object.keys(pending).forEach(function (n) { var p = pending[n]; if (!p.failed && p.sentAt && now - p.sentAt > 15000) { failed(p, true); late = true; } });
    if (late) probe();
  }, 3000);
  function toggleSpoiler(on) {
    spoiler = on == null ? !spoiler : on;
    var b = $('[data-act="spoiler"]'); b.setAttribute('aria-pressed', String(spoiler));
    $('.cm-input').classList.toggle('is-spoiler', spoiler);
    input.placeholder = spoiler ? 'رسالة مخفية خلف تحذير «حرق نتائج»…' : 'اكتب رسالتك…';
    if (spoiler) toast('ستخفى رسالتك خلف تحذير «حرق نتائج»');
  }

  // attachments: a picture is made smaller in the browser before it goes up
  var attached = [];
  function clearAttached() { attached.forEach(function (a) { if (a.xhr) a.xhr.abort(); }); attached = []; drawAttached(); }
  function drawAttached() {
    var box = $('.cm-attached');
    box.textContent = '';
    box.hidden = !attached.length;
    attached.forEach(function (a) {
      var it = el('div', 'cm-att-item');
      if (a.preview) { var i = new Image(); i.src = a.preview; i.alt = ''; it.appendChild(i); }
      var tx = el('span', 'cm-file-tx');
      tx.appendChild(el('b', null, a.name));
      tx.appendChild(el('small', null, a.failed ? 'تعذر الرفع' : a.att ? 'جاهز ✓' : 'جار الرفع… ' + (a.pct || 0) + '%'));
      it.appendChild(tx);
      var x = el('button', 'cm-att-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'إزالة');
      x.addEventListener('click', function () { if (a.xhr) a.xhr.abort(); attached.splice(attached.indexOf(a), 1); drawAttached(); updateSendBtn(); });
      it.appendChild(x);
      box.appendChild(it);
    });
    updateSendBtn();
  }
  function upload(kind, blob, name, a) {
    return new Promise(function (resolve, reject) {
      var s = session(); if (!s) return reject(new Error('signed out'));
      var x = new XMLHttpRequest();
      if (a) a.xhr = x;
      x.open('POST', API + '/chat/upload?room=' + current + '&kind=' + kind);
      x.setRequestHeader('Authorization', 'Bearer ' + s.token);
      x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      if (name) x.setRequestHeader('X-File-Name', encodeURIComponent(name));
      x.upload.onprogress = function (e) { if (a && e.lengthComputable) { a.pct = Math.round(e.loaded / e.total * 100); drawAttached(); } };
      x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status === 200 && d.ok) resolve(d.att); else reject(new Error(srv(d.error) || 'تعذر الرفع.')); };
      x.onerror = function () { reject(new Error('تعذر الرفع، تحقق من الاتصال.')); };
      x.send(blob);
    });
  }
  function shrink(file) {
    return new Promise(function (resolve) {
      if (file.type === 'image/gif' || !/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve({ blob: file });
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var webp = c.toDataURL('image/webp', 0.1).indexOf('data:image/webp') === 0;
        c.toBlob(function (b) { resolve({ blob: b && b.size < file.size ? b : file, w: c.width, h: c.height }); }, webp ? 'image/webp' : 'image/jpeg', 0.84);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: file }); };
      img.src = url;
    });
  }
  function addImage(file) {
    if (attached.length >= 6) return toast('ستة مرفقات بحد أقصى في المرة الواحدة.');
    var a = { name: file.name || 'صورة', preview: URL.createObjectURL(file), pct: 0 };
    attached.push(a); drawAttached();
    shrink(file).then(function (r) {
      if (r.blob.size > 8 * 1024 * 1024) throw new Error('الصورة كبيرة، الحد الأقصى 8 ميجابايت.');
      return upload('image', r.blob, file.name, a).then(function (att) { if (r.w) { att.w = r.w; att.h = r.h; } return att; });
    }).then(function (att) { a.att = att; a.xhr = null; drawAttached(); })
      .catch(function (e) { a.failed = true; drawAttached(); toast(e.message || 'تعذر رفع الصورة.'); });
  }
  function addFile(file) {
    if (file.size > 15 * 1024 * 1024) return toast('الملف كبير، الحد الأقصى 15 ميجابايت.');
    var a = { name: file.name, pct: 0 };
    attached.push(a); drawAttached();
    upload('file', file, file.name, a).then(function (att) { a.att = att; a.xhr = null; drawAttached(); })
      .catch(function (e) { a.failed = true; drawAttached(); toast(e.message || 'تعذر رفع الملف.'); });
  }
  $('.cm-file-img').addEventListener('change', function () { Array.prototype.forEach.call(this.files, addImage); this.value = ''; });
  $('.cm-file-any').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) addFile(f); });

  // voice: recorded in the browser, its loudness drawn as it goes (and kept as the message's wave)
  var rec = null;
  function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('متصفحك لا يدعم تسجيل الصوت.');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      var type = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
      var mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = Ctx ? new Ctx() : null, an = null, buf = null;
      if (ctx) { an = ctx.createAnalyser(); an.fftSize = 512; buf = new Uint8Array(an.fftSize); ctx.createMediaStreamSource(stream).connect(an); }
      rec = { mr: mr, stream: stream, ctx: ctx, an: an, buf: buf, chunks: [], levels: [], t0: Date.now(), cancel: false };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec && rec.chunks.push(e.data); };
      mr.start(250);
      $('.cm-row').hidden = true; $('.cm-rec').hidden = false;
      var canvas = $('.cm-rec-wave'), g = canvas.getContext('2d');
      var color = getComputedStyle(canvas).color;
      (function frame() {
        if (!rec || rec.mr !== mr) return;
        var s = (Date.now() - rec.t0) / 1000;
        $('.cm-rec-time').textContent = mmss(s);
        var lvl = 0;
        if (rec.an) { rec.an.getByteTimeDomainData(rec.buf); var sum = 0; for (var i = 0; i < rec.buf.length; i++) { var v = (rec.buf[i] - 128) / 128; sum += v * v; } lvl = Math.min(1, Math.sqrt(sum / rec.buf.length) * 4); }
        rec.levels.push(lvl);
        var W = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1), H = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
        g.clearRect(0, 0, W, H); g.fillStyle = color;
        var bars = Math.floor(W / (6 * (window.devicePixelRatio || 1))), from = Math.max(0, rec.levels.length - bars);
        for (var j = from; j < rec.levels.length; j++) { var bh = Math.max(3, rec.levels[j] * H); var x = (j - from) * W / bars; g.fillRect(x, (H - bh) / 2, Math.max(2, W / bars - 2), bh); }
        if (s >= 300) return finishRecording();
        rec.raf = requestAnimationFrame(frame);
      })();
    }).catch(function () { toast('اسمح للمتصفح باستخدام الميكروفون لتسجيل رسالة صوتية.'); });
  }
  function stopRecording(cancel) {
    if (!rec) return null;
    var r = rec; rec = null;
    cancelAnimationFrame(r.raf);
    r.cancel = !!cancel;
    try { r.mr.stop(); } catch (e) {}
    r.stream.getTracks().forEach(function (t) { t.stop(); });
    if (r.ctx) r.ctx.close().catch(function () {});
    $('.cm-row').hidden = false; $('.cm-rec').hidden = true;
    return r;
  }
  function finishRecording() {
    var r = stopRecording(false);
    if (!r) return;
    var dur = (Date.now() - r.t0) / 1000;
    if (dur < 1) return toast('التسجيل قصير جدا.');
    // the wave: 40 bars from what was heard
    var wave = [], n = 40, L = r.levels;
    for (var i = 0; i < n; i++) { var a = Math.floor(i * L.length / n), b = Math.max(a + 1, Math.floor((i + 1) * L.length / n)), mx = 0; for (var j = a; j < b && j < L.length; j++) mx = Math.max(mx, L[j]); wave.push(Math.round(Math.min(1, mx) * 100)); }
    setTimeout(function () {
      var type = (r.mr.mimeType || 'audio/webm').split(';')[0];
      var blob = new Blob(r.chunks, { type: type });
      if (blob.size > 4 * 1024 * 1024) return toast('الرسالة الصوتية طويلة جدا.');
      var a = { name: 'رسالة صوتية ' + mmss(dur), pct: 0 };
      attached.push(a); drawAttached();
      upload('voice', blob, '', a).then(function (att) {
        att.dur = Math.round(dur); att.wave = wave;
        attached.splice(attached.indexOf(a), 1); drawAttached();
        // sent at once, as a voice note is (what was being written and attached stays)
        dispatch('', att); cancelReply();
      }).catch(function (e) { a.failed = true; drawAttached(); toast(e.message || 'تعذر إرسال الرسالة الصوتية.'); });
    }, 300);
  }

  // ── the picker (owner 2026-10-15: «ايموجي كتير جدا … بكل انواعها … استيكرات … ملصقات … gif») ──────────────
  // Three parts: every emoji (search in Arabic or English, skin tones), stickers, GIFs. On a computer it floats over the
  // box; on a phone it takes the keyboard's place under the box, as WhatsApp. For a reaction: the emoji only.
  var pk = $('.cm-emoji-pop'), emojiCb = null, pane = store('arw-cm-pane') || 'emoji', tone = Number(store('arw-cm-tone')) || 0;
  var emojiData = null, emojiLoading = null, recentDirty = true;
  var EMOJI_URL = root.getAttribute('data-emoji') || '/assets/emoji-data.json';
  function loadEmoji() {
    if (emojiData) return Promise.resolve(emojiData);
    if (!emojiLoading) emojiLoading = fetch(EMOJI_URL).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) { emojiData = d; return d; }).catch(function (e) { emojiLoading = null; throw e; });
    return emojiLoading;
  }
  function toned(e) { if (!tone) return e; var c = Array.from(e), rest = c.slice(1); if (rest[0] === '️') rest.shift(); return c[0] + TONES[tone] + rest.join(''); }
  function norm(t) { return String(t).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, ''); }
  function emojiBtns(rows) {
    return rows.map(function (r) { var e = r[0], sk = r[2] ? 1 : 0; return '<button type="button" data-e="' + e + '"' + (sk ? ' data-s="1"' : '') + '>' + (sk ? toned(e) : e) + '</button>'; }).join('');
  }
  function recentRows() { return (store('arw-cm-recent') || []).map(function (e) { return [e]; }); }
  function drawEmoji() {
    var grid = $('.cm-emoji-grid'), tabs = $('.cm-emoji-tabs');
    var cats = [];
    var rec = recentRows();
    if (rec.length) cats.push(['🕘', 'الأخيرة', rec]);
    cats.push(['🤼', 'المصارعة', graphemes(WRESTLING).map(function (e) { return [e]; })]);
    (emojiData || []).forEach(function (c, i) { cats.push([CAT_ICONS[i] || '•', c[0], c[1]]); });
    var html = '';
    cats.forEach(function (c, i) { html += '<section data-cat="' + i + '"><b>' + c[1] + '</b><div class="cm-eg">' + emojiBtns(c[2]) + '</div></section>'; });
    if (!emojiData) html += '<div class="cm-pk-wait"><span></span></div>';
    grid.innerHTML = html + '<section class="cm-eg-results" hidden><b>نتائج البحث</b><div class="cm-eg"></div></section>';
    tabs.textContent = '';
    cats.forEach(function (c, i) {
      var b = el('button', i === 0 ? 'is-on' : null, c[0]); b.type = 'button'; b.setAttribute('aria-label', c[1]); b.title = c[1];
      b.addEventListener('click', function () { var sec = grid.querySelector('[data-cat="' + i + '"]'); if (sec) grid.scrollTop = sec.offsetTop - grid.offsetTop; });
      tabs.appendChild(b);
    });
    $('.cm-tone').textContent = toned('👋');
    recentDirty = false;
    if (!emojiData) loadEmoji().then(function () { if (!pk.hidden) { var q = $('.cm-pk-pane[data-pane="emoji"] input').value; drawEmoji(); if (q) emojiSearch(q); } }).catch(function () { var w = $('.cm-pk-wait', grid); if (w) w.textContent = 'تعذر تحميل كل الإيموجي، تحقق من الاتصال.'; });
  }
  function emojiSearch(q) {
    var grid = $('.cm-emoji-grid'), res = $('.cm-eg-results', grid);
    q = norm(q.trim());
    grid.classList.toggle('is-search', !!q);
    res.hidden = !q;
    if (!q) return;
    // the name itself first (its first words), then a whole word, then the start of a word, then anywhere
    var hits = [], seenE = {}, n = 0;
    (emojiData || []).forEach(function (c) { c[1].forEach(function (r) {
      if (seenE[r[0]]) return;
      if (r[3] == null) r[3] = ' ' + norm(r[1]) + ' ';
      var at = r[3].indexOf(q); if (at < 0) return;
      seenE[r[0]] = 1;
      var whole = r[3].indexOf(' ' + q + ' ') >= 0, start = r[3].indexOf(' ' + q) >= 0;
      hits.push([at === 1 && whole ? 0 : at === 1 ? 1 : whole ? 2 : start ? 3 : 4, n++, r]);
    }); });
    hits.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
    var out = hits.slice(0, 160).map(function (h) { return h[2]; });
    var box = $('.cm-eg', res);
    box.innerHTML = out.length ? emojiBtns(out) : '';
    $('b', res).textContent = out.length ? 'نتائج البحث' : emojiData ? 'لا توجد نتائج، جرب كلمة أخرى' : 'جار التحميل…';
    grid.scrollTop = 0;
  }
  $('.cm-emoji-grid').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-e]'); if (!b) return;
    var ch = b.getAttribute('data-e'); if (b.hasAttribute('data-s')) ch = toned(ch);
    var r = store('arw-cm-recent') || []; r = [ch].concat(r.filter(function (x) { return x !== ch; })).slice(0, 36); store('arw-cm-recent', r); recentDirty = true;
    if (emojiCb) { var cb = emojiCb; closePops(); cb(ch); return; }
    insert(ch);
  });
  // the tab of the group being looked at
  $('.cm-emoji-grid').addEventListener('scroll', function () {
    var grid = this, secs = grid.querySelectorAll('section[data-cat]'), on = 0;
    for (var i = 0; i < secs.length; i++) if (secs[i].offsetTop - grid.offsetTop <= grid.scrollTop + 12) on = i;
    $$('.cm-emoji-tabs button').forEach(function (b, i) { b.classList.toggle('is-on', i === on); });
  }, { passive: true });
  var searchT;
  $('.cm-pk-pane[data-pane="emoji"] input').addEventListener('input', function () { var v = this.value; clearTimeout(searchT); searchT = setTimeout(function () { if (!emojiData && v.trim()) loadEmoji().then(function () { emojiSearch(v); }, function () {}); emojiSearch(v); }, 120); });
  $('.cm-tone').addEventListener('click', function () {
    tone = (tone + 1) % TONES.length; store('arw-cm-tone', tone);
    this.textContent = toned('👋');
    $$('.cm-emoji-grid button[data-s]').forEach(function (b) { b.textContent = toned(b.getAttribute('data-e')); });
  });

  // stickers: the site's pack and the animated ones, the last used first
  var stkPack = 'arw';
  function drawStickers() {
    var grid = $('.cm-stk-grid');
    grid.textContent = '';
    var rec = (store('arw-cm-stk') || []).filter(function (id) { return /^(arw:[a-z0-9-]+|noto:[0-9a-f_]+)$/.test(id); });
    var ids = stkPack === 'arw' ? ARW.map(function (x) { return 'arw:' + x[0]; }) : NOTO.map(function (c) { return 'noto:' + c; });
    var add = function (title, list) {
      if (!list.length) return;
      grid.appendChild(el('b', 'cm-stk-title', title));
      var box = el('div', 'cm-stk-list' + (stkPack === 'noto' && title !== 'الأخيرة' ? ' is-noto' : ''));
      list.forEach(function (id) {
        var b = el('button', 'cm-stk-pick'); b.type = 'button'; b.setAttribute('data-stk', id);
        if (id.indexOf('noto:') === 0) { var ch = ''; try { ch = notoChar(id.slice(5)); } catch (e) {} b.appendChild(el('span', 'cm-stk-ch', ch)); b.setAttribute('aria-label', 'ملصق ' + ch); }
        else { b.appendChild(stickerNode(id)); b.setAttribute('aria-label', 'ملصق ' + ((ARW_BY[id.slice(4)] || {}).t || '')); }
        box.appendChild(b);
      });
      grid.appendChild(box);
    };
    add('الأخيرة', rec.slice(0, 8));
    add(stkPack === 'arw' ? 'ملصقات عرب راسلنج' : 'ملصقات متحركة', ids);
    $$('.cm-stk-tabs button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-pack') === stkPack); });
  }
  $('.cm-stk-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-pack]'); if (!b) return; stkPack = b.getAttribute('data-pack'); drawStickers(); $('.cm-stk-grid').scrollTop = 0; });
  $('.cm-stk-grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-stk]'); if (!b) return;
    var id = b.getAttribute('data-stk');
    var r = store('arw-cm-stk') || []; r = [id].concat(r.filter(function (x) { return x !== id; })).slice(0, 16); store('arw-cm-stk', r);
    closePops();
    dispatch('', { kind: 'sticker', id: id }); cancelReply();
  });

  // GIFs: wrestling ones first, then whatever is searched for
  var gifQ = null, gifNext = '', gifBusy = false, gifSeq = 0;
  function gifLoad(q, more) {
    var s = session(); if (!s) return;
    if (more && (!gifNext || gifBusy)) return;
    var grid = $('.cm-gif-grid'), seq = ++gifSeq;
    if (!more) { gifQ = q; gifNext = ''; grid.textContent = ''; grid.appendChild(el('div', 'cm-pk-wait')).appendChild(el('span')); }
    gifBusy = true;
    fetch(API + '/chat/gif?q=' + encodeURIComponent(q) + (more ? '&pos=' + encodeURIComponent(gifNext) : ''), { headers: { Authorization: 'Bearer ' + s.token }, credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        gifBusy = false;
        if (seq !== gifSeq) return;
        var w = $('.cm-pk-wait', grid); if (w) w.remove();
        if (!d.ok) {
          grid.appendChild(el('p', 'cm-gif-note', d.setup ? 'البحث عن صور GIF سيتوفر قريبا. يمكنك الآن إرسال صورة GIF من جهازك بزر الإرفاق 📎.' : (srv(d.error) || 'تعذر تحميل صور GIF.')));
          return;
        }
        $('.cm-gif-by').textContent = d.by ? 'صور GIF بواسطة ' + d.by : '';
        gifNext = d.next || '';
        if (!more && !(d.items || []).length) grid.appendChild(el('p', 'cm-gif-note', 'لا توجد نتائج، جرب كلمة أخرى.'));
        (d.items || []).forEach(function (g) {
          var b = el('button', 'cm-gif-pick'); b.type = 'button'; b.setAttribute('aria-label', 'إرسال صورة GIF');
          b.style.aspectRatio = (g.w || 1) + ' / ' + (g.h || 1);
          var v = gifNode({ url: g.url, still: g.still, w: g.w, h: g.h }); v.preload = 'none'; v.removeAttribute('aria-label');
          b.appendChild(v);
          b.addEventListener('click', function () { closePops(); dispatch('', { kind: 'gif', url: g.url, still: g.still, w: g.w, h: g.h }); cancelReply(); });
          grid.appendChild(b);
        });
      })
      .catch(function () { gifBusy = false; if (seq !== gifSeq) return; var w = $('.cm-pk-wait', grid); if (w) w.remove(); if (!more) grid.appendChild(el('p', 'cm-gif-note', 'تعذر تحميل صور GIF، تحقق من الاتصال.')); });
  }
  (function () {
    var chips = $('.cm-gif-chips');
    GIF_TAGS.forEach(function (t) { var b = el('button', null, t[0]); b.type = 'button'; b.setAttribute('data-q', t[1]); chips.appendChild(b); });
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      $$('button', chips).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $('.cm-pk-pane[data-pane="gif"] input').value = '';
      gifLoad(b.getAttribute('data-q'));
    });
  })();
  var gifT;
  $('.cm-pk-pane[data-pane="gif"] input').addEventListener('input', function () {
    var v = this.value.trim(); clearTimeout(gifT);
    gifT = setTimeout(function () { $$('.cm-gif-chips button').forEach(function (x) { x.classList.remove('is-on'); }); gifLoad(v || 'wrestling'); }, 450);
  });
  $('.cm-gif-grid').addEventListener('scroll', function () { if (this.scrollTop + this.clientHeight > this.scrollHeight - 300) gifLoad(gifQ, true); }, { passive: true });

  function showPane(p) {
    pane = p;
    $$('.cm-pk-tabs [data-pane]').forEach(function (b) { var on = b.getAttribute('data-pane') === p; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
    $$('.cm-pk-pane').forEach(function (x) { x.hidden = x.getAttribute('data-pane') !== p; });
    if (p === 'emoji' && (recentDirty || !$('.cm-emoji-grid section'))) drawEmoji();
    if (p === 'stickers') drawStickers();
    if (p === 'gif' && gifQ === null) { var c = $('.cm-gif-chips button'); if (c) c.classList.add('is-on'); gifLoad('wrestling'); }
  }
  $('.cm-pk-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-pane]'); if (!b) return; showPane(b.getAttribute('data-pane')); store('arw-cm-pane', pane); });

  function insert(t) {
    var s = input.selectionStart == null ? input.value.length : input.selectionStart, e = input.selectionEnd == null ? s : input.selectionEnd;
    input.value = input.value.slice(0, s) + t + input.value.slice(e);
    var p = s + t.length;
    input.setSelectionRange(p, p);
    autosize(); updateSendBtn(); saveDraft();
    if (!TOUCH) input.focus();
  }
  // a floating card by its button (above it if there's room, else below); it follows the button if the page scrolls
  var placed = null;
  function place(pop, anchor, below) {
    placed = { pop: pop, anchor: anchor, below: !!below };
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var top = below ? r.bottom + 8 : r.top - ph - 10;
    if (!below && top < 8) top = r.bottom + 10;
    top = Math.max(8, Math.min(vh - ph - 8, top));
    var left = Math.min(vw - pw - 8, Math.max(8, r.right - pw));
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
  }
  function replace() { if (placed && !placed.pop.hidden && !placed.pop.classList.contains('is-dock')) place(placed.pop, placed.anchor, placed.below); }
  window.addEventListener('scroll', replace, { passive: true });
  window.addEventListener('resize', replace);
  function docked() { return window.matchMedia('(max-width: 1150px)').matches; }
  function openEmoji(cb, centered) {
    closePops();
    emojiCb = cb || null;
    var dock = docked(), stay = nearBottom();
    pk.classList.toggle('is-dock', dock); pk.classList.toggle('is-react', !!cb);
    if (dock && pk.parentNode !== chat) chat.appendChild(pk);
    else if (!dock && pk.parentNode !== root) root.appendChild(pk);
    pk.style.top = pk.style.left = '';
    pk.hidden = false;
    showPane(cb ? 'emoji' : pane);
    if (dock) { if (TOUCH) input.blur(); if (stay) requestAnimationFrame(function () { scroller.scrollTop = scroller.scrollHeight; }); }
    else place(pk, centered ? $('.cm-compose .cm-input') : $('[data-act="emoji"]'));
    if (!cb) $('[data-act="emoji"]').setAttribute('aria-expanded', 'true');
  }
  function closePops() {
    $$('.cm-pop').forEach(function (p) { p.hidden = true; });
    $$('[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    emojiCb = null;
    $$('.cm-gif-grid video').forEach(function (v) { v.pause(); });
  }
  document.addEventListener('click', function (e) {
    // a button the picker just drew again is no longer in the page: not a click outside
    if (!document.contains(e.target)) return;
    if (!e.target.closest('.cm-pop, [data-act="emoji"], [data-act="attach"], [data-act="people"], [data-act="mute"], .cm-float, .cm-focus')) closePops();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('.cm-viewer').hidden) return closeViewer();
    if (focus) return closeFocus();
    if (float) return closeFloat();
    closePops();
  });

  // a picture full size
  function viewer(url) { var v = $('.cm-viewer'); $('img', v).src = url; $('.cm-viewer-dl', v).href = url; v.hidden = false; }
  function closeViewer() { var v = $('.cm-viewer'); v.hidden = true; $('img', v).removeAttribute('src'); }
  $('.cm-viewer').addEventListener('click', function (e) { if (!e.target.closest('a')) closeViewer(); });

  // ── the buttons ──────────────────────────────────────────────────────────
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act], .cm-room');
    if (!b || !root.contains(b)) return;
    if (b.classList.contains('cm-room')) { open(b.getAttribute('data-room')); return; }
    var act = b.getAttribute('data-act');
    if (act === 'back') { if (history.state && history.state.room) history.back(); else { showRooms(); history.replaceState(null, '', location.pathname); } }
    else if (act === 'emoji') { if (pk.hidden || emojiCb) openEmoji(); else { closePops(); if (TOUCH) input.focus(); } }
    else if (act === 'mute') { var mp = $('.cm-mute-pop'); var wm = mp.hidden; closePops(); if (wm) { drawMute(); mp.hidden = false; place(mp, b, true); b.setAttribute('aria-expanded', 'true'); } }
    else if (act === 'attach') { var p = $('.cm-attach-pop'); var was = p.hidden; closePops(); if (was) { p.hidden = false; place(p, b); b.setAttribute('aria-expanded', 'true'); } }
    else if (act === 'pick-img') { closePops(); $('.cm-file-img').click(); }
    else if (act === 'pick-file') { closePops(); $('.cm-file-any').click(); }
    else if (act === 'spoiler') toggleSpoiler();
    else if (act === 'mic') { if (canSend()) send(); else startRecording(); }
    else if (act === 'rec-cancel') stopRecording(true);
    else if (act === 'rec-send') finishRecording();
    else if (act === 'cancel-reply') { if (editing) cancelEdit(); else cancelReply(); }
    else if (act === 'more') more();
    else if (act === 'jump') toBottom(true);
    else if (act === 'jump-pin') { if (pinned) jumpTo(pinned.id); }
    else if (act === 'unpin') wsSend({ t: 'pin', id: 0 });
    else if (act === 'people') { var pp = $('.cm-people-pop'); var w = pp.hidden; closePops(); if (w && people.length) { pp.hidden = false; place(pp, b, true); b.setAttribute('aria-expanded', 'true'); } }
    else if (act === 'rules') { e.preventDefault(); rules(); }
    else if (act === 'close-viewer') closeViewer();
  });
  window.addEventListener('popstate', function () {
    var r = location.hash.slice(1);
    if (ROOMS[r]) open(r, false); else showRooms();
  });
  window.addEventListener('resize', function () { if (!window.matchMedia('(max-width: 1150px)').matches) document.body.classList.remove('cm-in-room'); else if (app.getAttribute('data-view') === 'room') document.body.classList.add('cm-in-room'); });

  // ── sounds: a soft one for a message that comes, a lighter one for mine (made here, nothing to load) ──
  var actx = null;
  function soundOn() { var v = store('arw-cm-sound'); return v === null || v === undefined ? true : !!v; }
  // a room muted (owner 2026-10-15: «ميوت لجروب … من دقايق لساعات لايام او للابد»): no sound, no count in the tab's title,
  // its unread count greyed; until a time, or for good (-1)
  var mutes = store('arw-cm-mute') || {};
  function roomMuted(id) { var u = mutes[id]; return u === -1 || (u > Date.now()); }
  function drawSound() {
    var b = $('[data-act="mute"]'); if (!b) return;
    var off = !soundOn() || (current && roomMuted(current));
    b.classList.toggle('is-off', !!off);
    b.setAttribute('aria-label', current && roomMuted(current) ? 'المجموعة مكتومة' : 'كتم المجموعة'); b.title = b.getAttribute('aria-label');
    Object.keys(ROOMS).forEach(function (id) { ROOMS[id].btn.classList.toggle('is-muted', roomMuted(id)); });
  }
  function drawMute() {
    var pop = $('.cm-mute-pop'), u = mutes[current], on = current && roomMuted(current);
    var now = $('.cm-mute-now', pop);
    now.hidden = !on;
    if (on) now.textContent = u === -1 ? 'هذه المجموعة مكتومة دائما.' : 'مكتومة حتى ' + (dayKey(u) === dayKey(Date.now()) ? '' : new Date(u).getDate() + ' ' + MONTHS[new Date(u).getMonth()] + ' ') + clock(u) + '.';
    $('.cm-mute-off', pop).hidden = !on;
    $('input', pop).checked = soundOn();
  }
  $('.cm-mute-pop').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mute]'); if (!b || !current) return;
    var mins = Number(b.getAttribute('data-mute'));
    if (!mins) delete mutes[current]; else mutes[current] = mins < 0 ? -1 : Date.now() + mins * 60e3;
    store('arw-cm-mute', mutes); drawSound(); closePops();
    toast(!mins ? 'تم إلغاء كتم المجموعة' : mins < 0 ? 'تم كتم المجموعة دائما' : 'تم كتم المجموعة لمدة ' + b.textContent);
  });
  $('.cm-mute-pop input').addEventListener('change', function () { store('arw-cm-sound', this.checked ? 1 : 0); drawSound(); if (this.checked) ding('in'); });
  setInterval(drawSound, 60000);
  // the browser lets a page make sound only after a tap: the sound is made ready on the first one
  document.addEventListener('pointerdown', function () { if (!actx) { try { var C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } catch (e) {} } else if (actx.state === 'suspended') actx.resume().catch(function () {}); }, { passive: true });
  function ding(kind) {
    if (!actx || !soundOn() || document.hidden && kind === 'out' || kind === 'in' && current && roomMuted(current)) return;
    try {
      if (actx.state === 'suspended') actx.resume().catch(function () {});
      var t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(kind === 'out' ? 520 : 880, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'out' ? 780 : 620, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'out' ? 0.035 : 0.07, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.22);
    } catch (e) {}
  }
  drawSound();

  // a picture or a file dropped on the room (a computer)
  var dropN = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  chat.addEventListener('dragenter', function (e) { if (!hasFiles(e) || !current || !session() || compose.hidden) return; e.preventDefault(); dropN++; chat.classList.add('is-drop'); });
  chat.addEventListener('dragover', function (e) { if (hasFiles(e) && chat.classList.contains('is-drop')) e.preventDefault(); });
  chat.addEventListener('dragleave', function () { if (--dropN <= 0) { dropN = 0; chat.classList.remove('is-drop'); } });
  chat.addEventListener('drop', function (e) {
    if (!chat.classList.contains('is-drop')) return;
    e.preventDefault(); dropN = 0; chat.classList.remove('is-drop');
    if (mutedUntil > Date.now() || readOnly()) return setMuted();
    Array.prototype.forEach.call(e.dataTransfer.files || [], function (f) { if (/^image\//.test(f.type)) addImage(f); else addFile(f); });
  });

  // a phone's keyboard: the room is as tall as what's left above it, the last message stays in sight
  if (window.visualViewport) {
    var vv = window.visualViewport, fitVV = function () {
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      root.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
      if (nearBottomBefore) scroller.scrollTop = scroller.scrollHeight;
    };
    vv.addEventListener('resize', fitVV); vv.addEventListener('scroll', fitVV); fitVV();
  }

  // ── the start ────────────────────────────────────────────────────────────
  // the room fills the screen under the site's header
  function fit() { var h = document.querySelector('header'); if (h) root.style.setProperty('--cm-top', h.offsetHeight + 'px'); }
  fit(); window.addEventListener('resize', fit);
  summaries();
  var first = location.hash.slice(1);
  if (ROOMS[first]) { want = ''; open(first, false); }
  // a link to a room the page doesn't know yet (a secret one, one added from the panel): the main hall meanwhile, that
  // room once the list says this member may open it
  else if (!window.matchMedia('(max-width: 1150px)').matches) { var later = want; open('general', false); want = later; }
})();
