// English pages (/en/, lib/i18n/mirror.cjs): a news headline a script puts on the page later (the search box's
// results, the saved list) is Arabic, as the news stay Arabic: it's set right to left like the ones in the page.
(function () {
  var AR = /[؀-ۿ]/;
  function mark(root) {
    if (!root || !root.ownerDocument) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (!AR.test(n.data)) continue;
      var el = n.parentElement;
      if (!el || el.closest('script,style,[lang="ar"],.lang-switch')) continue;
      var box = el.closest('div,p,h1,h2,h3,h4,h5,h6,li,a') || el;
      box.setAttribute('lang', 'ar');
      box.setAttribute('dir', 'rtl');
    }
  }
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      m.addedNodes.forEach(function (x) { mark(x.nodeType === 1 ? x : x.parentElement); });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
