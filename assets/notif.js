(function () {
  'use strict';

  var TG_DISMISSED_KEY = 'arw_tg_float_dismissed_v2';
  var TELEGRAM_URL = 'https://t.me/arab_wrestling';

  function createTelegramFloatBar() {
    if (document.getElementById('arwTgFloatBar')) return;

    var bar = document.createElement('div');
    bar.className = 'notif-float-bar tg-float-bar';
    bar.id = 'arwTgFloatBar';

    bar.innerHTML =
      '<button aria-label="إغلاق" class="tg-close-btn" id="arwTgDismissCross" type="button">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '</button>' +
      '<div class="notif-float-header tg-float-header">' +
        '<div class="tg-icon-badge">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l-.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/></svg>' +
        '</div>' +
        '<div>' +
          '<div class="tg-title">تابعنا على التليجرام 📢</div>' +
          '<div class="tg-subtitle">عرب راسلنج</div>' +
        '</div>' +
      '</div>' +
      '<div class="notif-float-body tg-float-body">' +
        'اشترك في قناتنا الرسمية على التليجرام ليصلك تنبيه فور إضافة العروض والملخصات والأخبار الجديدة أولاً بأول!' +
      '</div>' +
      '<div class="notif-float-actions tg-float-actions">' +
        '<a class="notif-float-accept tg-float-btn" href="' + TELEGRAM_URL + '" target="_blank" rel="noopener" id="arwTgJoinBtn">' +
          '<span>انضم للقناة الآن</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
        '</a>' +
        '<button class="notif-float-dismiss tg-float-dismiss" id="arwTgDismissBtn" type="button">ليس الآن</button>' +
      '</div>';

    document.body.appendChild(bar);

    function hideBar() {
      bar.classList.remove('show');
      setTimeout(function () {
        if (bar && bar.parentNode) {
          bar.parentNode.removeChild(bar);
        }
      }, 400);
    }

    var joinBtn = document.getElementById('arwTgJoinBtn');
    if (joinBtn) {
      joinBtn.addEventListener('click', function () {
        hideBar();
      });
    }

    var dismissBtn = document.getElementById('arwTgDismissBtn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', hideBar);
    }

    var crossBtn = document.getElementById('arwTgDismissCross');
    if (crossBtn) {
      crossBtn.addEventListener('click', hideBar);
    }

    setTimeout(function () {
      bar.classList.add('show');
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createTelegramFloatBar);
  } else {
    createTelegramFloatBar();
  }
})();
