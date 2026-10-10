// Moved out of _includes/post-layout.njk so the ~2,900 article pages share one cached copy (INCIDENTS #311).
  function deobfuscateUrl(str) {
    if (!str || typeof str !== 'string') return '';
    try {
      return atob(str.split('').reverse().join(''));
    } catch (e) {
      return '';
    }
  }

  // ==== نظام روابط التحميل (منخفضة/متوسطة/عالية) ====
  (function(){
    function prepareDlCard(card){
      if (!card || !card.dataset.dl || card.dataset.ready) return;
      var url = deobfuscateUrl(card.dataset.dl);
      if (url) {
        card.href = url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer nofollow';
        card.dataset.ready = '1';
      }
    }

    function openModal(modal){
      if(!modal) return;
      modal.querySelectorAll('.dl-site-card').forEach(prepareDlCard);
      modal.classList.add('open');
      document.body.classList.add('dl-modal-lock');
    }
    function closeModal(modal){
      if(!modal) return;
      modal.classList.remove('open');
      document.body.classList.remove('dl-modal-lock');
    }
    document.querySelectorAll('.quality-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var modal = document.getElementById(btn.getAttribute('data-modal'));
        openModal(modal);
      });
    });
    document.querySelectorAll('.dl-modal-backdrop').forEach(function(backdrop){
      backdrop.addEventListener('click', function(e){
        if(e.target === backdrop) closeModal(backdrop);
      });
      var closeBtn = backdrop.querySelector('.dl-modal-close');
      if(closeBtn){
        closeBtn.addEventListener('click', function(){ closeModal(backdrop); });
      }
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        document.querySelectorAll('.dl-modal-backdrop.open').forEach(closeModal);
      }
    });

    // Decoding on pointerdown ensures native link behavior without popup blockers
    document.addEventListener('pointerdown', function(e){
      var card = e.target.closest && e.target.closest('.dl-site-card');
      if (card) prepareDlCard(card);
    }, { passive: true });

    document.addEventListener('click', function(e){
      var card = e.target.closest && e.target.closest('.dl-site-card');
      if (card) {
        prepareDlCard(card);
        if (!card.href || card.getAttribute('href') === '#') {
          e.preventDefault();
        }
      }
    });
  })();

  function toEmbedUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    var url = raw.trim();
    url = url.replace(/^https?:\/\/(?:m\.)?ok\.ru\/video\/(\d+)/i, 'https://ok.ru/videoembed/$1');
    url = url.replace(/^https?:\/\/(vidtube\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(uqload\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(streamtape\.[a-z]+)\/v\/([a-zA-Z0-9_-]+)(?:\/[^\s?]*)?/i, 'https://$1/e/$2');
    url = url.replace(/^https?:\/\/(dood(?:stream)?\.[a-z]+)\/d\/([a-zA-Z0-9_-]+)/i, 'https://$1/e/$2');
    url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(vidmoly\.[a-z]+)\/(?!embed-)(?:w\/)?([a-zA-Z0-9_-]+)(?:\.html)?(?:[\/?].*)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(?:streamwish\.[a-z]+|swish\.[a-z]+|wishfast\.[a-z]+|awish\.[a-z]+|mwish\.[a-z]+|sfastwish\.[a-z]+)\/(?:[fe]\/)?([a-zA-Z0-9_-]+)/i, 'https://streamwish.to/e/$1');
    url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:hgcloud|streamhg|shgcloud|hgplayer|hgstream)\.[a-zA-Z0-9-]+\/(?:[dfe]\/)?([a-zA-Z0-9_-]+)(?:[\/?].*)?$/i, 'https://hgcloud.to/e/$1');
    url = url.replace(/^https?:\/\/(?:filelions\.[a-z]+|lion\.[a-z]+)\/(?:[vf]\/)?([a-zA-Z0-9_-]+)/i, 'https://filelions.to/v/$1');
    url = url.replace(/^https?:\/\/([a-z0-9.-]*fe(?:mbed|url)[a-z0-9.-]*)\/[vf]\/([a-zA-Z0-9_-]+)/i, 'https://$1/embed/$2');
    url = url.replace(/^https?:\/\/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)(?:\?.*)?$/i, 'https://pixeldrain.com/api/file/$1');
    url = url.replace(/^https?:\/\/(?:cdn\.)?loadvid\.com\/(?:v|watch)\/([a-zA-Z0-9_-]+)/i, 'https://cdn.loadvid.com/videos/play/$1');
    url = url.replace(/^https?:\/\/turbovidhls\.com\/(?:v\/)?([a-zA-Z0-9_-]+)$/i, 'https://turbovidhls.com/t/$1');
    url = url.replace(/^https?:\/\/voe\.sx\/(?!e\/)([a-zA-Z0-9_-]+)$/i, 'https://voe.sx/e/$1');
    url = url.replace(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+).*/i, 'https://www.youtube.com/embed/$1');
    url = url.replace(/^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+).*/i, 'https://www.youtube.com/embed/$1');
    url = url.replace(/^https?:\/\/(?:www\.)?dailymotion\.com\/video\/([a-zA-Z0-9_-]+).*/i, 'https://www.dailymotion.com/embed/video/$1');
    url = url.replace(/^https?:\/\/dai\.ly\/([a-zA-Z0-9_-]+)/i, 'https://www.dailymotion.com/embed/video/$1');
    url = url.replace(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+).*/i, 'https://player.vimeo.com/video/$1');
    return url;
  }

  var currentActiveServerSrc = '';
  var loader = document.getElementById('videoLoader');
  var loaderStatus = document.getElementById('videoLoaderStatus');
  var loaderFallback = document.getElementById('videoLoaderFallback');
  var loaderTimer = null;

  var loaderBar = document.getElementById('videoLoaderBar');
  function setLoaderProgress(pct) { if (loaderBar) loaderBar.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  var watchDeck = document.getElementById('watchDeck');
  function setLoader(visible, text) {
    if (!loader) return;
    if (watchDeck) watchDeck.classList.toggle('is-loading', !!visible);
    if (loaderTimer) { clearTimeout(loaderTimer); loaderTimer = null; }
    if (visible) {
      loader.classList.remove('is-hidden');
      if (loaderStatus && text) loaderStatus.textContent = text;
      if (loaderFallback) loaderFallback.style.display = 'none';
      setLoaderProgress(8);
      loaderTimer = setTimeout(function(){
        if (loaderFallback && !loader.classList.contains('is-hidden')) {
          loaderFallback.style.display = 'flex';
        }
      }, 9000);
    } else {
      setLoaderProgress(100);
      loader.classList.add('is-hidden');
    }
  }

  // Every mount gets a number: a late load event from the previous server must not hide the new loader.
  var mountSeq = 0;
  function mountVideo(box, rawSrc, serverLabel) {
    if (!box || !rawSrc) return;
    if (watchDeck) watchDeck.classList.remove('is-idle');
    var seq = ++mountSeq;
    var mountedAt = Date.now();
    currentActiveServerSrc = rawSrc;
    var src = toEmbedUrl(rawSrc);
    var isDirect = src.includes('pixeldrain.com/api/file/') || /\.mp4(\?|$)/i.test(src) || /\.webm(\?|$)/i.test(src);

    setLoader(true, 'جاري الاتصال بـ ' + (serverLabel || 'السيرفر') + ' وتشغيل الفيديو...');

    // Clear existing frames/videos safely
    var existingIframe = box.querySelector('#videoFrame');
    if (existingIframe) existingIframe.remove();
    var existingVideo = box.querySelector('#videoPlayer');
    if (existingVideo) {
      try { existingVideo.pause(); existingVideo.removeAttribute('src'); existingVideo.load(); } catch(e){}
      existingVideo.remove();
    }

    if (isDirect) {
      var v = document.createElement('video');
      v.id = 'videoPlayer';
      v.controls = true;
      v.playsInline = true;
      v.setAttribute('webkit-playsinline', 'true');
      v.preload = 'metadata';
      v.src = src;

      // Smart Resume Memory for direct streams
      var resumeKey = 'arw_vpos_' + window.location.pathname;
      v.addEventListener('loadedmetadata', function(){
        if (seq === mountSeq) setLoader(false);
        try {
          var saved = parseFloat(localStorage.getItem(resumeKey) || '0');
          if (saved > 10 && (!v.duration || saved < v.duration - 15)) {
            v.currentTime = saved;
          }
        } catch(e){}
      });
      v.addEventListener('canplay', function(){ if (seq === mountSeq) setLoader(false); });
      v.addEventListener('error', function(){
        if (seq !== mountSeq) return;
        if (loaderStatus) loaderStatus.textContent = 'هذا السيرفر لا يعمل حاليًا، جرّب سيرفرًا آخر';
        if (loaderFallback) loaderFallback.style.display = 'flex';
      });

      var lastSavedTime = 0;
      v.addEventListener('timeupdate', function(){
        var now = Date.now();
        if (now - lastSavedTime > 3000) {
          lastSavedTime = now;
          try {
            if (v.currentTime > 5) {
              localStorage.setItem(resumeKey, String(Math.floor(v.currentTime)));
            }
          } catch(e){}
        }
      });
      v.addEventListener('ended', function(){
        try { localStorage.removeItem(resumeKey); } catch(e){}
      });

      box.appendChild(v);
      if (v.play) { v.play().catch(function(){}); }
    } else {
      var ifr = document.createElement('iframe');
      ifr.id = 'videoFrame';
      ifr.src = src;
      ifr.allowFullscreen = true;
      ifr.setAttribute('webkitallowfullscreen', 'true');
      ifr.setAttribute('mozallowfullscreen', 'true');
      // «*» on every feature: StreamHG (hgcloud.to) moves the player to a rotating mirror (hanerix.com…),
      // and a bare «fullscreen» only delegates to the src origin — its fullscreen button did nothing (INCIDENTS #276)
      ifr.setAttribute('allow', 'autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; accelerometer *; gyroscope *');
      ifr.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      ifr.setAttribute('loading', 'eager');

      // The loader stays until the player has really loaded: hosts like StreamHG load a «Loading…» page
      // first and then move to their mirror, so every load restarts a short settle wait, and the loader
      // goes only when no new page came for that long (and never before ~1.2s, so it doesn't flicker).
      // No load at all = the server is down: the loader stays with «جرّب سيرفر تاني» (INCIDENTS #277).
      var multiStep = /hgcloud\.|streamhg|vidmoly\.|uqload\./i.test(src);
      var SETTLE_MS = multiStep ? 2400 : 1800;
      var settleTimer = null, loads = 0;
      setLoaderProgress(18);
      ifr.addEventListener('load', function(){
        if (seq !== mountSeq) return;
        loads++;
        setLoaderProgress(loads === 1 ? 55 : 80);
        if (loads === 1 && loaderStatus) loaderStatus.textContent = 'جاري تجهيز الفيديو على ' + (serverLabel || 'السيرفر') + '...';
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function(){
          if (seq !== mountSeq) return;
          setLoaderProgress(100);
          var wait = Math.max(0, 1200 - (Date.now() - mountedAt));
          setTimeout(function(){ if (seq === mountSeq) setLoader(false); }, wait + 180);
        }, SETTLE_MS);
      });

      box.appendChild(ifr);
    }
  }

  // Mount initial video player on client load
  var embedBox = document.getElementById('videoEmbedBox') || document.querySelector('.video-embed');
  var srvRows = Array.from(document.querySelectorAll('.srv-row'));
  function markServer(btn) {
    srvRows.forEach(function(b){ var on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    var now = document.getElementById('wdNow');
    if (now && btn) now.textContent = (btn.getAttribute('data-srv-name') || 'السيرفر') + (btn.dataset.mq ? ' · متعدد الجودات' : '');
  }
  // The page opens on the show's picture and a play button; pressing it starts server 1 right away
  function startPlayback() {
    if (!embedBox || currentActiveServerSrc) return;
    var first = srvRows[0] || null;
    var src = deobfuscateUrl(first ? first.dataset.srv : embedBox.dataset.initSrv);
    if (!src) return;
    if (first) markServer(first);
    mountVideo(embedBox, src, first ? first.getAttribute('data-srv-name') : 'سيرفر 1');
  }
  var posterBtn = document.getElementById('wdPoster');
  if (posterBtn) posterBtn.addEventListener('click', startPlayback);

  // Server tabs switcher
  srvRows.forEach(function(btn, idx){
    btn.addEventListener('click', function(){
      markServer(btn);
      var rawEnc = (btn.dataset.srv || '').trim();
      var box = document.getElementById('videoEmbedBox') || document.querySelector('.video-embed');
      if (!box || !rawEnc) return;

      var rawSrc = deobfuscateUrl(rawEnc);
      var srvLabel = btn.getAttribute('data-srv-name') || 'السيرفر';
      if (rawSrc) {
        mountVideo(box, rawSrc, srvLabel);
      }
    });
  });

  // Next Server Switcher (Loops seamlessly across all available servers)
  function switchToNextServer() {
    var tabs = srvRows;
    if (!tabs.length) return;
    var activeIdx = tabs.findIndex(function(t){ return t.classList.contains('active'); });
    var nextIdx = (activeIdx + 1) % tabs.length;
    tabs[nextIdx].click();
  }

  var loaderNextBtn = document.getElementById('loaderNextSrvBtn');
  if (loaderNextBtn) {
    var allTabs = srvRows;
    if (allTabs.length <= 1) {
      loaderNextBtn.textContent = 'إعادة تحديث المشغل ↻';
      loaderNextBtn.addEventListener('click', function(){ reloadCurrentServer(); });
    } else {
      loaderNextBtn.addEventListener('click', switchToNextServer);
    }
  }

  // Reload current server button
  var reloadBtn = document.getElementById('playerReloadBtn');
  function reloadCurrentServer() {
    var box = document.getElementById('videoEmbedBox') || document.querySelector('.video-embed');
    if (!box) return;
    if (!currentActiveServerSrc) { startPlayback(); return; }

    var activeTab = document.querySelector('.srv-row.active');
    var srvLabel = activeTab ? activeTab.getAttribute('data-srv-name') : 'المشغل';

    if (reloadBtn) {
      var svg = reloadBtn.querySelector('.reload-svg');
      var label = reloadBtn.querySelector('.action-text');

      if (svg) svg.classList.add('is-spinning');
      if (label) label.textContent = 'جاري التحديث...';
      reloadBtn.disabled = true;

      mountVideo(box, currentActiveServerSrc, srvLabel);

      setTimeout(function(){
        if (svg) svg.classList.remove('is-spinning');
        if (label) label.textContent = 'تم التحديث ✓';
        setTimeout(function(){
          if (label) label.textContent = 'تحديث المشغل';
          reloadBtn.disabled = false;
        }, 1000);
      }, 550);
    } else {
      mountVideo(box, currentActiveServerSrc, srvLabel);
    }
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', reloadCurrentServer);
  }

  // Cinema / Theater Mode Handler
  var cinemaBackdrop = document.getElementById('cinemaBackdrop');
  var cinemaExitFloat = document.getElementById('cinemaExitFloat');
  var cinemaBtn = document.getElementById('playerCinemaBtn');

  function toggleCinemaMode(forceState) {
    var shouldActivate = (typeof forceState === 'boolean') ? forceState : !document.body.classList.contains('cinema-mode-active');
    document.body.classList.toggle('cinema-mode-active', shouldActivate);
    if (cinemaBtn) {
      cinemaBtn.classList.toggle('is-active', shouldActivate);
      var text = cinemaBtn.querySelector('span');
      if (text) text.textContent = shouldActivate ? 'إلغاء السينما' : 'وضع السينما';
    }
    if (shouldActivate) {
      // the whole box in view under the sticky header (centered when it fits, its top edge when it doesn't)
      var container = document.getElementById('watchDeck') || embedBox;
      if (container) {
        var hdr = document.querySelector('header');
        var off = (hdr ? hdr.getBoundingClientRect().height : 0) + 12;
        var rect = container.getBoundingClientRect();
        var room = window.innerHeight - off;
        window.scrollTo({ top: window.scrollY + rect.top - off - Math.max(0, (room - rect.height) / 2), behavior: 'smooth' });
      }
    }
  }

  if (cinemaBtn) cinemaBtn.addEventListener('click', function(){ toggleCinemaMode(); });
  if (cinemaBackdrop) cinemaBackdrop.addEventListener('click', function(){ toggleCinemaMode(false); });
  if (cinemaExitFloat) cinemaExitFloat.addEventListener('click', function(){ toggleCinemaMode(false); });

  // Keyboard Shortcuts (T: Cinema, R: Reload, Esc: Exit Cinema)
  document.addEventListener('keydown', function(e){
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    var key = e.key;
    if (key === 'Escape') {
      if (document.body.classList.contains('cinema-mode-active')) {
        toggleCinemaMode(false);
      }
    } else if (key === 't' || key === 'T' || key === 'ف') {
      e.preventDefault();
      toggleCinemaMode();
    } else if (key === 'r' || key === 'R' || key === 'ق') {
      e.preventDefault();
      reloadCurrentServer();
    } else if (/^[1-9١-٩]$/.test(key)) {
      // 1–9 (or ١–٩) picks that server
      var n = /[١-٩]/.test(key) ? key.charCodeAt(0) - 0x660 : +key;
      if (srvRows[n - 1] && !srvRows[n - 1].classList.contains('active')) { e.preventDefault(); srvRows[n - 1].click(); }
    }
  });

  // ==== A server's own fullscreen button (owner 2026-10-09: black screen, only the sound, until a reload) ====
  // While a player is fullscreen the page under it drops every effect that makes the browser composite it in
  // layers (fade-in transforms, blurred glass bars, filters): those layers are what blacked out the video.
  // It came back (2026-10-10): every box around the player — its rounded, clipped frame and the deck's
  // «container-type» (which adds layout containment) — is also cleared while it is fullscreen (.arw-fs-path), and the
  // player is pushed onto a fresh layer once it is up, so the browser redraws it instead of showing a black surface.
  (function(){
    var root = document.documentElement;
    function clearPath(){
      Array.prototype.forEach.call(document.querySelectorAll('.arw-fs-path'), function(el){ el.classList.remove('arw-fs-path'); });
    }
    function sync(){
      var fs = document.fullscreenElement || document.webkitFullscreenElement || null;
      clearPath();
      root.classList.toggle('arw-fs', !!fs);
      if (!fs) return;
      for (var el = fs.parentElement; el && el !== document.documentElement; el = el.parentElement) el.classList.add('arw-fs-path');
      fs.classList.add('arw-fs-nudge');
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ fs.classList.remove('arw-fs-nudge'); }); });
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  })();
