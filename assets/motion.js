/* Site motion (INCIDENTS #178) — see motion.css. Nothing here is required to read the page:
   if this file fails, every card and image is simply shown as it is. */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  var root = document.documentElement;
  root.classList.add('m-on');

  var CARDS = '.show-card, .news-card, .fed-card, .tag-card, .recap-card, .lib-card, .nost-card';

  // 2. Cascade: number each card within its row so the delay follows the reading order
  var seen = new WeakSet();
  function prepare(scope) {
    var cards = (scope || document).querySelectorAll(CARDS);
    var groups = new Map();
    cards.forEach(function (c) {
      if (seen.has(c)) return;
      seen.add(c);
      c.classList.add('m-card');
      var g = c.parentElement;
      var n = groups.get(g) || 0;
      groups.set(g, n + 1);
      c.style.setProperty('--m-i', String(n % 8));
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) tilt(c);
      cardIO.observe(c);
    });
    (scope || document).querySelectorAll('.section-head').forEach(function (h) { if (!seen.has(h)) { seen.add(h); headIO.observe(h); } });
    (scope || document).querySelectorAll('img').forEach(fadeImage);
  }
  var cardIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('m-in'); cardIO.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  var headIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('m-in'); headIO.unobserve(e.target); } });
  }, { threshold: 0.4 });

  // 3. Desktop tilt toward the pointer
  function tilt(card) {
    card.classList.add('m-tilt');
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    var raf = 0;
    card.addEventListener('pointermove', function (ev) {
      var r = card.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        card.classList.add('m-tilting');
        card.style.setProperty('--m-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--m-y', (y * 100).toFixed(1) + '%');
        card.style.transform = 'perspective(900px) rotateX(' + ((0.5 - y) * 7).toFixed(2) + 'deg) rotateY(' + ((x - 0.5) * 9).toFixed(2) + 'deg) translateY(-6px)';
      });
    });
    card.addEventListener('pointerleave', function () {
      cancelAnimationFrame(raf);
      card.classList.remove('m-tilting');
      card.style.transform = '';
    });
  }

  // 5. Images fade in sharp — only those still loading (a cached image shows at once)
  function fadeImage(img) {
    if (seen.has(img)) return;
    seen.add(img);
    if (img.complete && img.naturalWidth) return;
    if (img.closest('header, .spotlight, .hero, nav, footer')) return;
    img.classList.add('m-img');
    var done = function () { img.classList.add('m-loaded'); };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, 4000);
  }

  // 6. Header + 7. reading bar
  var bar = null;
  if (document.querySelector('article, .post-body, .article-body')) {
    bar = document.createElement('div');
    bar.className = 'm-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      root.classList.toggle('m-scrolled', y > 80);
      if (bar) {
        var h = document.documentElement.scrollHeight - innerHeight;
        bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0).toFixed(4) + ')';
      }
      ticking = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });

  // 8. Home headline, word by word
  var h1 = document.querySelector('.hero h1, .hero-title, .home-hero h1');
  if (h1 && !h1.dataset.mSplit && location.pathname === '/') {
    h1.dataset.mSplit = '1';
    var w = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var s = document.createElement('span');
            s.className = 'm-word';
            s.style.setProperty('--m-w', String(w++));
            s.textContent = part;
            frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    })(h1);
  }

  function start() {
    prepare(document);
    onScroll();
    // Cards added later (load more, filters) join the motion too
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) prepare(n.parentElement || document); }); });
    }).observe(document.body, { childList: true, subtree: true });
    // Safety net: nothing stays hidden if an observer never fires
    setTimeout(function () { document.querySelectorAll('.m-card:not(.m-in)').forEach(function (c) { var r = c.getBoundingClientRect(); if (r.top < innerHeight) c.classList.add('m-in'); }); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
