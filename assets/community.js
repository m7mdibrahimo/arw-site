// «مجتمع المصارعة» (owner 2026-10-14: «نظام دردشات للمسجلين في الموقع فقط … جروب لكل محبين كل اتحاد … يترد في وقتها
// مباشرة … يرفق صور او ملف وخانة ايموجي … وخانة الصوت … تفاعل علي الرسايل بالايموجي زي ماسنجر … ريبلاي علي الرسالة»).
// The page: pages/community.njk. The rooms: worker/src/chat.ts (a Durable Object each, over a WebSocket).
// A member's session is the one assets/account.js keeps (localStorage «arw-member»); it buys a one-minute ticket for the
// room's socket. Everything a person wrote is put on the page as text (textContent), never as markup.
(function () {
  'use strict';
  var root = document.getElementById('cm');
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
    swipe: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9 19 14l-5 5"/><path d="M19 14H9a5 5 0 0 1-5-5V5"/></svg>'
  };
  var EMOJI = [
    ['😀', 'وجوه', '😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽🤖'],
    ['👍', 'الأيدي', '👋🤚✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪🦾🫡🫶👀🧠🫵'],
    ['🤼', 'المصارعة', '🤼🏆🥇🥈🥉🏅🎖️👑🔔🎤🎙️🔥💥⚡💫⭐🌟✨🎉🎊🎆🏟️📺🎬🎥📣🥊🥋🏋️💯🆕🔝⏰🗓️🎟️💰💎🐐🦁🐍🦅🐺🦂🆚'],
    ['❤️', 'قلوب', '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝'],
    ['🇪🇬', 'أعلام', '🇪🇬🇸🇦🇦🇪🇰🇼🇶🇦🇧🇭🇴🇲🇯🇴🇱🇧🇸🇾🇮🇶🇵🇸🇾🇪🇱🇾🇹🇳🇩🇿🇲🇦🇸🇩🇲🇷🇺🇸🇯🇵🇲🇽🇬🇧🇨🇦'],
    ['✅', 'رموز', '✅❌⭕❗❓‼️⁉️💤💢💬💭🗯️🔴🟢🔵⚫⚪🎯📌📍🔗']
  ];
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
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(p)) return p;
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
  function badge(b) { return b === 'gold' || b === 'vgold' ? GOLD : b === 'blue' || b === 'premium' ? BLUE : ''; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ms) { var d = new Date(ms); var h = d.getHours(); return (h % 12 || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? ' ص' : ' م'); }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ms) {
    var d = new Date(ms), now = new Date();
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= t0) return 'اليوم';
    if (ms >= t0 - 864e5) return 'أمس';
    if (ms >= t0 - 6 * 864e5) return DAYS[d.getDay()];
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  function size(b) { b = Number(b) || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' ميجا' : Math.max(1, Math.round(b / 1024)) + ' كيلو'; }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function plural(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many; }

  // ── who's here ───────────────────────────────────────────────────────────
  function session() { var s = store('arw-member'); return s && s.token ? s : null; }
  var ROOMS = {};
  $$('.cm-room').forEach(function (b) {
    ROOMS[b.getAttribute('data-room')] = { id: b.getAttribute('data-room'), btn: b, name: $('b', b).textContent, about: $('.cm-room-last', b).textContent, hue: b.style.getPropertyValue('--h'), mark: $('.cm-mark', b).innerHTML };
  });
  var seen = store('arw-cm-seen') || {};
  // the list as the owner keeps it (the panel's «الغرف»): new rooms added, names and colours updated, hidden ones gone,
  // the owner's order kept. The page was built with the first list; /chat/rooms is the one in force.
  var nav = $('.cm-rooms');
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
      R.name = s.name || R.name; R.about = s.about || ''; R.hue = s.hue; R.closed = !!s.closed;
      if (s.id !== 'general') { R.mark = s.mark; $('.cm-mark', R.btn).textContent = s.mark; } else R.mark = $('.cm-mark', R.btn).innerHTML;
      R.btn.style.setProperty('--h', s.hue);
      $('b', R.btn).textContent = R.name;
      R.btn.classList.toggle('is-closed', R.closed);
      if (nav.children[i] !== R.btn) nav.insertBefore(R.btn, nav.children[i] || null);
    });
    Object.keys(ROOMS).forEach(function (id) { if (!keep[id]) { ROOMS[id].btn.remove(); delete ROOMS[id]; if (current === id) showRooms(); } });
    if (current && ROOMS[current]) { $('.cm-head-name').textContent = ROOMS[current].name; setMuted(); }
  }

  // ── the rooms' list: who's in each, the last message ─────────────────────
  var summaryT;
  function summaries() {
    clearTimeout(summaryT);
    if (document.hidden) { summaryT = setTimeout(summaries, 30000); return; }
    fetch(API + '/chat/rooms', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      var total = 0;
      syncRooms(d.rooms);
      (d.rooms || []).forEach(function (s) {
        var R = ROOMS[s.id];
        if (!R) return;
        total += s.online || 0;
        R.online = s.online || 0;
        var on = $('.cm-room-on', R.btn);
        on.hidden = !s.online; on.textContent = s.online ? String(s.online) : '';
        var last = $('.cm-room-last', R.btn);
        last.textContent = s.last ? (s.last.name + ': ' + (s.last.spoiler ? 'رسالة مخفية (حرق نتائج)' : s.last.kind === 'image' ? '📷 صورة' : s.last.kind === 'voice' ? '🎤 رسالة صوتية' : s.last.kind === 'file' || s.last.kind === 'video' ? '📎 ملف' : s.last.text)) : R.about;
        var fresh = s.lastId > (seen[s.id] || 0) && current !== s.id && session();
        R.btn.classList.toggle('has-new', !!fresh);
        $('.cm-room-new', R.btn).hidden = !fresh;
        if (current === s.id) setStatus();
      });
      var t = $('.cm-total');
      t.hidden = !total; $('.cm-total-n').textContent = total;
    }).catch(function () {}).then(function () { summaryT = setTimeout(summaries, 20000); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { summaries(); unreadTitle(0); if (current && (!ws || ws.readyState > 1)) connect(); } });

  // ── one room ─────────────────────────────────────────────────────────────
  var current = null, ws = null, me = null, msgs = [], byId = {}, done = false, loadingMore = false, pinned = null, people = [], typing = {}, retry = 0, retryT, pingT, mutedUntil = 0, replyTo = null, spoiler = false;
  var pending = {}; // nonce → element
  function open(room, push) {
    if (!ROOMS[room]) return;
    if (current === room && ws && ws.readyState <= 1) { showRoom(); return; }
    close();
    current = room;
    var R = ROOMS[room];
    $$('.cm-room').forEach(function (b) { b.classList.toggle('is-on', b === R.btn); });
    R.btn.classList.remove('has-new'); $('.cm-room-new', R.btn).hidden = true;
    chat.classList.add('is-open');
    $('.cm-head').hidden = false;
    var mark = $('.cm-head-mark');
    mark.innerHTML = R.mark; mark.style.setProperty('--h', R.hue); mark.classList.toggle('cm-mark-logo', room === 'general');
    $('.cm-head-name').textContent = R.name;
    msgs = []; byId = {}; done = false; pinned = null; people = []; typing = {}; replyTo = null; pending = {};
    list.textContent = ''; $('.cm-more').hidden = true; $('.cm-pinned').hidden = true; $('.cm-jump').hidden = true;
    cancelReply(); clearAttached(); renderTyping(); setStatus('');
    showRoom();
    if (push !== false && location.hash !== '#' + room) history.pushState({ room: room }, '', '#' + room);
    document.title = R.name + ' | مجتمع المصارعة';
    if (!session()) { gate(true); return; }
    gate(false);
    compose.hidden = false;
    if (!store('arw-cm-rules')) rules();
    connect();
  }
  function showRoom() { app.setAttribute('data-view', 'room'); document.body.classList.add('cm-in-room'); }
  function showRooms() {
    app.setAttribute('data-view', 'rooms'); document.body.classList.remove('cm-in-room');
    if (window.matchMedia('(max-width: 1150px)').matches) { close(); current = null; $$('.cm-room').forEach(function (b) { b.classList.remove('is-on'); }); document.title = 'مجتمع المصارعة | عرب راسلنج'; }
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
    clearTimeout(retryT); clearInterval(pingT);
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch (e) {} ws = null; }
    stopRecording(true);
  }
  function conn(text) {
    var c = $('.cm-conn');
    if (!text) { if (c) c.remove(); return; }
    if (!c) { c = el('div', 'cm-conn'); chat.appendChild(c); }
    c.textContent = text;
  }
  function connect() {
    var s = session(), room = current;
    if (!s || !room) return;
    clearTimeout(retryT);
    if (!msgs.length) conn('جار الاتصال…');
    fetch(API + '/chat/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + s.token }, credentials: 'omit' })
      .then(function (r) { return r.json().then(function (d) { d.status = r.status; return d; }); })
      .then(function (d) {
        if (room !== current) return;
        if (d.status === 401) { gate(true); conn(''); return; }
        if (!d.ok) throw new Error(d.error || '');
        var sock = new WebSocket(WS + '/chat/ws/' + room + '?ticket=' + d.ticket);
        ws = sock;
        sock.onopen = function () { retry = 0; conn(''); clearInterval(pingT); pingT = setInterval(function () { if (sock.readyState === 1) sock.send('ping'); }, 25000); };
        sock.onmessage = function (e) { if (e.data === 'pong') return; var m; try { m = JSON.parse(e.data); } catch (x) { return; } handle(m); };
        sock.onclose = function (e) {
          clearInterval(pingT);
          if (ws !== sock) return;
          ws = null;
          if (e.code === 4003) { toast('تم إيقاف حسابك.'); gate(true); return; }
          if (current === room) { conn('انقطع الاتصال، جار إعادة المحاولة…'); retryT = setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, retry++))); }
        };
      })
      .catch(function () { if (current !== room) return; conn('تعذر الاتصال، جار إعادة المحاولة…'); retryT = setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, retry++))); });
  }
  function wsSend(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }

  // ── what the room says ───────────────────────────────────────────────────
  function handle(d) {
    if (d.t === 'hello') {
      me = d.me; mutedUntil = d.me.muted || 0; setMuted();
      var atBottom = true;
      msgs = []; byId = {}; list.textContent = '';
      (d.msgs || []).forEach(function (m) { msgs.push(m); byId[m.id] = m; });
      done = !!d.done; $('.cm-more').hidden = done;
      renderAll(); setPinned(d.pinned);
      if (atBottom) toBottom();
      markSeen();
      // what was written while away (a reconnect): sent again
      Object.keys(pending).forEach(function (n) { var p = pending[n]; if (p.payload) wsSend(p.payload); });
      return;
    }
    if (d.t === 'msg') {
      var m = d.m;
      if (byId[m.id]) return;
      var near = nearBottom();
      if (d.nonce && pending[d.nonce]) { var p = pending[d.nonce]; if (p.el && p.el.parentNode) p.el.remove(); delete pending[d.nonce]; }
      msgs.push(m); byId[m.id] = m;
      appendMsg(m);
      delete typing[m.uid]; renderTyping();
      var mine = me && m.uid === me.uid;
      if (mine || near) toBottom(true); else bumpJump();
      if (!mine && document.hidden) unreadTitle(1);
      markSeen();
      return;
    }
    if (d.t === 'react') { var x = byId[d.id]; if (x) { x.reacts = d.reacts; refreshReacts(x); } return; }
    if (d.t === 'del') { var y = byId[d.id]; if (y) { y.del = true; y.text = ''; y.att = null; y.reacts = {}; replaceMsg(y); } return; }
    if (d.t === 'pin') { setPinned(d.m); return; }
    if (d.t === 'badge') { var hit = false; msgs.forEach(function (x) { if (x.uid === d.uid && x.badge !== d.badge) { x.badge = d.badge; hit = true; } }); if (me && me.uid === d.uid) me.badge = d.badge; if (hit) { var keep = scroller.scrollHeight - scroller.scrollTop; renderAll(); scroller.scrollTop = scroller.scrollHeight - keep; } return; }
    if (d.t === 'typing') { typing[d.uid] = { name: d.name, until: Date.now() + 4000 }; renderTyping(); return; }
    if (d.t === 'presence') { people = d.people || []; setStatus(); renderStack(); return; }
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
      if (d.nonce && pending[d.nonce]) { var f = pending[d.nonce]; f.payload = null; if (f.el) { f.el.classList.remove('is-pending'); f.el.classList.add('is-failed'); } delete pending[d.nonce]; }
      if (d.code === 'muted') { mutedUntil = d.until || 0; setMuted(); }
      if (d.code === 'readonly' && ROOMS[current]) { ROOMS[current].closed = true; setMuted(); }
      toast(d.error || 'تعذر الإرسال.');
    }
  }
  function markSeen() {
    if (!current || !msgs.length || document.hidden) return;
    seen[current] = msgs[msgs.length - 1].id; store('arw-cm-seen', seen);
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
    if (text != null && text !== undefined && arguments.length) { st.textContent = text; st.classList.remove('is-live'); return; }
    var names = Object.keys(typing).map(function (k) { return typing[k].name; });
    if (names.length) return;
    var n = people.length || (ROOMS[current] && ROOMS[current].online) || 0;
    st.textContent = n ? plural(n, 'متصل واحد الآن', 'اثنان متصلان الآن', 'متصلين الآن', 'متصلا الآن') : ROOMS[current] ? ROOMS[current].about : '';
    st.classList.toggle('is-live', !!n);
    $('.cm-people-n').textContent = n ? String(n) : '';
  }
  function renderStack() {
    var s = $('.cm-stack');
    s.textContent = '';
    people.slice(0, 4).forEach(function (p) { s.appendChild(avatar(p)); });
    $('.cm-people-btn').hidden = !people.length;
    var l = $('.cm-people-list');
    l.textContent = '';
    people.forEach(function (p) {
      var row = el('div', 'cm-person');
      row.appendChild(avatar(p));
      var n = el('span', null, p.name);
      row.appendChild(n);
      if (p.badge) { var b = el('span'); b.innerHTML = badge(p.badge); row.appendChild(b); }
      l.appendChild(row);
    });
  }
  var typingT;
  function renderTyping() {
    var now = Date.now();
    Object.keys(typing).forEach(function (k) { if (typing[k].until < now) delete typing[k]; });
    var names = Object.keys(typing).map(function (k) { return typing[k].name; });
    var box = $('.cm-typing');
    box.textContent = '';
    if (names.length) {
      var dots = el('i'); dots.innerHTML = '<b></b><b></b><b></b>';
      box.appendChild(dots);
      box.appendChild(document.createTextNode(names.length === 1 ? names[0] + ' يكتب…' : names.length === 2 ? names[0] + ' و' + names[1] + ' يكتبان…' : names.length + ' يكتبون الآن…'));
    }
    clearTimeout(typingT);
    if (names.length) typingT = setTimeout(renderTyping, 1500);
  }

  // ── the messages ─────────────────────────────────────────────────────────
  function cont(m, prev) { return prev && !prev.del && !m.del && prev.uid === m.uid && m.at - prev.at < 5 * 60e3 && dayKey(m.at) === dayKey(prev.at); }
  function renderAll() {
    list.textContent = '';
    var frag = document.createDocumentFragment(), prev = null;
    msgs.forEach(function (m) {
      if (!prev || dayKey(prev.at) !== dayKey(m.at)) frag.appendChild(el('div', 'cm-day', dayLabel(m.at)));
      frag.appendChild(buildMsg(m, cont(m, prev)));
      prev = m;
    });
    list.appendChild(frag);
    if (!msgs.length) list.appendChild(el('div', 'cm-sys', 'لا رسائل بعد. كن أول من يكتب هنا 👋'));
  }
  function appendMsg(m) {
    var i = msgs.indexOf(m), prev = msgs[i - 1];
    var sys = $('.cm-sys', list); if (sys) sys.remove();
    if (!prev || dayKey(prev.at) !== dayKey(m.at)) list.appendChild(el('div', 'cm-day', dayLabel(m.at)));
    list.appendChild(buildMsg(m, cont(m, prev)));
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
  function attNode(a, m) {
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
    if (m.badge === 'premium') row.classList.add('is-prem');
    if (m.att && (m.att.kind === 'image' || m.att.kind === 'video')) row.classList.add('is-media');
    if (me && me.user && !mine && m.text && new RegExp('@' + (me.user || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.])', 'i').test(m.text)) row.classList.add('mentions-me');
    row.appendChild(avatar(m));
    var bw = el('div', 'cm-bwrap');
    var bub = el('div', 'cm-bubble');
    if (!mine && !isCont) {
      var nm = el('div', 'cm-name');
      nm.style.setProperty('--nh', hueOf(m.user || m.name));
      nm.appendChild(el('span', null, m.name));
      if (m.badge) { var bg = el('span'); bg.innerHTML = badge(m.badge); bg.title = m.badge === 'gold' ? 'الحساب الرسمي لعرب راسلنج' : m.badge === 'vgold' ? 'عضو موثق بالعلامة الذهبية' : 'عضو موثق'; nm.appendChild(bg.firstChild); }
      if (m.badge === 'premium') { var pc = el('a', 'cm-prem'); pc.href = '/premium/'; pc.title = 'عضو مميز'; pc.innerHTML = CROWN; pc.appendChild(document.createTextNode('مميز')); nm.appendChild(pc); }
      bub.appendChild(nm);
    }
    if (m.del) {
      bub.appendChild(el('p', 'cm-deleted', mine ? 'حذفت هذه الرسالة' : 'تم حذف هذه الرسالة'));
    } else {
      if (m.reply) {
        var q = el('button', 'cm-quote'); q.type = 'button';
        q.appendChild(el('b', null, m.reply.name));
        q.appendChild(el('span', null, m.reply.text || (m.reply.kind === 'image' ? '📷 صورة' : m.reply.kind === 'voice' ? '🎤 رسالة صوتية' : m.reply.kind === 'text' ? 'رسالة مخفية (حرق نتائج)' : '📎 ملف')));
        q.addEventListener('click', function () { jumpTo(m.reply.id); });
        bub.appendChild(q);
      }
      var body = el('div', 'cm-body');
      if (m.att) body.appendChild(attNode(m.att, m));
      if (m.text) {
        var big = !m.att && onlyEmoji(m.text);
        var tn = textNode(m.text);
        if (big) { tn.classList.add('cm-big'); row.classList.add('is-big'); }
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
    var meta = el('div', 'cm-meta', clock(m.at));
    bub.appendChild(meta);
    bw.appendChild(bub);
    var rx = el('div', 'cm-reacts');
    bw.appendChild(rx);
    row.appendChild(bw);
    fillReacts(rx, m);
    if (!m.del) addTools(row, m, mine);
    return row;
  }
  function fillReacts(box, m) {
    box.textContent = '';
    var keys = Object.keys(m.reacts || {});
    keys.sort(function (a, b) { return m.reacts[b].length - m.reacts[a].length; });
    keys.forEach(function (k) {
      var b = el('button'); b.type = 'button';
      var mineR = me && m.reacts[k].indexOf(me.uid) >= 0;
      if (mineR) b.classList.add('is-mine');
      b.appendChild(el('span', null, k));
      if (m.reacts[k].length > 1 || !mineR) b.appendChild(document.createTextNode(String(m.reacts[k].length)));
      b.title = mineR ? 'أنت' + (m.reacts[k].length > 1 ? ' و' + (m.reacts[k].length - 1) + ' آخرون' : '') : m.reacts[k].length + ' تفاعل';
      b.addEventListener('click', function () { react(m, k); });
      box.appendChild(b);
    });
  }
  function refreshReacts(m) { var row = list.querySelector('[data-id="' + m.id + '"]'); if (row) fillReacts($('.cm-reacts', row), m); }
  function react(m, e) {
    if (!wsSend({ t: 'react', id: m.id, e: e })) return toast('لا يوجد اتصال الآن.');
    // the picked one stays first in the picker's «recent»
    var rec = store('arw-cm-recent') || []; rec = [e].concat(rec.filter(function (x) { return x !== e; })).slice(0, 24); store('arw-cm-recent', rec);
  }

  // a message's tools: hover (a pointer), long press and swipe (a finger)
  function addTools(row, m, mine) {
    if (!TOUCH) {
      var tools = el('div', 'cm-tools');
      var quick = el('div', 'cm-quick');
      QUICK.slice(0, 3).forEach(function (e) { var b = el('button', null, e); b.type = 'button'; b.setAttribute('aria-label', 'تفاعل ' + e); b.addEventListener('click', function () { react(m, e); }); quick.appendChild(b); });
      tools.appendChild(quick);
      [['smile', 'تفاعل', function () { sheet(m); }], ['reply', 'رد', function () { startReply(m); }], ['more', 'المزيد', function () { sheet(m); }]].forEach(function (t) {
        var b = el('button'); b.type = 'button'; b.innerHTML = IC[t[0]]; b.setAttribute('aria-label', t[1]); b.title = t[1]; b.addEventListener('click', t[2]); tools.appendChild(b);
      });
      $('.cm-bubble', row).appendChild(tools);
      row.addEventListener('dblclick', function (e) { if (!e.target.closest('a, button, video, .cm-voice')) react(m, '❤️'); });
      return;
    }
    var bub = $('.cm-bubble', row), t0 = 0, x0 = 0, y0 = 0, dx = 0, lp = null, swiping = false;
    var ic = el('span', 'cm-swipe-ic'); ic.innerHTML = IC.swipe; row.appendChild(ic);
    bub.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; t0 = Date.now(); x0 = t.clientX; y0 = t.clientY; dx = 0; swiping = false;
      lp = setTimeout(function () { lp = null; if (navigator.vibrate) navigator.vibrate(12); sheet(m); }, 430);
    }, { passive: true });
    bub.addEventListener('touchmove', function (e) {
      var t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if (lp && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { clearTimeout(lp); lp = null; }
      if (!swiping && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) swiping = true;
      if (!swiping) return;
      dx = Math.max(-90, Math.min(90, mx));
      bub.style.transform = 'translateX(' + dx + 'px)';
      ic.style.opacity = Math.min(1, Math.abs(dx) / 60);
      ic.style.transform = 'translateY(-50%) scale(' + (0.5 + Math.min(0.5, Math.abs(dx) / 120)) + ')';
    }, { passive: true });
    bub.addEventListener('touchend', function () {
      if (lp) { clearTimeout(lp); lp = null; }
      if (swiping && Math.abs(dx) > 60) { if (navigator.vibrate) navigator.vibrate(8); startReply(m); }
      bub.style.transition = 'transform .2s ease'; bub.style.transform = ''; ic.style.opacity = 0;
      setTimeout(function () { bub.style.transition = ''; }, 220);
      swiping = false;
    });
    bub.addEventListener('contextmenu', function (e) { if (!e.target.closest('a, img, video')) e.preventDefault(); });
  }

  // the options sheet: reactions on top, then what can be done
  var sheetFor = null;
  function sheet(m) {
    sheetFor = m;
    var s = $('.cm-sheet'), bar = $('.cm-react-bar', s), acts = $('.cm-sheet-acts', s);
    bar.textContent = ''; acts.textContent = '';
    var mineR = Object.keys(m.reacts || {}).filter(function (k) { return me && m.reacts[k].indexOf(me.uid) >= 0; })[0];
    QUICK.forEach(function (e) {
      var b = el('button', e === mineR ? 'is-mine' : null, e); b.type = 'button'; b.setAttribute('aria-label', 'تفاعل ' + e);
      b.addEventListener('click', function () { react(m, e); closeSheet(); });
      bar.appendChild(b);
    });
    var more = el('button', 'cm-react-more', '+'); more.type = 'button'; more.setAttribute('aria-label', 'إيموجي آخر');
    more.addEventListener('click', function () { closeSheet(); openEmoji(function (e) { react(m, e); }, true); });
    bar.appendChild(more);
    var mine = me && m.uid === me.uid;
    var items = [['reply', 'رد', function () { startReply(m); }]];
    if (m.text) items.push(['copy', 'نسخ النص', function () { copy(m.text); }]);
    if (me && me.mod) items.push(['pin', pinned && pinned.id === m.id ? 'إلغاء التثبيت' : 'تثبيت الرسالة', function () { wsSend({ t: 'pin', id: pinned && pinned.id === m.id ? 0 : m.id }); }]);
    if (mine || (me && me.mod)) items.push(['trash', 'حذف الرسالة', function () { confirmDelete(m); }, 'is-danger']);
    if (!mine) items.push(['flag', 'إبلاغ عن الرسالة', function () { report(m); }, 'is-danger']);
    if (me && me.mod && !mine && m.badge !== 'gold') items.push(['flag', 'إيقاف ' + m.name + ' عن الكتابة', function () { muteFromRoom(m); }, 'is-danger']);
    items.forEach(function (it) {
      var b = el('button', it[3] || null); b.type = 'button'; b.innerHTML = IC[it[0]] || '';
      b.appendChild(document.createTextNode(it[1]));
      b.addEventListener('click', function () { closeSheet(); it[2](); });
      acts.appendChild(b);
    });
    s.hidden = false;
    setTimeout(function () { var f = $('button', bar); if (f && !TOUCH) f.focus(); }, 30);
  }
  function closeSheet() { $('.cm-sheet').hidden = true; sheetFor = null; }
  $('.cm-sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  function copy(t) {
    var ok = function () { toast('تم النسخ'); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () {}); else ok();
  }
  function confirmDelete(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2>حذف الرسالة؟</h2><p>ستحذف الرسالة عند الجميع، ولا يمكن التراجع.</p><div class="cm-modal-btns"><button type="button" class="cm-btn" data-ok style="background:var(--coral)">احذف</button><button type="button" class="cm-btn cm-btn-ghost" data-no>إلغاء</button></div>';
    mo.hidden = false;
    var fin = function () { mo.hidden = true; card.innerHTML = keep; bindRules(); };
    card.querySelector('[data-ok]').onclick = function () { fin(); if (!wsSend({ t: 'del', id: m.id })) toast('لا يوجد اتصال الآن.'); };
    card.querySelector('[data-no]').onclick = fin;
  }
  function report(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2>إبلاغ عن الرسالة</h2><p>لماذا تبلغ عن هذه الرسالة؟</p><div class="cm-report-opts">' +
      ['إساءة أو سب', 'حرق نتائج بلا تحذير', 'إعلان أو رابط مشبوه', 'سبب آخر'].map(function (w, i) { return '<label><input type="radio" name="why" value="' + w + '"' + (i ? '' : ' checked') + '> ' + w + '</label>'; }).join('') +
      '</div><div class="cm-modal-btns"><button type="button" class="cm-btn" data-ok>إرسال البلاغ</button><button type="button" class="cm-btn cm-btn-ghost" data-no>إلغاء</button></div>';
    mo.hidden = false;
    var fin = function () { mo.hidden = true; card.innerHTML = keep; bindRules(); };
    card.querySelector('[data-ok]').onclick = function () { var w = card.querySelector('input:checked'); var why = w ? w.value : ''; fin(); if (!wsSend({ t: 'report', id: m.id, why: why })) toast('لا يوجد اتصال الآن.'); };
    card.querySelector('[data-no]').onclick = fin;
  }
  // the site's own account: a member stopped from writing in every room, from here
  function muteFromRoom(m) {
    var mo = $('.cm-modal'), card = $('.cm-modal-card', mo), keep = card.innerHTML;
    card.innerHTML = '<h2></h2><p>لن يستطيع الكتابة في أي غرفة حتى تنتهي المدة، ويمكنه القراءة.</p><div class="cm-report-opts">' +
      [[1, 'ساعة'], [24, 'يوم'], [168, 'أسبوع'], [720, 'شهر'], [8760, 'سنة']].map(function (o, i) { return '<label><input type="radio" name="h" value="' + o[0] + '"' + (i === 1 ? ' checked' : '') + '> ' + o[1] + '</label>'; }).join('') +
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
        .then(function (r) { return r.json(); }).then(function (d) { toast(d.ok ? 'تم إيقافه عن الكتابة ✓' : (d.error || 'تعذر ذلك.')); })
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
    tx.appendChild(document.createTextNode(pinned.spoiler ? 'رسالة مخفية (حرق نتائج)' : pinned.text || (pinned.att ? '📎 مرفق' : '')));
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
    replyTo = m;
    var r = $('.cm-replying'); r.hidden = false;
    $('b', r).textContent = 'رد على ' + m.name;
    $('span', r).textContent = m.spoiler ? 'رسالة مخفية (حرق نتائج)' : m.text || (m.att ? (m.att.kind === 'image' ? '📷 صورة' : m.att.kind === 'voice' ? '🎤 رسالة صوتية' : '📎 ملف') : '');
    input.focus();
  }
  function cancelReply() { replyTo = null; $('.cm-replying').hidden = true; }
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(150, input.scrollHeight) + 'px'; }
  function canSend() { return !!(input.value.trim() || attached.length); }
  function updateSendBtn() {
    var s = canSend();
    sendBtn.classList.toggle('is-send', s);
    sendBtn.setAttribute('aria-label', s ? 'إرسال' : 'تسجيل رسالة صوتية');
    compose.classList.toggle('is-typing', !!input.value.trim());
  }
  var lastTyping = 0;
  input.addEventListener('input', function () {
    autosize(); updateSendBtn();
    if (input.value.trim() && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); wsSend({ t: 'typing' }); }
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !TOUCH && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') cancelReply();
  });
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
    if (ro) b.textContent = 'هذه الغرفة للقراءة فقط، والكتابة فيها لفريق الموقع.';
    else if (muted) { var d = new Date(mutedUntil); b.textContent = 'لا يمكنك الكتابة في المجتمع حتى ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + clock(mutedUntil) + '.'; }
  }
  var nonceN = 0;
  function send() {
    if (mutedUntil > Date.now() || readOnly()) return setMuted();
    var text = input.value.trim();
    var ready = attached.filter(function (a) { return a.att; });
    if (attached.some(function (a) { return !a.att && !a.failed; })) return toast('انتظر حتى يكتمل رفع المرفق.');
    if (!text && !ready.length) return;
    var items = ready.length ? ready.map(function (a, i) { return { text: i === ready.length - 1 ? text : '', att: a.att }; }) : [{ text: text, att: null }];
    items.forEach(function (it) {
      var nonce = 'n' + Date.now().toString(36) + (nonceN++);
      var payload = { t: 'send', text: it.text, att: it.att, reply: replyTo ? replyTo.id : 0, spoiler: spoiler, nonce: nonce };
      var ghost = { id: 'p' + nonce, uid: me ? me.uid : 0, user: '', name: me ? me.name : '', pic: '', badge: '', text: it.text, att: it.att, reply: replyTo ? { id: replyTo.id, name: replyTo.name, text: replyTo.text.slice(0, 140), kind: replyTo.att ? replyTo.att.kind : 'text' } : null, spoiler: spoiler, reacts: {}, at: Date.now() };
      var row = buildMsg(ghost, cont(ghost, msgs[msgs.length - 1]));
      row.classList.add('is-pending');
      var sys = $('.cm-sys', list); if (sys) sys.remove();
      list.appendChild(row);
      pending[nonce] = { el: row, payload: payload };
      if (!wsSend(payload)) { conn('انقطع الاتصال، سترسل الرسالة عند عودته…'); if (!ws) connect(); }
    });
    input.value = ''; autosize(); cancelReply(); clearAttached();
    if (spoiler) toggleSpoiler(false);
    updateSendBtn(); toBottom(true);
    if (!TOUCH) input.focus();
  }
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
      x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status === 200 && d.ok) resolve(d.att); else reject(new Error(d.error || 'تعذر الرفع.')); };
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
        var keep = input.value, others = attached;
        input.value = ''; attached = [{ name: a.name, att: att }];
        send();
        input.value = keep; attached = others; drawAttached(); autosize(); updateSendBtn();
      }).catch(function (e) { a.failed = true; drawAttached(); toast(e.message || 'تعذر إرسال الرسالة الصوتية.'); });
    }, 300);
  }

  // the emoji picker (for writing, or for a reaction)
  var emojiCb = null, emojiTab = 0;
  function drawEmoji() {
    var tabs = $('.cm-emoji-tabs'), grid = $('.cm-emoji-grid');
    var rec = store('arw-cm-recent') || [];
    var cats = (rec.length ? [['🕘', 'الأخيرة', rec.join('')]] : []).concat(EMOJI);
    if (emojiTab >= cats.length) emojiTab = 0;
    tabs.textContent = '';
    cats.forEach(function (c, i) {
      var b = el('button', i === emojiTab ? 'is-on' : null, c[0]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', c[1]); b.title = c[1];
      b.addEventListener('click', function () { emojiTab = i; drawEmoji(); });
      tabs.appendChild(b);
    });
    grid.textContent = '';
    var c = cats[emojiTab];
    grid.appendChild(el('b', null, c[1]));
    graphemes(c[2]).forEach(function (e) {
      if (!e.trim()) return;
      var b = el('button', null, e); b.type = 'button';
      b.addEventListener('click', function () {
        var r = store('arw-cm-recent') || []; r = [e].concat(r.filter(function (x) { return x !== e; })).slice(0, 24); store('arw-cm-recent', r);
        if (emojiCb) { var cb = emojiCb; closePops(); cb(e); return; }
        insert(e);
      });
      grid.appendChild(b);
    });
    grid.scrollTop = 0;
  }
  function insert(t) {
    var s = input.selectionStart == null ? input.value.length : input.selectionStart, e = input.selectionEnd == null ? s : input.selectionEnd;
    input.value = input.value.slice(0, s) + t + input.value.slice(e);
    var p = s + t.length;
    input.setSelectionRange(p, p);
    autosize(); updateSendBtn();
    if (!TOUCH) input.focus();
  }
  function place(pop, anchor) {
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth;
    var top = r.top - ph - 10;
    if (top < 8) top = Math.min(window.innerHeight - ph - 8, r.bottom + 10);
    var left = Math.min(vw - pw - 8, Math.max(8, r.right - pw));
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
  }
  function openEmoji(cb, centered) {
    closePops();
    emojiCb = cb || null;
    var pop = $('.cm-emoji-pop'); pop.hidden = false; drawEmoji();
    var anchor = centered ? $('.cm-compose .cm-input') : $('[data-act="emoji"]');
    place(pop, anchor);
    if (!cb) $('[data-act="emoji"]').setAttribute('aria-expanded', 'true');
  }
  function closePops() {
    $$('.cm-pop').forEach(function (p) { p.hidden = true; });
    $$('[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    emojiCb = null;
  }
  document.addEventListener('click', function (e) {
    // a button the picker just drew again is no longer in the page: not a click outside
    if (!document.contains(e.target)) return;
    if (!e.target.closest('.cm-pop, [data-act="emoji"], [data-act="attach"], [data-act="people"], .cm-sheet')) closePops();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('.cm-viewer').hidden) return closeViewer();
    if (!$('.cm-sheet').hidden) return closeSheet();
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
    else if (act === 'emoji') { if ($('.cm-emoji-pop').hidden) openEmoji(); else closePops(); }
    else if (act === 'attach') { var p = $('.cm-attach-pop'); var was = p.hidden; closePops(); if (was) { p.hidden = false; place(p, b); b.setAttribute('aria-expanded', 'true'); } }
    else if (act === 'pick-img') { closePops(); $('.cm-file-img').click(); }
    else if (act === 'pick-file') { closePops(); $('.cm-file-any').click(); }
    else if (act === 'spoiler') toggleSpoiler();
    else if (act === 'mic') { if (canSend()) send(); else startRecording(); }
    else if (act === 'rec-cancel') stopRecording(true);
    else if (act === 'rec-send') finishRecording();
    else if (act === 'cancel-reply') cancelReply();
    else if (act === 'more') more();
    else if (act === 'jump') toBottom(true);
    else if (act === 'jump-pin') { if (pinned) jumpTo(pinned.id); }
    else if (act === 'unpin') wsSend({ t: 'pin', id: 0 });
    else if (act === 'people') { var pp = $('.cm-people-pop'); var w = pp.hidden; closePops(); if (w && people.length) { pp.hidden = false; place(pp, b); pp.style.top = (b.getBoundingClientRect().bottom + 8) + 'px'; b.setAttribute('aria-expanded', 'true'); } }
    else if (act === 'rules') { e.preventDefault(); rules(); }
    else if (act === 'close-viewer') closeViewer();
  });
  window.addEventListener('popstate', function () {
    var r = location.hash.slice(1);
    if (ROOMS[r]) open(r, false); else showRooms();
  });
  window.addEventListener('resize', function () { if (!window.matchMedia('(max-width: 1150px)').matches) document.body.classList.remove('cm-in-room'); else if (app.getAttribute('data-view') === 'room') document.body.classList.add('cm-in-room'); });

  // ── the start ────────────────────────────────────────────────────────────
  // the room fills the screen under the site's header
  function fit() { var h = document.querySelector('header'); if (h) root.style.setProperty('--cm-top', h.offsetHeight + 'px'); }
  fit(); window.addEventListener('resize', fit);
  summaries();
  var first = location.hash.slice(1);
  if (ROOMS[first]) open(first, false);
  else if (!window.matchMedia('(max-width: 1150px)').matches) open('general', false);
})();
