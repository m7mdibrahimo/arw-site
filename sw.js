// Service Worker for Arab Wrestling Notifications (Shows & Recaps ONLY)

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
  event.waitUntil(checkNewContentSW());
});

// Message handler from client
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SYNC_SEEN_URLS') {
    if (Array.isArray(event.data.urls)) {
      event.data.urls.forEach(function(u) { saveSeenUrlToIDB(u); });
    }
  } else if (event.data && event.data.type === 'CHECK_NEW_CONTENT') {
    event.waitUntil(checkNewContentSW());
  }
});
