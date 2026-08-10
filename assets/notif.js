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

    if (!('Notification' in window)) {
      if (statusText) statusText.textContent = 'متصفحك الحالي لا يدعم ميزة الإشعارات.';
      if (statusDot) statusDot.textContent = '⚠️';
      if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.textContent = 'الإشعارات غير مدعومة';
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
    try {
      localStorage.setItem(FLOAT_DISMISSED_KEY, 'true');
    } catch (e) {}
  }

  function checkFloatBar() {
    try {
      if (localStorage.getItem(FLOAT_DISMISSED_KEY) === 'true') return;
      if (isNotifEnabled()) return;
    } catch (e) {}

    setTimeout(function () {
      if (isNotifEnabled()) return;
      createFloatBarDOM();
      var bar = document.getElementById('arwNotifFloatBar');
      if (bar) {
        bar.classList.add('show');
      }
    }, 2800);
  }

  function handleActionBtnClick() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'denied') {
      alert('الإشعارات محظورة في متصفحك. يرجى الضغط على أيقونة القفل بجانب عنوان الموقع في المتصفح والسماح بالإشعارات (Notifications: Allow).');
      return;
    }

    if (isNotifEnabled()) {
      setNotifState(false);
      updateUI();
      return;
    }

    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        setNotifState(true);
        updateUI();
        hideFloatBar();

        try {
          new Notification('عرب راسلنج 🔔', {
            body: 'تم تفعيل إشعارات العروض والملخصات المترجمة بنجاح! ستتوصل بجديد العروض والملخصات فور نشرها.',
            icon: '/favicon.png',
            dir: 'rtl',
            lang: 'ar'
          });
        } catch (e) {}
      } else {
        setNotifState(false);
        updateUI();
      }
    });
  }

  function init() {
    var toggleBtn = document.getElementById('arwNotifToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        openModal();
      });
    }

    createModalDOM();
    updateUI();
    checkFloatBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
