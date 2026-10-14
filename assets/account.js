// The members' page, /account/ (owner 2026-10-14: «نظام التسجيل للمتابعيين … يكون احترافي جدا»): sign in, sign up
// (with the worker's captcha), the recovery code shown once, «forgot my password» (by mail, or by the code), the
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
  function save(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {} }
  var session = load();
  function api(path, body, auth) {
    var h = { 'Content-Type': 'application/json' };
    if (auth && session) h.Authorization = 'Bearer ' + session.token;
    return fetch(API + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function signedIn(d) {
    session = { token: d.token, member: d.member };
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
    var steps = [['8%', 'var(--coral)', '8 حروف على الأقل، فيها حروف وأرقام.'], ['30%', 'var(--coral)', 'ضعيفة'], ['55%', 'var(--gold)', 'متوسطة'], ['80%', 'var(--teal)', 'جيدة'], ['100%', 'var(--teal)', 'قوية جدًا']];
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
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر الدخول، تأكد من البيانات.', 'bad'); return; }
      signedIn(d); say(f, ''); f.reset();
      done();
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  forms.up.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.up;
    $$('input', f).forEach(function (i) { i.classList.remove('is-bad'); });
    var u = val(f, 'username'), m = val(f, 'email'), p = f.elements.password.value, c = val(f, 'captcha');
    var missing = !u ? 'username' : !m ? 'email' : !p ? 'password' : !c ? 'captcha' : '';
    if (missing) { f.elements[missing].classList.add('is-bad'); f.elements[missing].focus(); say(f, 'أكمل كل الخانات.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/signup', { username: u, email: m, password: p, captcha: { id: capId, answer: c }, website: f.elements.website.value }).then(function (d) {
      busy(f, false);
      if (!d.ok) {
        say(f, d.error && !EN ? d.error : 'تعذّر إنشاء الحساب، حاول مرة أخرى.', 'bad');
        if (d.field && f.elements[d.field]) { f.elements[d.field].classList.add('is-bad'); f.elements[d.field].focus(); }
        captcha();
        return;
      }
      f.reset(); say(f, '');
      if (d.pending) { welcome(d.recovery, false, { login: u, password: p }, d.email); return; }
      signedIn(d);
      welcome(d.recovery, d.mailed);
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); captcha(); });
  });

  // waitingFor: an account that opens from the mail (the sign-in, kept in memory only to send the link again)
  var waitingFor = null, waitingMail = '';
  function welcome(code, mailed, creds, email) {
    var v = $('[data-view="welcome"]');
    waitingFor = creds || null; waitingMail = email || '';
    $('.acct-code', v).textContent = code;
    $('.acct-welcome-tx', v).textContent = creds ? 'تم إنشاء حسابك. احفظ كود الاسترجاع أولًا، ثم فعّل حسابك من بريدك.' : 'تم إنشاء حسابك.';
    var check = $('.acct-saved', v), go = $('[data-go="profile"]', v);
    go.textContent = creds ? 'متابعة' : 'متابعة إلى حسابي';
    check.checked = false; go.disabled = true;
    check.onchange = function () { go.disabled = !check.checked; };
    show('welcome');
  }
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
      m.textContent = d.sent ? 'أرسلنا رابطًا جديدًا ✓ افتح بريدك.' : d.unverified ? 'أرسلنا الرابط قبل قليل. انتظر دقائق ثم حاول مرة أخرى.' : (d.error && !EN ? d.error : 'تعذّر الإرسال، حاول مرة أخرى.');
      m.className = 'acct-msg acct-pending-msg ' + (d.sent ? 'is-ok' : 'is-bad');
    }).catch(function () { b.disabled = false; m.textContent = 'تعذّر الاتصال، حاول مرة أخرى.'; m.className = 'acct-msg acct-pending-msg is-bad'; });
  });
  $('.acct-copy').addEventListener('click', function () {
    var b = this, code = $('.acct-code').textContent;
    var ok = function () { b.textContent = 'تم النسخ ✓'; setTimeout(function () { b.textContent = 'نسخ'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(ok, function () {}); else ok();
  });

  forms.mail.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.mail;
    if (!val(f, 'email')) { say(f, 'اكتب بريدك.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/forgot', { email: val(f, 'email') }).then(function (d) {
      busy(f, false);
      if (d.nomail) { say(f, 'الاسترجاع بالبريد غير متاح الآن، استخدم كود الاسترجاع.', 'bad'); $('[data-view="forgot"] [data-tab="code"]').click(); return; }
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر الإرسال، حاول مرة أخرى.', 'bad'); return; }
      say(f, 'إن كان لهذا البريد حساب، ستصلك رسالة خلال دقائق. افحص البريد غير المرغوب أيضًا.', 'ok');
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  forms.code.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.code;
    if (!val(f, 'login') || !val(f, 'code') || !f.elements.password.value) { say(f, 'أكمل كل الخانات.', 'bad'); return; }
    busy(f, true); say(f, 'لحظة…');
    api('/recover', { login: val(f, 'login'), code: val(f, 'code'), password: f.elements.password.value }).then(function (d) {
      busy(f, false);
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر التغيير، تأكد من البيانات.', 'bad'); return; }
      var creds = { login: val(f, 'login'), password: f.elements.password.value };
      f.reset();
      if (d.pending) { welcome(d.recovery, false, creds, d.email); $('.acct-welcome-tx').textContent = 'تم تغيير كلمة المرور. هذا كود الاسترجاع الجديد، ثم فعّل حسابك من بريدك.'; return; }
      signedIn(d);
      // the old code is used up: a new one, once
      welcome(d.recovery, false);
      $('.acct-welcome-tx').textContent = 'تم تغيير كلمة المرور. هذا كود الاسترجاع الجديد، والقديم لم يعد يعمل.';
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  forms.reset.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.reset;
    var t = new URLSearchParams(location.search).get('reset') || '';
    busy(f, true); say(f, 'لحظة…');
    api('/reset', { token: t, password: f.elements.password.value }).then(function (d) {
      busy(f, false);
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر الحفظ، حاول مرة أخرى.', 'bad'); return; }
      signedIn(d);
      history.replaceState(null, '', location.pathname);
      done();
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
  });

  // ── the member's page ────────────────────────────────────────────────────
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function since(ms) { var d = new Date(ms); return EN ? 'Member since ' + d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'عضو منذ ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function initial(n) { return (String(n).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase(); }
  function picSrc(pic) {
    pic = String(pic || '');
    if (pic === 'official') return EN ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png';
    if (/^w:[a-z0-9-]+$/.test(pic)) return '/avatars/' + pic.slice(2) + '.webp' + AV;
    if (/^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(pic)) return pic;
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
    var prem = !m.official && Number(m.premium) > Date.now();
    v.classList.toggle('is-prem', prem);
    $('.acct-badge span', v).textContent = m.official ? 'الحساب الرسمي' : prem ? 'عضو مميز' : 'حساب موثّق';
    $('.acct-badge', v).hidden = !m.official && m.blue === false && !(Number(m.premium) > Date.now());
    $('.acct-badge', v).title = m.official ? 'الحساب الرسمي لعرب راسلنج' : 'حساب موثّق في عرب راسلنج';
    $('[data-open="pics"]', v).disabled = !!m.official;
    var f = forms.profile;
    f.elements.display.value = m.display || '';
    f.elements.display.readOnly = !!m.official;
    f.elements.fav_star.value = m.fav_star || '';
    f.elements.bio.value = m.bio || '';
    $$('[data-chips="fav_fed"] button', f).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-v') === m.fav_fed); });
  }
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
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر الحفظ.', 'bad'); return; }
      session.member = d.member; save(session); drawProfile();
      say(f, 'تم الحفظ ✓', 'ok');
      setTimeout(function () { say(f, ''); }, 2500);
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
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
  $('[data-open="pics"]').addEventListener('click', function () {
    var box = $('.acct-pics');
    box.hidden = !box.hidden;
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
  });
  $('[data-pic=""]').addEventListener('click', function () { setPic(''); });

  forms.password.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = forms.password;
    busy(f, true); say(f, 'لحظة…');
    api('/password', { current: f.elements.current.value, password: f.elements.password.value }, true).then(function (d) {
      busy(f, false);
      if (d.signedOut) return out();
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر التغيير.', 'bad'); return; }
      f.reset(); say(f, 'تم تغيير كلمة المرور، وخرجنا من حسابك على الأجهزة الأخرى.', 'ok');
    }).catch(function () { busy(f, false); say(f, 'تعذّر الاتصال، حاول مرة أخرى.', 'bad'); });
  });
  $('[data-act="recovery"]').addEventListener('click', function () {
    var f = forms.password;
    if (!f.elements.current.value) { f.elements.current.focus(); say(f, 'اكتب كلمة المرور الحالية أولًا.', 'bad'); return; }
    api('/recovery', { current: f.elements.current.value }, true).then(function (d) {
      if (d.signedOut) return out();
      if (!d.ok) { say(f, d.error && !EN ? d.error : 'تعذّر ذلك.', 'bad'); return; }
      f.reset();
      welcome(d.recovery, false);
      $('.acct-welcome-tx').textContent = 'هذا كود الاسترجاع الجديد، والقديم لم يعد يعمل.';
      $('.acct-view[data-view="welcome"] .acct-title').textContent = 'كود استرجاع جديد';
    });
  });
  $('[data-act="verify-again"]').addEventListener('click', function () {
    var b = this;
    b.disabled = true;
    api('/verify-again', {}, true).then(function (d) { b.textContent = d.ok ? 'أرسلنا الرسالة ✓' : (d.error && !EN ? d.error : 'تعذّر الإرسال.'); });
  });
  $('[data-act="logout"]').addEventListener('click', function () {
    api('/logout', {}, true).catch(function () {}).then(out);
  });
  function out() { save(null); session = null; show('auth'); }
  // after signing in: back to the page they came from (?back=…), or their page
  function done() {
    var back = new URLSearchParams(location.search).get('back') || '';
    if (/^\/(?!\/)/.test(back)) { location.href = back; return; }
    drawProfile(); show('profile');
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
        note(d.ok ? 'تم تفعيل حسابك ✓' : 'الرابط لا يعمل', d.ok ? 'أهلًا بك في عرب راسلنج. حسابك جاهز، ويمكنك الآن الاستفادة من كل مميزات العضوية.' : (d.error && !EN ? d.error : 'رابط التفعيل غير صالح.'));
      });
      return;
    }
    if (q.get('reset')) { show('reset'); return; }
    if (!session) { show('auth'); if (q.get('new') !== null) $('[data-view="auth"] [data-tab="up"]').click(); return; }
    // the session still good? (and the member as they are now)
    api('/me', null, true).then(function (d) {
      if (!d.ok) { out(); return; }
      mailOn = !!d.mail;
      session.member = d.member; save(session);
      drawProfile(); show('profile');
    }).catch(function () { drawProfile(); show('profile'); });
  }
  start();
})();
