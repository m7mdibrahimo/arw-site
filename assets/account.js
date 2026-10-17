// The members' page, /account/ (owner 2026-10-14: «نظام التسجيل للمتابعيين … يكون احترافي جدا»): sign in, sign up
// (with the worker's captcha), «forgot my password» (by mail), the
// member's own page (name, picture, favourites, password). The worker: worker/src/members.ts. The browser keeps the
// session in localStorage «arw-member» ({token, member}); assets/features.js reads it for the header's button, and
// assets/comments.js to comment as the member.
(function () {
  'use strict';
  var root = document.getElementById('acct');
  if (!root) return;
  var API = root.getAttribute('data-api');
  var EN = document.documentElement.lang === 'en';
  var KEY = 'arw-member';
  // the stars' pictures' version (as in assets/comments.js): a new set shows at once
  var AV = root.getAttribute('data-avatars') ? '?v=' + root.getAttribute('data-avatars') : '';
  var EYE = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10 10 0 0 1 12 4c6.4 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  // ── the session ──────────────────────────────────────────────────────────
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  // a message from the worker, in English on the English pages (lib/i18n/server-en.cjs through assets/features.js)
  function srv(t) { if (!t) return ''; if (document.documentElement.lang !== 'en') return t; return (window.arwMsg && window.arwMsg(t)) || ''; }

  function save(s) {
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {}
    // the header follows at once (a new picture or name, signed in or out)
    try { window.dispatchEvent(new CustomEvent('arw-member')); } catch (e) {}
  }
  var session = load();
  function api(path, body, auth) {
    var h = { 'Content-Type': 'application/json' };
    if (auth && session) h.Authorization = 'Bearer ' + session.token;
    return fetch(API + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function signedIn(d) {
    session = { token: d.token, member: d.member }; subLoaded = false;
    save(session);
  }

  // ── views ────────────────────────────────────────────────────────────────
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function show(name) {
    $$('.acct-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name; });
    if (name === 'auth' || name === 'forgot') { var first = $('.acct-view[data-view="' + name + '"] .acct-form:not([hidden]) input'); if (first && window.innerWidth > 700) first.focus(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function say(form, text, kind) {
    var m = $('.acct-msg', form);
    m.textContent = text || '';
    m.classList.toggle('is-bad', kind === 'bad');
    m.classList.toggle('is-ok', kind === 'ok');
  }
  function busy(form, on) { var b = $('[type=submit]', form); if (b) b.disabled = on; }
  function tabs(view) {
    $$('.acct-tab', view).forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.acct-tab', view).forEach(function (x) { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', String(x === t)); });
        $$('.acct-form', view).forEach(function (f) { f.hidden = f.getAttribute('data-form') !== t.getAttribute('data-tab'); });
        var first = $('.acct-form:not([hidden]) input', view);
        if (first) first.focus();
        if (t.getAttribute('data-tab') === 'up') captcha();
      });
    });
  }
  tabs($('[data-view="auth"]'));
  tabs($('[data-view="forgot"]'));
  $$('.acct-eye').forEach(function (b) {
    b.innerHTML = EYE;
    b.addEventListener('click', function () {
      var i = b.parentNode.querySelector('input');
      var hidden = i.type === 'password';
      i.type = hidden ? 'text' : 'password';
      b.innerHTML = hidden ? EYE_OFF : EYE;
      b.setAttribute('aria-label', hidden ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    });
  });
  $$('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.getAttribute('data-go');
      if (to === 'home') { history.replaceState(null, '', location.pathname); start(); return; }
      if (to === 'profile') { if (waitingFor) { pending(waitingFor, waitingMail, true); return; } drawProfile(); show('profile'); return; }
      show(to);
    });
  });

  // ── the captcha ──────────────────────────────────────────────────────────
  var capId = '';
  function captcha() {
    var img = $('.acct-cap-img');
    img.innerHTML = '';
    api('/captcha').then(function (d) { capId = d.id || ''; img.innerHTML = d.svg || ''; var i = $('input[name=captcha]'); if (i) i.value = ''; });
  }
  $('.acct-cap-new').addEventListener('click', captcha);

  // ── a password's strength (a simple, honest guide) ───────────────────────
  var upPass = $('[data-form="up"] input[name=password]');
  upPass.addEventListener('input', function () {
    var p = upPass.value, s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[A-Za-zء-ي]/.test(p) && /[0-9٠-٩]/.test(p)) s++;
    if (/[^A-Za-z0-9ء-ي٠-٩]/.test(p)) s++;
    var bar = $('.acct-meter i'), tx = $('.acct-meter-tx');
    var steps = [['8%', 'var(--coral)', '8 حروف على الأقل، فيها حروف وأرقام.'], ['30%', 'var(--coral)', 'ضعيفة'], ['55%', 'var(--gold)', 'متوسطة'], ['80%', 'var(--teal)', 'جيدة'], ['100%', 'var(--teal)', 'قوية جدا']];
    var st = p ? steps[Math.min(4, s)] : steps[0];
    bar.style.width = p ? st[0] : '0';
    bar.style.background = st[1];
    tx.textContent = p ? 'كلمة المرور: ' + st[2] : steps[0][2];
  });

  // ── the forms ────────────────────────────────────────────────────────────
  function val(form, name) { var i = form.elements[name]; return i ? String(i.value || '').trim() : ''; }
  var forms = {};
  $$('.acct-form').forEach(function (f) { forms[f.getAttribute('data-form')] = f; });

  forms['in'].addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms['in'];
    if (!val(f, 'login') || !f.elements.password.value) { say(f, 'اكتب اسم المستخدم وكلمة المرور.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/login', { login: val(f, 'login'), password: f.elements.password.value }).then(function (d) {
      busy(f, false);
      if (d.unverified) { say(f, ''); pending({ login: val(f, 'login'), password: f.elements.password.value }, d.email, d.sent); f.reset(); return; }
      if (!d.ok) { say(f, srv(d.error) || 'تعذر الدخول، تأكد من البيانات.', 'bad'); return; }
      signedIn(d); say(f, ''); f.reset();
      done();
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  forms.up.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.up;
    $$('input', f).forEach(function (i) { i.classList.remove('is-bad'); });
    // the first and second names come first (owner 2026-10-18: «تكتب اسم الاول والاسم الثاني اول حاجة»)
    var fn = val(f, 'first_name'), ln = val(f, 'last_name');
    var u = val(f, 'username'), m = val(f, 'email'), p = f.elements.password.value, c = val(f, 'captcha');
    var missing = !fn ? 'first_name' : !ln ? 'last_name' : !u ? 'username' : !m ? 'email' : !p ? 'password' : !c ? 'captcha' : '';
    if (missing) { f.elements[missing].classList.add('is-bad'); f.elements[missing].focus(); say(f, 'أكمل كل الخانات.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/signup', { first_name: fn, last_name: ln, username: u, email: m, password: p, captcha: { id: capId, answer: c }, website: f.elements.website.value }).then(function (d) {
      busy(f, false);
      if (!d.ok) {
        say(f, srv(d.error) || 'تعذر إنشاء الحساب، حاول مرة أخرى.', 'bad');
        if (d.field && f.elements[d.field]) { f.elements[d.field].classList.add('is-bad'); f.elements[d.field].focus(); }
        captcha();
        return;
      }
      f.reset(); say(f, '');
      // no recovery code to save any more (owner 2026-10-16: «في ناس كتير مش فاهمه ده ايه اصلا وبتوقف عن مرحلة
      // التسجيل»): straight to «open your mail», or into the account. A forgotten password comes back by mail.
      if (d.pending) { pending({ login: u, password: p }, d.email, true); return; }
      signedIn(d);
      done();
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); captcha(); });
  });

  // waitingFor: an account that opens from the mail (the sign-in, kept in memory only to send the link again)
  var waitingFor = null, waitingMail = '';
  function pending(creds, email, sent) {
    waitingFor = creds; waitingMail = email || waitingMail;
    var v = $('[data-view="pending"]');
    $('.acct-pending-mail', v).textContent = waitingMail;
    var m = $('.acct-pending-msg', v);
    m.textContent = sent === false ? 'أرسلنا الرابط قبل قليل، افتح بريدك. يمكنك طلب رابط جديد بعد قليل.' : '';
    m.className = 'acct-msg acct-pending-msg';
    show('pending');
  }
  $('[data-act="resend"]').addEventListener('click', function () {
    var b = this, m = $('.acct-pending-msg');
    if (!waitingFor) { show('auth'); return; }
    b.disabled = true; m.textContent = 'لحظة…'; m.className = 'acct-msg acct-pending-msg';
    api('/login', waitingFor).then(function (d) {
      b.disabled = false;
      if (d.ok) { signedIn(d); waitingFor = null; done(); return; }
      m.textContent = d.sent ? 'أرسلنا رابطا جديدا ✓ افتح بريدك.' : d.unverified ? 'أرسلنا الرابط قبل قليل. انتظر دقائق ثم حاول مرة أخرى.' : (srv(d.error) || 'تعذر الإرسال، حاول مرة أخرى.');
      m.className = 'acct-msg acct-pending-msg ' + (d.sent ? 'is-ok' : 'is-bad');
    }).catch(function () { b.disabled = false; m.textContent = 'تعذر الاتصال، حاول مرة أخرى.'; m.className = 'acct-msg acct-pending-msg is-bad'; });
  });

  forms.mail.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.mail;
    if (!val(f, 'email')) { say(f, 'اكتب بريدك.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/forgot', { email: val(f, 'email') }).then(function (d) {
      busy(f, false);
      if (d.nomail) { say(f, 'الاسترجاع بالبريد غير متاح الآن، حاول بعد قليل أو تواصل معنا.', 'bad'); return; }
      if (!d.ok) { say(f, srv(d.error) || 'تعذر الإرسال، حاول مرة أخرى.', 'bad'); return; }
      say(f, 'إن كان لهذا البريد حساب، ستصلك رسالة خلال دقائق. افحص البريد غير المرغوب أيضا.', 'ok');
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  forms.reset.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.reset;
    var t = new URLSearchParams(location.search).get('reset') || '';
    busy(f, true); say(f, 'لحظة…');
    api('/reset', { token: t, password: f.elements.password.value }).then(function (d) {
      busy(f, false);
      if (!d.ok) { say(f, srv(d.error) || 'تعذر الحفظ، حاول مرة أخرى.', 'bad'); return; }
      signedIn(d);
      history.replaceState(null, '', location.pathname);
      done();
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  // ── the member's page ────────────────────────────────────────────────────
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function since(ms) { var d = new Date(ms); return EN ? 'Member since ' + d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'عضو منذ ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function initial(n) { return (String(n).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase(); }
  function picSrc(pic) {
    pic = String(pic || '');
    if (pic === 'official') return EN ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png';
    if (/^w:[a-z0-9-]+$/.test(pic)) return '/avatars/' + pic.slice(2) + '.webp' + AV;
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/(comments\/pic\/\d+\.webp|members\/pic\/\d+\/[a-f0-9]{16}\.(webp|jpg|png))$/.test(pic)) return pic;
    return '';
  }
  function avatar(el, m) {
    var src = picSrc(m.pic);
    el.innerHTML = '';
    if (src) { var i = document.createElement('img'); i.alt = ''; i.src = src; i.onerror = function () { el.textContent = initial(m.display); }; el.appendChild(i); }
    else el.textContent = initial(m.display);
  }
  function drawProfile() {
    var m = session.member, v = $('[data-view="profile"]');
    avatar($('.acct-av-in', v), m);
    $('.acct-me-name', v).textContent = m.display;
    $('.acct-me-user', v).textContent = '@' + m.username;
    $('.acct-me-since', v).textContent = since(m.created);
    $('.acct-verify', v).hidden = !!m.verified || !mailOn;
    // the site's own account: the gold badge; its name and picture stay as the site's
    v.classList.toggle('is-official', !!m.official);
    v.classList.toggle('is-goldv', !!m.gold);
    var prem = !m.official && Number(m.premium) > Date.now();
    v.classList.toggle('is-prem', prem);
    $('.acct-badge span', v).textContent = m.official ? 'الحساب الرسمي' : m.gold ? 'موثق بالعلامة الذهبية' : prem ? 'عضو مميز' : 'حساب موثق';
    $('.acct-badge', v).hidden = !m.official && m.blue === false && !(Number(m.premium) > Date.now());
    $('.acct-badge', v).title = m.official ? 'الحساب الرسمي لعرب راسلنج' : 'حساب موثق في عرب راسلنج';
    $$('[data-open="pics"]', v).forEach(function (b) { b.disabled = !!m.official; });
    // no blue badge yet: how to get it (owner 2026-10-15: «شارة علامة التوثيق لو هو عايز يحصل عليها يشترك»)
    $('.acct-getblue', v).hidden = !!m.official || !$('.acct-badge', v).hidden;
    plan(m);
    $('.acct-cur-mail b', v).textContent = m.email || '';
    var f = forms.profile;
    f.elements.display.value = m.display || '';
    f.elements.display.readOnly = !!m.official;
    f.elements.fav_star.value = m.fav_star || '';
    f.elements.bio.value = m.bio || '';
    $$('[data-chips="fav_fed"] button', f).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-v') === m.fav_fed); });
  }
  // the membership card: the site's own account, a premium member (until when), or what premium gives
  function plan(m) {
    var prem = !m.official && Number(m.premium) > Date.now();
    var kind = m.official ? 'official' : prem ? 'premium' : 'free';
    $$('[data-plan]').forEach(function (c) { c.hidden = c.getAttribute('data-plan') !== kind; });
    // three days free, for a member who never had it
    if (prem) {
      var d = new Date(Number(m.premium)), left = Math.max(0, Math.ceil((Number(m.premium) - Date.now()) / 864e5));
      $('.acct-plan-until').textContent = 'عضويتك سارية حتى ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' · المتبقي: ' + left + ' يوم';
    }
  }
  // «حسابي» and «الإعدادات» (/account/#settings opens the second, also from the header's menu)
  function tab(name) {
    $$('.acct-ptab').forEach(function (t) { var on = t.getAttribute('data-ptab') === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); });
    $$('.acct-pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
    var want = name === 'settings' ? '#settings' : name === 'sub' ? '#subscription' : location.hash === '#follows' ? '#follows' : '';
    if (location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
    if (name === 'sub') sub();
    if (name === 'home') follows(location.hash === '#follows');
  }
  function hashTab() { return location.hash === '#settings' ? 'settings' : location.hash === '#subscription' ? 'sub' : 'home'; }

  // «قائمتي» (owner 2026-10-15): what they follow (each one a button: pressed again, it stops), their device's
  // notifications; the buttons themselves work in assets/features.js, here only the list is drawn
  var FOLLOW_API = API.replace(/\/members$/, '/follow'), flBusy = false;
  function drawPush() {
    var row = $('.acct-fl-push'), btn = $('.acct-fl-push-btn'), st = $('.acct-fl-push-state');
    if (!row) return;
    var pk = ''; try { pk = localStorage.getItem('arw-follow-pk') || ''; } catch (e) {}
    var can = 'serviceWorker' in navigator && 'PushManager' in window && !!window.Notification;
    var on = can && Notification.permission === 'granted' && !!pk;
    row.classList.toggle('is-on', on);
    btn.hidden = on || !can || (window.Notification && Notification.permission === 'denied');
    st.textContent = !can ? 'متصفحك لا يدعم الإشعارات، ستجد العروض الجديدة في الجرس أعلى الصفحة.'
      : on ? 'مفعلة على هذا الجهاز ✓'
      : Notification.permission === 'denied' ? 'الإشعارات موقوفة لهذا الموقع من إعدادات المتصفح. فعلها من هناك ثم أعد تحميل الصفحة.'
      : 'يصلك إشعار على هاتفك أو حاسوبك حتى والموقع مغلق.';
  }
  function follows(scroll) {
    var box = $('.acct-fl-mine');
    if (!box || !session) return;
    drawPush();
    if (scroll) setTimeout(function () { var s = $('#follows'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    if (flBusy) return;
    flBusy = true;
    fetch(FOLLOW_API, { headers: { Authorization: 'Bearer ' + session.token }, credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      flBusy = false;
      if (!d || !d.ok) return;
      box.textContent = '';
      var list = d.follows || [];
      if (!list.length) { var p = document.createElement('p'); p.className = 'acct-fl-none'; p.textContent = 'قائمتك فارغة. أضف برامجك واتحاداتك المفضلة من الاقتراحات بالأسفل.'; box.appendChild(p); }
      list.forEach(function (f) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'arw-follow-btn is-on';
        b.setAttribute('data-follow', f.kind); b.setAttribute('data-key', f.key); b.setAttribute('data-label', f.label);
        b.setAttribute('aria-pressed', 'true'); b.setAttribute('data-ready', '1'); b.title = 'اضغط لإلغاء المتابعة';
        b.innerHTML = '<span class="arw-follow-ic"></span><span class="arw-follow-tx">تتابع</span> <bdi class="arw-follow-name"></bdi>';
        b.querySelector('bdi').textContent = f.label;
        box.appendChild(b);
      });
      // the browser's copy follows the server's (another device may have changed it)
      try {
        var c = JSON.parse(localStorage.getItem('arw-follows') || 'null') || {};
        c.at = Date.now(); c.uid = session.member.username; c.list = list.map(function (f) { return f.kind + ':' + f.key; }); c.unread = d.unread || 0;
        localStorage.setItem('arw-follows', JSON.stringify(c));
        window.dispatchEvent(new CustomEvent('arw-follows'));
      } catch (e) {}
    }).catch(function () { flBusy = false; });
  }
  // a follow changed anywhere on the page: the list again (a moment later, once the worker has it)
  window.addEventListener('arw-follows-changed', function () { setTimeout(function () { follows(false); }, 300); });
  if ($('.acct-fl-push-btn')) $('.acct-fl-push-btn').addEventListener('click', function () {
    if (!window.arwEnableFollowPush) return;
    var b = this; b.disabled = true;
    window.arwEnableFollowPush().then(function () { b.disabled = false; drawPush(); });
  });

  // «اشتراكي» (owner 2026-10-15: «تفاصيل الاشتراك … ابتدا امتي وهينتهي امتي والسجل الدفع … زر اعادة الاشتراك»)
  var subLoaded = false;
  function day(ms) { var d = new Date(ms); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function subFail(t) { subLoaded = false; $('.acct-sub-title').textContent = t; $('.acct-sub-note').textContent = 'أعد تحميل الصفحة بعد قليل.'; }
  function sub() {
    if (subLoaded || !session) return;
    subLoaded = true;
    var box = $('.acct-ms');
    fetch(API.replace(/\/members$/, '/premium/mine'), { headers: { Authorization: 'Bearer ' + session.token }, credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { subFail('تعذر تحميل اشتراكك'); return; }
        var now = Date.now(), until = Number(d.until) || 0, paid = (d.payments || []).filter(function (p) { return p.paid; });
        var left = until ? Math.max(0, Math.ceil((until - now) / 864e5)) : 0;
        var state = d.official ? 'official' : until > now ? (left <= 5 ? 'soon' : 'on') : paid.length ? 'ended' : 'none';
        box.setAttribute('data-state', state);
        var T = {
          official: ['الحساب الرسمي للموقع', 'كل المميزات مفعلة لحسابك دائما.'],
          on: ['أنت عضو مميز', 'عضويتك مفعلة، وكل المميزات متاحة لك.'],
          soon: ['عضويتك تنتهي قريبا', 'باقي ' + left + (left === 1 ? ' يوم' : left === 2 ? ' يومان' : ' أيام') + ' فقط. جددها الآن حتى لا تتوقف المميزات.'],
          ended: ['انتهت عضويتك المميزة', 'جدد اشتراكك الآن وارجع لكل المميزات.'],
          none: ['أنت لست مشتركا بعد', 'اشترك وشاهد العروض قبل الجميع، وبدون إعلانات، ووثق حسابك.']
        }[state];
        $('.acct-sub-title').textContent = T[0];
        $('.acct-sub-note').textContent = T[1];
        var grid = $('.acct-sub-grid'), bar = $('.acct-sub-bar');
        grid.hidden = state === 'official' || state === 'none';
        bar.hidden = !(state === 'on' || state === 'soon');
        if (!grid.hidden) {
          var since = Number(d.since) || (paid.length ? paid[paid.length - 1].at : 0);
          var last = paid.length ? paid[0] : null;
          $('[data-k="since"]').textContent = since ? day(since) : '—';
          $('[data-k="until-label"]').textContent = state === 'ended' ? 'انتهى في' : 'ينتهي في';
          $('[data-k="until"]').textContent = until ? day(until) : last ? day(last.at + last.days * 864e5) : '—';
          $('[data-k="left"]').textContent = state === 'ended' ? '0' : String(left);
          $('.acct-sub-bar i').style.width = Math.min(100, Math.round(left / (d.days || 30) * 100)) + '%';
        }
        var go = $('[data-k="go"]');
        go.hidden = state === 'official';
        go.querySelector('span').textContent = state === 'none' ? 'اشترك الآن' : state === 'ended' ? 'أعد الاشتراك' : 'جدد الاشتراك (شهر إضافي)';
        $('[data-k="req"]').hidden = !(state === 'on' || state === 'soon' || state === 'official');
        var list = $('.acct-pays');
        list.textContent = '';
        (d.payments || []).forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'acct-pay';
          row.setAttribute('role', 'row');
          [
            [day(p.at), p.reference ? 'رقم العملية ' + p.reference : ''],
            // a membership paid to the site directly and turned on by hand has no amount when none was written: «paid»,
            // never «a gift» (owner 2026-10-16)
            [p.trial ? 'تجربة مجانية' : p.gift ? 'هدية من الموقع' : !Number(p.amount) ? 'اشتراك مدفوع' : p.currency === 'USD' ? p.amount + ' دولار' : p.amount + ' جنيه', p.method || ''],
            ['+' + p.days + ' يوم', 'مدة العضوية']
          ].forEach(function (c) {
            var cell = document.createElement('div'); cell.setAttribute('role', 'cell');
            var b = document.createElement('b'); b.textContent = c[0]; cell.appendChild(b);
            if (c[1]) { var sm = document.createElement('small'); sm.textContent = c[1]; cell.appendChild(sm); }
            row.appendChild(cell);
          });
          var st = document.createElement('span');
          st.className = 'acct-pay-st' + (p.paid ? '' : ' is-wait');
          st.textContent = p.paid ? 'تم الدفع' : 'لم يكتمل';
          row.appendChild(st);
          list.appendChild(row);
        });
        $('.acct-pays-empty').hidden = !!(d.payments || []).length;
      })
      .catch(function () { subFail('تعذر الاتصال'); });
  }
  $$('.acct-ptab').forEach(function (t) { t.addEventListener('click', function () { tab(t.getAttribute('data-ptab')); }); });
  // another tab from a link or the header's menu: the page changes in place; it moves only when the tabs are out of
  // sight, to just above them (owner 2026-10-15: «يحدث مكانه ويفضل مكان ما انا واقف»)
  function toTabs() {
    var bar = $('.acct-ptabs');
    if (!bar || bar.offsetParent === null) return;
    var r = bar.getBoundingClientRect();
    if (r.top >= 0 && r.top < window.innerHeight * 0.6) return;
    window.scrollTo({ top: Math.max(0, window.pageYOffset + r.top - 90), behavior: 'smooth' });
  }
  $$('[data-goto]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); tab(a.getAttribute('data-goto')); toTabs(); }); });
  window.addEventListener('hashchange', function () { if (session && !$('[data-view="profile"]').hidden) { tab(hashTab()); toTabs(); } });

  $$('[data-chips="fav_fed"] button').forEach(function (b) {
    b.addEventListener('click', function () {
      var on = !b.classList.contains('is-on');
      $$('[data-chips="fav_fed"] button').forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.toggle('is-on', on);
    });
  });
  forms.profile.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.profile, on = $('[data-chips="fav_fed"] .is-on', f);
    busy(f, true); say(f, 'لحظة…');
    api('/profile', { display: val(f, 'display'), fav_fed: on ? on.getAttribute('data-v') : '', fav_star: val(f, 'fav_star'), bio: val(f, 'bio') }, true).then(function (d) {
      busy(f, false);
      if (d.signedOut) return out();
      if (!d.ok) { say(f, srv(d.error) || 'تعذر الحفظ.', 'bad'); return; }
      session.member = d.member; save(session); drawProfile();
      say(f, 'تم الحفظ ✓', 'ok');
      setTimeout(function () { say(f, ''); }, 2500);
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  // the picture: one of the stars (the same list as the comments' pictures)
  var stars = null, fed = '';
  function drawStars() {
    var grid = $('.acct-grid');
    grid.textContent = '';
    stars.filter(function (w) { return w.fed === fed; }).forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(session.member.pic === 'w:' + w.slug));
      b.innerHTML = '<img alt="" width="58" height="58" loading="lazy"><span></span>';
      b.firstChild.src = '/avatars/' + w.slug + '.webp' + AV;
      b.lastChild.textContent = EN ? w.en : w.ar;
      b.onclick = function () { setPic('w:' + w.slug); };
      grid.appendChild(b);
    });
  }
  function setPic(pic) {
    api('/profile', { pic: pic }, true).then(function (d) {
      if (d.signedOut) return out();
      if (!d.ok) return;
      session.member = d.member; save(session); drawProfile();
      $('.acct-pics').hidden = true;
    });
  }
  function openPics() {
    if (session && session.member.official) return;
    tab('settings');
    var box = $('.acct-pics');
    box.hidden = !box.hidden;
    if (!box.hidden) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (box.hidden || stars) return;
    fetch('/avatars/credits.json' + AV).then(function (r) { return r.json(); }).then(function (l) {
      stars = l;
      var feds = [];
      l.forEach(function (w) { if (feds.indexOf(w.fed) < 0) feds.push(w.fed); });
      var tabs = $('.acct-feds');
      feds.forEach(function (f, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = f;
        b.onclick = function () { fed = f; $$('button', tabs).forEach(function (x) { x.classList.toggle('is-on', x === b); }); drawStars(); };
        tabs.appendChild(b);
        if (!i || f === session.member.fav_fed) b.click();
      });
    }).catch(function () {});
  }
  $$('[data-open="pics"]').forEach(function (b) { b.addEventListener('click', openPics); });
  $('[data-pic=""]').addEventListener('click', function () { setPic(''); });
  // their own picture (owner 2026-10-15: «المتابع يقدر يحط صورته او صورة من عنده»): the middle square, 400px, sent
  // as WebP (JPEG where the browser can't make WebP); the worker checks it is a real picture and keeps it
  var upFile = $('.acct-up-file'), upNote = $('.acct-up-note'), upBtn = $('.acct-up');
  function upSay(t, bad) { upNote.textContent = t; upNote.classList.toggle('is-bad', !!bad); }
  // a phone's picture, whatever it is: a camera's 50 megapixels are read already made small (createImageBitmap), so the
  // page never holds the full picture and a small phone doesn't close the tab; a file with no type is judged by its
  // name; HEIC that this browser can't open says so (owner 2026-10-15: «بحاول اضيف صورة من علي الموبيل … مش بيضيف»)
  var PIC_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
  function readPic(f) {
    function viaImg() {
      return new Promise(function (ok, no) {
        var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); ok(img); };
        img.onerror = function () { URL.revokeObjectURL(url); no(new Error('img')); };
        img.src = url;
      });
    }
    if (!window.createImageBitmap) return viaImg();
    return createImageBitmap(f, { resizeWidth: 1000, resizeQuality: 'high', imageOrientation: 'from-image' })
      .then(function (bm) { return bm.width && bm.height ? bm : viaImg(); }, viaImg);
  }
  function square(src) {
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, s = Math.min(w, h), size = Math.min(400, s);
    if (!s) return '';
    var c = document.createElement('canvas'); c.width = c.height = size;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
    if (src.close) src.close();
    var data = c.toDataURL('image/webp', 0.86);
    if (data.indexOf('data:image/webp') !== 0) data = c.toDataURL('image/jpeg', 0.86);
    c.width = c.height = 0;
    return data;
  }
  upFile.addEventListener('change', function () {
    var f = upFile.files && upFile.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type) && !(f.type === '' || f.type === 'application/octet-stream') && !PIC_EXT.test(f.name || '')) { upFile.value = ''; return upSay('اختر صورة (JPG أو PNG أو WebP).', true); }
    if (f.size > 40e6) { upFile.value = ''; return upSay('الصورة كبيرة جدا، اختر صورة أصغر.', true); }
    var heic = /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || '');
    upBtn.classList.add('is-busy'); upSay('لحظة، نجهز صورتك…');
    function fail(t) { upFile.value = ''; upBtn.classList.remove('is-busy'); upSay(t, true); }
    readPic(f).then(function (src) {
      var data = square(src);
      if (!data) return fail('تعذر فتح هذه الصورة، جرب صورة أخرى.');
      upSay('جار رفع صورتك…');
      // a phone's network that hangs: the button comes back after 30 seconds
      var ctl = window.AbortController ? new AbortController() : null, timer = ctl && setTimeout(function () { ctl.abort(); }, 30000);
      fetch(API + '/pic', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ image: data }), credentials: 'omit', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          clearTimeout(timer); upFile.value = ''; upBtn.classList.remove('is-busy');
          if (d.signedOut) return out();
          if (!d.ok) return upSay(srv(d.error) || 'تعذر رفع الصورة، حاول مرة أخرى.', true);
          session.member = d.member; save(session); drawProfile();
          upSay('تم تغيير صورتك ✓');
          setTimeout(function () { upSay(''); $('.acct-pics').hidden = true; }, 1400);
        }).catch(function () { clearTimeout(timer); fail('تعذر رفع الصورة، تأكد من الاتصال وحاول مرة أخرى.'); });
    }).catch(function () {
      fail(heic ? 'متصفحك لا يفتح صور HEIC. اختر لقطة شاشة للصورة أو صورة JPG، أو غير صيغة الكاميرا إلى «الأكثر توافقا».' : 'تعذر فتح هذه الصورة، جرب صورة أخرى.');
    });
  });

  forms.password.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.password;
    busy(f, true); say(f, 'لحظة…');
    api('/password', { current: f.elements.current.value, password: f.elements.password.value }, true).then(function (d) {
      busy(f, false);
      if (d.signedOut) return out();
      if (!d.ok) { say(f, srv(d.error) || 'تعذر التغيير.', 'bad'); return; }
      f.reset(); say(f, 'تم تغيير كلمة المرور، وخرجنا من حسابك على الأجهزة الأخرى.', 'ok');
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });
  forms.email.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this;
    if (!val(f, 'email') || !f.elements.current.value) { say(f, 'اكتب البريد الجديد وكلمة المرور الحالية.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/email', { email: val(f, 'email'), current: f.elements.current.value }, true).then(function (d) {
      busy(f, false);
      if (d.signedOut) return out();
      if (!d.ok) { say(f, srv(d.error) || 'تعذر تغيير البريد.', 'bad'); return; }
      f.reset();
      if (d.pending) { say(f, 'أرسلنا رابط التأكيد إلى ' + d.email + '. افتح الرسالة واضغط «تأكيد البريد الجديد».', 'ok'); return; }
      session.member = d.member; save(session); drawProfile();
      say(f, 'تم تغيير البريد ✓', 'ok');
    }).catch(function () { busy(f, false); say(f, 'تعذر الاتصال، حاول مرة أخرى.', 'bad'); });
  });
  $('[data-act="verify-again"]').addEventListener('click', function () {
    var b = this;
    b.disabled = true;
    api('/verify-again', {}, true).then(function (d) { b.textContent = d.ok ? 'أرسلنا الرسالة ✓' : (srv(d.error) || 'تعذر الإرسال.'); });
  });
  $('[data-act="logout"]').addEventListener('click', function () {
    api('/logout', {}, true).catch(function () {}).then(out);
  });
  function out() { save(null); session = null; subLoaded = false; show('auth'); }
  // after signing in: back to the page they came from (?back=…), or their page
  function done() {
    var back = new URLSearchParams(location.search).get('back') || '';
    if (/^\/(?!\/)/.test(back)) { location.href = back; return; }
    drawProfile(); show('profile'); tab(hashTab());
  }

  // ── the start ────────────────────────────────────────────────────────────
  var mailOn = false;
  function note(title, text) { $('.acct-note-title').textContent = title; $('.acct-note-tx').textContent = text; show('note'); }
  function start() {
    var q = new URLSearchParams(location.search);
    if (q.get('verify')) {
      api('/verify', { token: q.get('verify') }).then(function (d) {
        history.replaceState(null, '', location.pathname);
        if (d.ok && d.token) signedIn(d);
        else if (d.ok && session) { session.member.verified = true; save(session); }
        note(d.ok ? 'تم تفعيل حسابك ✓' : 'الرابط لا يعمل', d.ok ? 'أهلا بك في عرب راسلنج. حسابك جاهز، ويمكنك الآن الاستفادة من كل مميزات العضوية.' : (srv(d.error) || 'رابط التفعيل غير صالح.'));
      });
      return;
    }
    if (q.get('reset')) { show('reset'); return; }
    if (q.get('email')) {
      api('/email-confirm', { token: q.get('email') }).then(function (d) {
        history.replaceState(null, '', location.pathname);
        if (d.ok && session) { session.member.email = d.email; save(session); }
        note(d.ok ? 'تم تأكيد بريدك الجديد ✓' : 'الرابط لا يعمل', d.ok ? 'بريد حسابك الآن: ' + d.email : (srv(d.error) || 'رابط التأكيد غير صالح.'));
      });
      return;
    }
    if (!session) { show('auth'); if (q.get('new') !== null) $('[data-view="auth"] [data-tab="up"]').click(); return; }
    // signed in already: «?new» or «?back=…» mean nothing now; gone from the address, the menu's links stay on this page
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    // the session still good? (and the member as they are now)
    api('/me', null, true).then(function (d) {
      if (!d.ok) { out(); return; }
      mailOn = !!d.mail;
      session.member = d.member; save(session);
      drawProfile(); show('profile'); tab(hashTab());
    }).catch(function () { drawProfile(); show('profile'); tab(hashTab()); });
  }
  start();
})();
