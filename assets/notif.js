(function () {
  'use strict';

  var STORAGE_KEY = 'arw_notif_shows_recaps';
  var FLOAT_DISMISSED_KEY = 'arw_notif_float_dismissed';

  function isNotifEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true' && ('Notification' in window) && Notification.permission === 'granted';
    } catch (e) {
      return false;
    }
  }

  function setNotifState(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (e) {}
  }

  function createModalDOM() {
    if (document.getElementById('arwNotifModalOverlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'notif-modal-overlay';
    overlay.id = 'arwNotifModalOverlay';

    overlay.innerHTML =
      '<div class="notif-modal" id="arwNotifModal" role="dialog" aria-modal="true">' +
        '<button aria-label="إغلاق" class="notif-close-btn" id="arwNotifCloseBtn" type="button">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
        '<div class="notif-modal-icon">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C13.1 22 14 21.1 14 20H10C10 21.1 10.9 22 12 22ZM18 16V11C18 7.93 16.36 5.36 13.5 4.68V4C13.5 3.17 12.83 2.5 12 2.5C11.17 2.5 10.5 3.17 10.5 4V4.68C7.63 5.36 6 7.92 6 11V16L4 18V19H20V18L18 16Z"/></svg>' +
        '</div>' +
        '<h3>إشعارات العروض والملخصات</h3>' +
        '<div><span class="notif-scope-tag">🎬 إشعارات العروض والملخصات الحصرية</span></div>' +
        '<p>عند تفعيل الإشعارات، ستتلقى تنبيهاً فورياً على جهازك بمجرد إضافة أي عرض مصارعة حرة جديد أو ملخص مترجم لتتمكن من مشاهدته فور صدوره.</p>' +
        '<div class="notif-status-box" id="arwNotifStatusBox">' +
          '<span id="arwNotifStatusDot">⚪</span> <span id="arwNotifStatusText">جارٍ فحص حالة الإشعارات...</span>' +
        '</div>' +
        '<div class="notif-modal-actions">' +
          '<button class="notif-btn-primary" id="arwNotifActionBtn" type="button">تفعيل إشعارات العروض والملخصات</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Close handlers
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    var closeBtn = document.getElementById('arwNotifCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    var actionBtn = document.getElementById('arwNotifActionBtn');
    if (actionBtn) {
      actionBtn.addEventListener('click', handleActionBtnClick);
    }
  }

  function createFloatBarDOM() {
    if (document.getElementById('arwNotifFloatBar')) return;

    var bar = document.createElement('div');
    bar.className = 'notif-float-bar';
    bar.id = 'arwNotifFloatBar';

    bar.innerHTML =
      '<div class="notif-float-header">' +
        '<svg class="bell-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C13.1 22 14 21.1 14 20H10C10 21.1 10.9 22 12 22ZM18 16V11C18 7.93 16.36 5.36 13.5 4.68V4C13.5 3.17 12.83 2.5 12 2.5C11.17 2.5 10.5 3.17 10.5 4V4.68C7.63 5.36 6 7.92 6 11V16L4 18V19H20V18L18 16Z"/></svg>' +
        '<span>إشعارات العروض والملخصات</span>' +
      '</div>' +
      '<div class="notif-float-body">' +
        'تفعيل الإشعارات يرسل لك تنبيهاً فورياً عند إضافة أي عرض مصارعة حرة أو ملخص مترجم جديد على الموقع لتشاهده مباشرة.' +
      '</div>' +
      '<div class="notif-float-actions">' +
        '<button class="notif-float-accept" id="arwFloatAcceptBtn" type="button">تفعيل الإشعارات</button>' +
        '<button class="notif-float-dismiss" id="arwFloatDismissBtn" type="button">ليس الآن</button>' +
      '</div>';

    document.body.appendChild(bar);

    document.getElementById('arwFloatAcceptBtn').addEventListener('click', function () {
      hideFloatBar();
      openModal();
      handleActionBtnClick();
    });

    document.getElementById('arwFloatDismissBtn').addEventListener('click', function () {
      hideFloatBar();
      try {
        localStorage.setItem(FLOAT_DISMISSED_KEY, 'true');
      } catch (e) {}
    });
  }

  function updateUI() {
    var notifBtn = document.getElementById('arwNotifToggle');
    var statusText = document.getElementById('arwNotifStatusText');
    var statusDot = document.getElementById('arwNotifStatusDot');
    var actionBtn = document.getElementById('arwNotifActionBtn');

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (!('Notification' in window)) {
      if (isIOS) {
        if (statusText) statusText.textContent = 'يتطلب تفعيل الإشعارات على آيفون إضافة الموقع للشاشة الرئيسية أولاً.';
        if (statusDot) statusDot.textContent = '📱';
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'طريقة التفعيل على الآيفون';
        }
      } else {
        if (statusText) statusText.textContent = 'متصفحك الحالي لا يدعم ميزة الإشعارات.';
        if (statusDot) statusDot.textContent = '⚠️';
        if (actionBtn) {
          actionBtn.disabled = true;
          actionBtn.textContent = 'الإشعارات غير مدعومة';
        }
      }
      return;
    }

    var perm = Notification.permission;
    var enabled = isNotifEnabled();

    if (notifBtn) {
      if (enabled) {
        notifBtn.classList.add('active');
      } else {
        notifBtn.classList.remove('active');
      }
    }

    if (perm === 'denied') {
      if (statusText) statusText.textContent = 'الإشعارات محظورة من إعدادات المتصفح.';
      if (statusDot) statusDot.textContent = '🔴';
      if (actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'محظور من المتصفح (تغيير الإعدادات)';
      }
    } else if (enabled) {
      hideFloatBar();
      if (statusText) statusText.textContent = 'إشعارات العروض والملخصات مُفعلة بنجاح!';
      if (statusDot) statusDot.textContent = '🟢';
      if (actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'إلغاء تفعيل الإشعارات';
        actionBtn.style.background = 'var(--coral)';
      }
    } else {
      if (statusText) statusText.textContent = 'الإشعارات متوقفة حالياً. اضغط لتفعيلها.';
      if (statusDot) statusDot.textContent = '⚪';
      if (actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'تفعيل إشعارات العروض والملخصات';
        actionBtn.style.background = 'var(--teal)';
      }
    }
  }

  function openModal() {
    createModalDOM();
    updateUI();
    var overlay = document.getElementById('arwNotifModalOverlay');
    if (overlay) {
      overlay.classList.add('open');
    }
  }

  function closeModal() {
    var overlay = document.getElementById('arwNotifModalOverlay');
    if (overlay) {
      overlay.classList.remove('open');
    }
  }

  function showFloatBar() {
    if (isNotifEnabled()) return;
    createFloatBarDOM();
    var bar = document.getElementById('arwNotifFloatBar');
    if (bar) {
      bar.style.display = 'block';
      setTimeout(function () {
        if (bar) bar.classList.add('show');
      }, 50);
    }
  }

  function hideFloatBar() {
    var bar = document.getElementById('arwNotifFloatBar');
    if (bar) {
      bar.classList.remove('show');
      setTimeout(function () {
        if (bar && !bar.classList.contains('show')) {
          bar.style.display = 'none';
        }
      }, 400);
    }
  }

  function checkFloatBar() {
    try {
      if (localStorage.getItem(FLOAT_DISMISSED_KEY) === 'true') return;
      if (isNotifEnabled()) return;
    } catch (e) {}

    setTimeout(function () {
      if (isNotifEnabled()) return;
      showFloatBar();
    }, 2800);
  }

  var SEEN_URLS_KEY = 'arw_notified_content_urls_v1';

  function urlBase64ToUint8Array(base64String) {
    var paddingCount = (4 - (base64String.length % 4)) % 4;
    var padding = '';
    for (var p = 0; p < paddingCount; p++) { padding += '='; }
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function subscribeToWebPush() {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (!reg || !reg.pushManager) return;

      reg.pushManager.getSubscription().then(function (existingSub) {
        if (existingSub) {
          // إذا كان الاشتراك موجوداً بالفعل، نقوم بإرساله وتأكيده مع السيرفر مباشرة
          return fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: existingSub })
          });
        }

        // إنشاء اشتراك جديد إذا لم يكن موجوداً
        return fetch('/api/push/public-key')
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data || !data.publicKey) return;
            var convertedKey = urlBase64ToUint8Array(data.publicKey);
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: convertedKey
            });
          })
          .then(function (subscription) {
            if (!subscription) return;
            return fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: subscription })
            });
          });
      }).catch(function (err) {
        console.log('Web push subscription warning:', err);
      });
    });
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        if ('periodicSync' in reg) {
          try {
            reg.periodicSync.register('check-shows-recaps', {
              minInterval: 12 * 60 * 60 * 1000
            }).catch(function () {});
          } catch (e) {}
        }
        if (('Notification' in window) && Notification.permission === 'granted') {
          setNotifState(true);
          subscribeToWebPush();
        }
      }).catch(function (e) {
        console.log('SW registration error:', e);
      });
    }
  }

  function sendBrowserNotification(title, options) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, options);
      }).catch(function () {
        try {
          var n = new Notification(title, options);
          if (options && options.data && options.data.url) {
            n.onclick = function () {
              window.focus();
              window.location.href = options.data.url;
            };
          }
        } catch (e) {}
      });
    } else {
      try {
        var n = new Notification(title, options);
        if (options && options.data && options.data.url) {
          n.onclick = function () {
            window.focus();
            window.location.href = options.data.url;
          };
        }
      } catch (e) {}
    }
  }

  function checkForNewContent() {
    if (!isNotifEnabled()) return;

    fetch('/search-index.json?_t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (items) {
        if (!Array.isArray(items)) return;

        var seenMap = {};
        try {
          seenMap = JSON.parse(localStorage.getItem(SEEN_URLS_KEY) || '{}');
        } catch (e) {}

        var isFirstRun = (Object.keys(seenMap).length === 0);
        var newItemsToNotify = [];

        items.forEach(function (item) {
          if (!item || !item.url) return;

          var isShow = item.kind === 'show' || (item.url && item.url.indexOf('/shows/') === 0);
          var isRecap = item.kind === 'recap' || (item.url && item.url.indexOf('/recaps/') === 0);
          var isNews = item.kind === 'news' || (item.url && item.url.indexOf('/news/') === 0);

          // STRICTLY IGNORE NEWS - NOTIFICATIONS ARE FOR SHOWS & RECAPS ONLY
          if (isNews || (!isShow && !isRecap)) {
            seenMap[item.url] = Date.now();
            return;
          }

          if (!seenMap[item.url]) {
            if (!isFirstRun) {
              newItemsToNotify.push(item);
            }
            seenMap[item.url] = Date.now();
          }
        });

        try {
          localStorage.setItem(SEEN_URLS_KEY, JSON.stringify(seenMap));
        } catch (e) {}

        // Sync seen URLs with Service Worker IDB
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          try {
            navigator.serviceWorker.controller.postMessage({
              type: 'SYNC_SEEN_URLS',
              urls: Object.keys(seenMap)
            });
          } catch(e) {}
        }

        if (newItemsToNotify.length > 0) {
          newItemsToNotify.slice(0, 3).forEach(function (item) {
            var label = item.kindLabel || (item.kind === 'show' ? 'عرض جديد' : 'ملخص جديد');
            var title = 'عرب راسلنج 🔔 | ' + label + ': ' + (item.title || '');
            var body = item.headline || item.description || 'تم إضافة عرض/ملخص جديد على الموقع. اضغط للمشاهدة الآن.';
            sendBrowserNotification(title, {
              body: body,
              icon: item.image || '/favicon.png',
              badge: '/favicon.png',
              dir: 'rtl',
              lang: 'ar',
              data: { url: item.url }
            });
          });
        }
      })
      .catch(function (err) {
        console.warn('Error checking for new content:', err);
      });
  }

  function handleActionBtnClick() {
    if (!('Notification' in window)) {
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS) {
        alert('لتفعيل الإشعارات على آيفون (iOS):\n\n1. اضغط على زر المشاركة (Share ⎋) في أسفل متصفح سفاري.\n2. اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen).\n3. افتح الموقع من أيقونته الجديدة على الشاشة الرئيسية وفعّل الإشعارات من هناك.');
      }
      return;
    }

    if (Notification.permission === 'denied') {
      alert('الإشعارات محظورة في متصفحك. لإعادة السماح بها، انقر على أيقونة القفل (🔒) بجوار رابط الموقع ثم اختر السماح بالإشعارات.');
      return;
    }

    if (isNotifEnabled()) {
      setNotifState(false);
      try {
        localStorage.removeItem(FLOAT_DISMISSED_KEY);
      } catch (e) {}

      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.pushManager) {
            reg.pushManager.getSubscription().then(function (sub) {
              if (sub) sub.unsubscribe();
            });
          }
        }).catch(function () {});
      }

      updateUI();
      showFloatBar();
      return;
    }

    var enableAndNotify = function () {
      setNotifState(true);
      updateUI();
      hideFloatBar();
      registerSW();

      sendBrowserNotification('عرب راسلنج 🔔', {
        body: 'تم تفعيل إشعارات العروض والملخصات المترجمة بنجاح! ستتوصل بجديد العروض والملخصات فور نشرها.',
        icon: '/favicon.png',
        dir: 'rtl',
        lang: 'ar'
      });

      setTimeout(checkForNewContent, 1000);
    };

    if (Notification.permission === 'granted') {
      enableAndNotify();
    } else {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') {
          enableAndNotify();
        } else {
          setNotifState(false);
          updateUI();
        }
      });
    }
  }

  function init() {
    registerSW();

    var toggleBtn = document.getElementById('arwNotifToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        openModal();
      });
    }

    createModalDOM();
    updateUI();
    checkFloatBar();

    if (isNotifEnabled()) {
      checkForNewContent();
      setInterval(checkForNewContent, 20000);
    }

    if ('BroadcastChannel' in window) {
      var bc = new BroadcastChannel('arw_notifications');
      bc.onmessage = function (e) {
        if (e && e.data && e.data.type === 'new_post') {
          checkForNewContent();
        }
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
