// Service Worker for Arab Wrestling Notifications (Shows & Recaps, and answers to a visitor's comments)

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.indexOf(targetUrl) !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── answers to the visitor's comments (owner 2026-10-14: «يجي تنبيه للمتابع لما … حد يرد عليه») ──
// The comments' worker wakes this with an empty push (worker/src/comment-push.ts); the visitor's key (given by
// assets/comments.js when they allowed notifications) asks it what the answers are.
var CM_API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/comments';
function cmDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('arw_comments', 1);
    req.onupgradeneeded = function (e) { e.target.result.createObjectStore('kv'); };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = reject;
  });
}
function cmGet(k) {
  return cmDB().then(function (db) {
    return new Promise(function (resolve) { var r = db.transaction('kv', 'readonly').objectStore('kv').get(k); r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { resolve(undefined); }; });
  }).catch(function () { return undefined; });
}
function cmSet(k, v) {
  return cmDB().then(function (db) {
    return new Promise(function (resolve) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = resolve; tx.onerror = resolve; });
  }).catch(function () {});
}
function commentReplies() {
  return Promise.all([cmGet('k'), cmGet('since'), cmGet('en')]).then(function (v) {
    var key = v[0], since = v[1] || 0, en = !!v[2];
    if (!key) return false;
    return fetch(CM_API + '/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: key, since: since }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = (d && d.items) || [];
        if (!items.length) return false;
        return cmSet('since', Math.max.apply(null, items.map(function (i) { return i.at; }))).then(function () {
          return Promise.all(items.slice(0, 3).map(function (it) {
            var who = it.official ? (en ? 'Arab Wrestling' : 'عرب راسلنج') : it.name;
            var title = it.kind === 'heart' ? (en ? 'Arab Wrestling liked your comment ❤️' : 'أعجب عرب راسلنج بتعليقك ❤️') : (en ? who + ' replied to your comment' : who + ' رد على تعليقك');
            return self.registration.showNotification(title, {
              body: it.text, icon: it.official ? (en ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png') : '/favicon.png', badge: '/favicon.png',
              dir: en ? 'ltr' : 'rtl', lang: en ? 'en' : 'ar', tag: 'cm-' + (it.kind || 'reply') + '-' + it.id, data: { url: it.url }
            });
          })).then(function () { return true; });
        });
      })
      .catch(function () { return false; });
  });
}

// «المتابعة» (owner 2026-10-15): a new full show of a program or promotion the member follows. The page gave this
// device its own key (ARW_FOLLOW_PK); with it the worker tells what's new, and nothing else of the member's.
var FOLLOW_API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/follow';
function followNews() {
  return Promise.all([cmGet('fpk'), cmGet('fsince'), cmGet('fen')]).then(function (v) {
    var pk = v[0], since = v[1] || 0, en = !!v[2];
    if (!pk) return false;
    return fetch(FOLLOW_API + '/peek', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pk: pk, since: since }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = (d && d.items) || [];
        if (!items.length) return false;
        return cmSet('fsince', Math.max.apply(null, items.map(function (i) { return i.at; }))).then(function () {
          return Promise.all(items.slice(0, 3).map(function (it) {
            var opts = {
              body: en ? (it.title_en || it.title) : it.title,
              icon: '/assets/brand-logo.png', badge: '/favicon.png', dir: en ? 'ltr' : 'rtl', lang: en ? 'en' : 'ar',
              tag: 'follow-' + it.url, renotify: false, data: { url: (en ? '/en' : '') + it.url }
            };
            if (it.image) opts.image = it.image;
            var pred = /^\/predictions\//.test(it.url);
            return self.registration.showNotification(pred ? (en ? 'Your predictions results 🏆' : 'نتائج توقعاتك 🏆') : en ? 'New translated show 🔔' : 'عرض جديد مترجم 🔔' + (it.program ? ' | ' + it.program : ''), opts);
          })).then(function () { return true; });
        });
      })
      .catch(function () { return false; });
  });
}

// Helper for IndexedDB storage inside Service Worker
function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('arw_notif_db', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('seen_urls')) {
        db.createObjectStore('seen_urls', { keyPath: 'url' });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e); };
  });
}

function getSeenUrlsFromIDB() {
  return openDB().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction('seen_urls', 'readonly');
      var store = tx.objectStore('seen_urls');
      var req = store.getAll();
      req.onsuccess = function() {
        var map = {};
        (req.result || []).forEach(function(row) { map[row.url] = row.timestamp; });
        resolve(map);
      };
      req.onerror = function() { resolve({}); };
    });
  }).catch(function() { return {}; });
}

function saveSeenUrlToIDB(url) {
  return openDB().then(function(db) {
    var tx = db.transaction('seen_urls', 'readwrite');
    var store = tx.objectStore('seen_urls');
    store.put({ url: url, timestamp: Date.now() });
  }).catch(function() {});
}

async function checkNewContentSW() {
  try {
    var res = await fetch('/search-index.json?_t=' + Date.now());
    if (!res.ok) return;
    var items = await res.json();
    if (!Array.isArray(items)) return;

    var seenMap = await getSeenUrlsFromIDB();
    var isFirstRun = (Object.keys(seenMap).length === 0);
    var newItemsToNotify = [];

    items.forEach(function(item) {
      if (!item || !item.url) return;

      // EXCLUSIVELY SHOWS AND RECAPS - NO NEWS EVER!
      var isShow = item.kind === 'show' || item.url.indexOf('/shows/') === 0;
      var isRecap = item.kind === 'recap' || item.url.indexOf('/recaps/') === 0;
      var isNews = item.kind === 'news' || item.url.indexOf('/news/') === 0;

      if (isNews || (!isShow && !isRecap)) {
        saveSeenUrlToIDB(item.url);
        return;
      }

      if (!seenMap[item.url]) {
        if (!isFirstRun) {
          newItemsToNotify.push(item);
        }
        saveSeenUrlToIDB(item.url);
      }
    });

    if (newItemsToNotify.length > 0) {
      newItemsToNotify.slice(0, 3).forEach(function(item) {
        var label = item.kindLabel || (item.kind === 'show' ? 'عرض جديد' : 'ملخص جديد');
        var title = 'عرب راسلنج 🔔 | ' + label + ': ' + (item.title || '');
        var body = item.headline || item.description || 'تم إضافة عرض/ملخص جديد على الموقع. اضغط للمشاهدة الآن.';
        self.registration.showNotification(title, {
          body: body,
          icon: item.image || '/favicon.png',
          badge: '/favicon.png',
          dir: 'rtl',
          lang: 'ar',
          data: { url: item.url }
        });
      });
    }
  } catch(e) {
    console.error('Error in SW checkNewContentSW:', e);
  }
}

// Periodic background sync event
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'check-shows-recaps') {
    event.waitUntil(checkNewContentSW());
  }
});

// Push event (when background push payload is received from server)
self.addEventListener('push', function(event) {
  if (event.data) {
    try {
      var data = event.data.json();
      // STRICT RULE: NO NEWS NOTIFICATIONS EVER!
      var isNews = data.kind === 'news' || (data.url && data.url.indexOf('/news/') !== -1);
      if (isNews) return;

      var title = data.title || 'عرب راسلنج 🔔 | عرض/ملخص جديد';
      var body = data.body || 'تم إضافة عرض/ملخص جديد على الموقع. اضغط للمشاهدة الآن.';
      var options = {
        body: body,
        icon: data.image || '/favicon.png',
        badge: '/favicon.png',
        dir: 'rtl',
        lang: 'ar',
        data: { url: data.url || '/' }
      };

      event.waitUntil(self.registration.showNotification(title, options));
      return;
    } catch(e) {
      console.warn('Error parsing push data, falling back to fetch:', e);
    }
  }
  // an empty push: the comments' worker (someone answered this visitor); a push must always show something
  // (or a new show of what this member follows: both are asked, whichever has something shows it)
  event.waitUntil(Promise.all([cmGet('k'), cmGet('fpk')]).then(function (v) {
    if (!v[0] && !v[1]) return checkNewContentSW();
    return Promise.all([v[0] ? commentReplies() : false, v[1] ? followNews() : false]).then(function (r) {
      if (!r[0] && !r[1]) return self.registration.showNotification('عرب راسلنج', { body: v[1] && !v[0] ? 'عرض جديد مترجم مما تتابعه' : 'لديك تنبيه جديد على تعليقك', icon: '/assets/brand-logo.png', badge: '/favicon.png', dir: 'rtl', lang: 'ar', tag: 'cm-new', data: { url: '/' } });
    });
  }));
});

// Message handler from client
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SYNC_SEEN_URLS') {
    if (Array.isArray(event.data.urls)) {
      event.data.urls.forEach(function(u) { saveSeenUrlToIDB(u); });
    }
  } else if (event.data && event.data.type === 'ARW_CM_KEY' && /^[A-Za-z0-9_-]{20,64}$/.test(event.data.k || '')) {
    // the visitor allowed notifications: their key, and the time from which answers are new
    event.waitUntil(Promise.all([cmSet('k', event.data.k), cmGet('since').then(function (s) { return s ? 0 : cmSet('since', Number(event.data.since) || Date.now()); }), cmSet('en', !!event.data.en)]));
  } else if (event.data && event.data.type === 'ARW_FOLLOW_PK' && /^[A-Za-z0-9_-]{32}$/.test(event.data.pk || '')) {
    // the member allowed notifications for what they follow: this device's key, and new from now on
    event.waitUntil(Promise.all([cmSet('fpk', event.data.pk), cmGet('fsince').then(function (s) { return s ? 0 : cmSet('fsince', Date.now()); }), cmSet('fen', !!event.data.en)]));
  } else if (event.data && event.data.type === 'CHECK_NEW_CONTENT') {
    event.waitUntil(checkNewContentSW());
  }
});
