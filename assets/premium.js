// «العضوية المميزة» (pages/premium.njk): the price in either currency, the member's own Fawaterk invoice, the way back
// from paying (the worker asks Fawaterk until the membership is on), the membership's state, and the member's requests.
// The worker: worker/src/premium.ts. The member's session: localStorage «arw-member» (assets/account.js).
(function () {
  'use strict';
  var root = document.getElementById('pm');
  if (!root) return;
  var API = root.getAttribute('data-api');
  var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
  var PRICES = { EGP: [50, 'جنيه'], USD: [1, 'دولار'] };
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var KINDS = { nostalgia: 'نوستالجيا', series: 'سلسلة', show: 'عرض قديم', other: 'طلب آخر' };
  var STATES = { 'new': 'جديد', working: 'قيد الترجمة', done: 'تمت', declined: 'تعذر' };
  function $(s, el) { return (el || root).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || root).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function load() { try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); return s && s.token ? s : null; } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem('arw-member', JSON.stringify(s)); } catch (e) {} }
  var session = load();
  function api(path, body) {
    var h = { 'Content-Type': 'application/json' };
    if (session) h.Authorization = 'Bearer ' + session.token;
    return fetch(API + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function date(ms) { var d = new Date(ms); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function daysLeft(ms) { return Math.max(0, Math.ceil((ms - Date.now()) / 864e5)); }

  // the price, in the chosen currency
  var cur = 'EGP';
  try { if (/^(en|fr|de)/i.test(navigator.language) && !/EG/i.test(navigator.language)) cur = 'USD'; } catch (e) {}
  function setCur(c) {
    cur = c;
    $$('.pm-cur button').forEach(function (b) { var on = b.getAttribute('data-cur') === c; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    $('.pm-amount-n').textContent = PRICES[c][0];
    $('.pm-amount-c').textContent = PRICES[c][1];
  }
  $$('.pm-cur button').forEach(function (b) { b.addEventListener('click', function () { setCur(b.getAttribute('data-cur')); }); });
  setCur(cur);

  function flash(kind, text, spin) {
    var f = $('.pm-flash');
    f.className = 'pm-flash is-' + kind; f.textContent = '';
    if (spin) f.appendChild(el('span', 'pm-spin'));
    f.appendChild(document.createTextNode(text));
    f.hidden = !text;
  }

  // the membership's state, from the worker
  var member = session ? session.member : null;
  function draw() {
    var st = $('.pm-status'), btn = $('[data-act="subscribe"] span');
    var until = member && member.premium > Date.now() ? member.premium : 0;
    st.textContent = '';
    if (member && member.official) {
      st.hidden = false;
      st.appendChild(document.createTextNode('حسابك الرسمي: كل المميزات مفعلة دائما.'));
    } else if (until) {
      st.hidden = false;
      st.appendChild(document.createTextNode('أنت عضو مميز حتى '));
      st.appendChild(el('b', null, date(until)));
      var n = daysLeft(until);
      st.appendChild(document.createTextNode(' (المتبقي: ' + n + (n >= 3 && n <= 10 ? ' أيام' : n > 10 ? ' يوما' : ' يوم') + ')'));
      btn.textContent = 'جدد شهرا إضافيا';
    } else {
      st.hidden = true;
      btn.textContent = member ? 'اشترك الآن' : 'أنشئ حسابا مجانيا واشترك';
    }
    var req = $('.pm-req');
    req.hidden = !(until || (member && member.official));
    if (!req.hidden) requests();
  }
  function refresh() {
    if (!session) { draw(); return Promise.resolve(); }
    return fetch(API + '/members/me', { headers: { Authorization: 'Bearer ' + session.token }, credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok && d.member) { member = d.member; session.member = d.member; save(session); headerButton(); } draw(); })
      .catch(draw);
  }

  // the header's «العضوية المميزة» goes once the membership is on (assets/features.js does it on every other page)
  function headerButton() {
    if (!(member && (member.official || member.premium > Date.now())) || document.getElementById('arw-prem-hide')) return;
    var st = el('style'); st.id = 'arw-prem-hide'; st.textContent = '.premium-btn{display:none !important}';
    document.head.appendChild(st);
  }

  // subscribing: the member's own invoice on Fawaterk
  $('[data-act="subscribe"]').addEventListener('click', function () {
    var b = this;
    if (!session) { location.href = HOME + '/account/?new&back=' + encodeURIComponent(HOME + '/premium/#subscribe'); return; }
    b.disabled = true;
    api('/premium/checkout', { currency: cur, en: EN }).then(function (d) {
      b.disabled = false;
      if (d.status === 401) { location.href = HOME + '/account/?back=' + encodeURIComponent(HOME + '/premium/#subscribe'); return; }
      if (!d.ok || !d.url) { flash('bad', d.error || 'تعذر فتح صفحة الدفع، حاول مرة أخرى.'); return; }
      if (d.manual) { $('.pm-manual').hidden = false; window.open(d.url, '_blank', 'noopener'); return; }
      location.href = d.url;
    }).catch(function () { b.disabled = false; flash('bad', 'تعذر الاتصال، حاول مرة أخرى.'); });
  });

  // back from Fawaterk: asked again until the membership is on
  function waitForPayment(maxMs, every) {
    var before = member && member.premium || 0, t0 = Date.now();
    flash('wait', 'جار تأكيد الدفع وتفعيل عضويتك…', true);
    (function tick() {
      api('/premium/check', {}).then(function (d) {
        if (d.ok && d.premium && d.premium > before) {
          flash('ok', '🎉 تم تفعيل عضويتك المميزة حتى ' + date(d.premium) + '. أهلا بك!');
          refresh();
          return;
        }
        if (Date.now() - t0 > maxMs) { flash('bad', 'لم يصلنا تأكيد الدفع بعد. أعد تحميل الصفحة بعد دقيقة، وإن لم تتفعل عضويتك راسلنا من «تواصل معنا».'); return; }
        setTimeout(tick, every);
      }).catch(function () { setTimeout(tick, every); });
    })();
  }

  // the member's requests
  function requests() {
    api('/premium/requests').then(function (d) {
      var l = $('.pm-req-list');
      l.textContent = '';
      (d.items || []).forEach(function (r) {
        var li = el('li');
        var top = el('div', 'pm-req-top');
        top.appendChild(el('span', 'pm-st pm-st-' + r.status, STATES[r.status] || r.status));
        top.appendChild(el('span', null, (KINDS[r.kind] || '') + ' · ' + date(r.created)));
        li.appendChild(top);
        li.appendChild(el('p', null, r.text));
        if (r.reply || r.link) {
          var rp = el('p', 'pm-req-reply', r.reply || '');
          if (r.link) { var a = el('a', null, ' شاهد الآن ←'); a.href = r.link; rp.appendChild(a); }
          li.appendChild(rp);
        }
        l.appendChild(li);
      });
    });
  }
  var form = $('.pm-req-form');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('.pm-req-msg'), btn = $('[type=submit]', form);
    var text = form.elements.text.value.trim();
    if (text.length < 5) { msg.className = 'pm-req-msg is-bad'; msg.textContent = 'اكتب اسم العرض أو السلسلة بوضوح.'; return; }
    btn.disabled = true; msg.className = 'pm-req-msg'; msg.textContent = 'لحظة…';
    api('/premium/requests', { kind: (form.querySelector('input[name=kind]:checked') || {}).value || 'other', text: text }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) { msg.className = 'pm-req-msg is-bad'; msg.textContent = d.error || 'تعذر الإرسال.'; return; }
      form.elements.text.value = '';
      msg.className = 'pm-req-msg is-ok'; msg.textContent = 'وصل طلبك ✓ ستجد حالته هنا.';
      requests();
    }).catch(function () { btn.disabled = false; msg.className = 'pm-req-msg is-bad'; msg.textContent = 'تعذر الاتصال، حاول مرة أخرى.'; });
  });

  // «متاح الآن قبل الجميع»: shows dated later (/premium/early.json), with the time left until everyone gets them
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function left(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), d = Math.floor(s / 86400);
    if (h >= 48) return d + (d <= 10 ? ' أيام' : ' يوما');
    return pad(h) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
  }
  function early() {
    var sec = $('.pm-early');
    if (!sec) return;
    fetch('/premium/early.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (items) {
      items = (items || []).filter(function (x) { return x.pub > Date.now(); }).slice(0, 8);
      if (!items.length) return;
      var ul = $('.pm-early-list');
      items.forEach(function (x) {
        var li = el('li'), a = el('a', 'pm-early-card');
        a.href = HOME + x.u;
        var pic = el('span', 'pm-early-pic');
        if (x.img) { var img = el('img'); img.src = x.img; img.alt = ''; img.loading = 'lazy'; pic.appendChild(img); }
        pic.appendChild(el('span', 'pm-early-tag', 'قبل الجميع'));
        a.appendChild(pic);
        var tx = el('span', 'pm-early-tx');
        tx.appendChild(el('b', null, x.t));
        var when = el('small');
        when.appendChild(document.createTextNode('للجميع بعد '));
        var c = el('span', 'pm-early-left', left(x.pub - Date.now()));
        c.setAttribute('data-pub', x.pub);
        when.appendChild(c);
        tx.appendChild(when);
        a.appendChild(tx);
        li.appendChild(a);
        ul.appendChild(li);
      });
      sec.hidden = false;
      setInterval(function () {
        $$('.pm-early-left').forEach(function (c) {
          var ms = Number(c.getAttribute('data-pub')) - Date.now();
          c.textContent = ms > 0 ? left(ms) : 'متاح للجميع الآن';
        });
      }, 1000);
    }).catch(function () {});
  }
  early();

  // the start
  var q = new URLSearchParams(location.search);
  refresh().then(function () {
    if (q.get('paid') !== null && session) waitForPayment(120000, 3000);
    else if (q.get('pending') !== null && session) { flash('wait', 'الدفع قيد التنفيذ. ستتفعل عضويتك تلقائيا فور إتمامه.', true); waitForPayment(15 * 60000, 10000); }
    else if (q.get('failed') !== null) flash('bad', 'لم تكتمل عملية الدفع، ولم يخصم منك شيء. يمكنك المحاولة مرة أخرى.');
    if (q.get('paid') !== null || q.get('pending') !== null || q.get('failed') !== null) history.replaceState(null, '', location.pathname + location.hash);
  });
})();
