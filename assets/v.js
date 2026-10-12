// One real page view for the site's own statistics (owner 2026-10-12: «كل التحاليل دي تكون حقيقة 100٪», INCIDENTS #457).
// Cloudflare's numbers counted every request — search-engine and AI crawlers, the site's own bots — so «أكثر الدول» said
// the United States 52% when its real visitors were under 3%. A view is counted only when a person's browser shows the
// page: not a bot, not an automated browser, not a page Chrome prerenders in the background until it is really opened,
// not a tab opened in the background until it is looked at. No cookie and nothing stored on the visitor's device.
(function () {
  try {
    if (!/(^|\.)arab-wrestling\.com$/.test(location.hostname)) return;
    if (navigator.webdriver) return;
    if (/bot|crawl|spider|slurp|headless|lighthouse|preview|externalhit/i.test(navigator.userAgent || '')) return;
    var URL_V = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/v';
    var sent = false;
    function send() {
      if (sent) return;
      sent = true;
      var body = JSON.stringify({ p: location.pathname });
      if (navigator.sendBeacon && navigator.sendBeacon(URL_V, body)) return;
      fetch(URL_V, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }).catch(function () {});
    }
    function whenSeen() {
      if (document.visibilityState === 'visible') return send();
      document.addEventListener('visibilitychange', function f() {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', f);
        send();
      });
    }
    if (document.prerendering) document.addEventListener('prerenderingchange', whenSeen, { once: true });
    else whenSeen();
    // back/forward from the browser's cache is a new look at the page
    addEventListener('pageshow', function (e) { if (e.persisted) { sent = false; whenSeen(); } });
  } catch (e) { /* statistics never break the page */ }
})();
