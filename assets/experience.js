/* Reader experience (INCIDENTS #179) — see experience.css. Everything is kept in the reader's own
   browser (localStorage); nothing leaves the device. Any failure leaves the page as it was. */
(function () {
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var path = decodeURI(location.pathname);
  var isWatchPage = /^\/(shows|nostalgia|recaps)\/[^/]+\/?$/.test(path) && !/^\/(shows|nostalgia|recaps)\/\d*\/?$/.test(path);
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Instant pages: the browser prepares a page the moment you point at its link (Chrome/Edge),
  //    and fetches it ahead on touch everywhere else.
  try {
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      var s = document.createElement('script');
      s.type = 'speculationrules';
      // (never the language button: it changes the remembered language on click, after a prerender has already run)
      s.textContent = JSON.stringify({ prerender: [{ where: { and: [{ href_matches: '/*' }, { not: { href_matches: '/admin/*' } }, { not: { selector_matches: '.lang-switch' } }] }, eagerness: 'moderate' }] });
      document.head.appendChild(s);
    } else {
      var done = {};
      var ahead = function (e) {
        var a = e.target.closest && e.target.closest('a[href^="/"]');
        if (!a || done[a.href] || a.href.indexOf('/admin') > -1) return;
        done[a.href] = 1;
        var l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l);
      };
      addEventListener('touchstart', ahead, { passive: true });
      addEventListener('mouseover', ahead, { passive: true });
    }
  } catch (e) {}

  // 2. Remember what was watched
  var watched = store.get('arw-watched', []);
  if (isWatchPage) {
    var title = document.title.replace(/\s*\|\s*عرب راسلنج.*$/, '');
    var entry = { u: location.pathname, t: title, at: Date.now() };
    watched = watched.filter(function (w) { return w.u !== entry.u; });
    watched.unshift(entry);
    store.set('arw-watched', watched.slice(0, 20));
  }
  var seenSet = {};
  watched.forEach(function (w) { seenSet[w.u] = 1; });

  function start() {
    // 3. «شاهدته» on cards already opened, «جديد» on what arrived since the last visit
    // the previous visit is read once per tab, so «جديد» stays put while the reader moves around
    var lastVisit = 0;
    try {
      var kept = sessionStorage.getItem('arw-prev-visit');
      if (kept !== null) lastVisit = Number(kept) || 0;
      else { lastVisit = store.get('arw-last-visit', 0); sessionStorage.setItem('arw-prev-visit', String(lastVisit)); }
    } catch (e) { lastVisit = store.get('arw-last-visit', 0); }
    var mark = function (card, cls, text) {
      if (card.querySelector('.xp-badge')) return;
      var b = document.createElement('span'); b.className = 'xp-badge ' + cls; b.textContent = text; card.appendChild(b);
    };
    document.querySelectorAll('a.show-card, a.news-card').forEach(function (c) {
      var u = decodeURI(c.getAttribute('href') || '');
      if (seenSet[u] || seenSet[encodeURI(u)]) mark(c, 'seen', '✓ شاهدته');
    });
    if (lastVisit) {
      fetch('/watcher-recent-content.json', { cache: 'force-cache' }).then(function (r) { return r.json(); }).then(function (feed) {
        var fresh = {};
        feed.forEach(function (it) { var t = Date.parse(it.published_at || it.date || ''); if (t > lastVisit) fresh[decodeURI(it.url)] = 1; });
        document.querySelectorAll('a.show-card, a.news-card').forEach(function (c) {
          var u = decodeURI(c.getAttribute('href') || '');
          if (fresh[u] && !seenSet[u]) mark(c, 'new', 'جديد');
        });
      }).catch(function () {});
    }
    addEventListener('pagehide', function () { store.set('arw-last-visit', Date.now()); });

    // 4. Back to top with a reading ring
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'xp-top'; btn.setAttribute('aria-label', 'العودة إلى أعلى الصفحة');
    btn.innerHTML = '<svg class="ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="22"/><circle class="fg" cx="24" cy="24" r="22"/></svg><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(btn);
    var fg = btn.querySelector('.fg');
    btn.addEventListener('click', function () { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
    var tick = false;
    addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () {
        var y = scrollY || 0, h = document.documentElement.scrollHeight - innerHeight;
        btn.classList.toggle('show', y > 900);
        fg.style.strokeDashoffset = String(138.2 * (1 - (h > 0 ? Math.min(1, y / h) : 0)));
        tick = false;
      });
    }, { passive: true });

    // 5. The theme switches with a soft flash (owner 2026-10-09, instead of the circle from the button): a veil in the
    //    new theme's colour fades in, the theme changes under it, and it fades away. Plain animations, so it works in
    //    every browser (the circle needed View Transitions, which older iPhones don't have).
    var toggle = document.getElementById('arwThemeToggle');
    if (toggle && !reduce && document.documentElement.animate) {
      var busy = false;
      toggle.addEventListener('click', function (e) {
        if (e.xpReplay) return;
        e.stopImmediatePropagation(); e.preventDefault();
        if (busy) return; busy = true;
        var toDark = !document.documentElement.classList.contains('arw-dark');
        var veil = document.createElement('div');
        veil.className = 'xp-theme-flash' + (toDark ? ' to-dark' : ' to-light');
        document.body.appendChild(veil);
        var done = function () { veil.remove(); busy = false; };
        veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'ease-out', fill: 'forwards' }).finished.then(function () {
          var ev = new MouseEvent('click', { bubbles: true, cancelable: true }); ev.xpReplay = true; toggle.dispatchEvent(ev);
          return veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished;
        }).then(done, done);
      }, true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
