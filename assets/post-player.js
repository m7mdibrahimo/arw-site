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

  // ==== Fullscreen (owner 2026-10-10: «وضع السينما» replaced by «ملء الشاشة», and turning the device sideways) ====
  // A server's own fullscreen button runs inside its iframe, and browsers treat that differently on every device: black
  // with only the sound in Chrome on a Mac, nothing at all on a tablet — while the same link on its own page works.
  // «ملء الشاشة» is the site's: the player box (video inside) fills the screen through the page itself, the way the
  // server's own page does it. Where the browser has no fullscreen for an element (iPhone) the box fills the screen
  // by itself (.arw-pfs) with an × to leave; turning a phone or tablet sideways while a video plays does the same.
  // While anything is fullscreen the page under it keeps no layer effects and is hidden (.arw-fs-path / .arw-fs-el):
  // the server's own button stays and is covered by that too (black screen, INCIDENTS #386).
  var playerFs = (function(){
    var root = document.documentElement;
    var box = embedBox;
    var fsBtn = document.getElementById('playerFsBtn');
    var pseudo = null; // 'button' | 'rotate' while the box fills the screen by itself
    function realFs(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function clearPath(){
      Array.prototype.forEach.call(document.querySelectorAll('.arw-fs-path, .arw-fs-el'), function(el){ el.classList.remove('arw-fs-path', 'arw-fs-el'); });
    }
    function markPage(fs){
      clearPath();
      root.classList.toggle('arw-fs', !!fs);
      if (!fs) return;
      for (var el = fs.parentElement; el && el !== document.documentElement; el = el.parentElement) el.classList.add('arw-fs-path');
      fs.classList.add('arw-fs-el', 'arw-fs-nudge');
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ fs.classList.remove('arw-fs-nudge'); }); });
    }
    function lockLandscape(){ try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function(){}); } catch(e){} }
    function unlockOrientation(){ try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch(e){} }
    function sync(){
      var fs = realFs();
      markPage(fs || (pseudo ? box : null));
      if (!fs) unlockOrientation();
      if (fsBtn) fsBtn.setAttribute('aria-pressed', fs === box || pseudo ? 'true' : 'false');
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);

    var exitBtn = null;
    if (box) {
      exitBtn = document.createElement('button');
      exitBtn.type = 'button';
      exitBtn.className = 'pfs-exit';
      exitBtn.setAttribute('aria-label', 'الخروج من ملء الشاشة');
      exitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      exitBtn.addEventListener('click', function(){
        var fs = realFs();
        if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else exitPseudo();
      });
      box.appendChild(exitBtn);
    }
    function enterPseudo(kind){
      if (!box || pseudo) return;
      pseudo = kind;
      box.classList.add('arw-pfs');
      root.classList.add('arw-pfs-on');
      // the phone's back button leaves it, like any full-screen view
      if (kind === 'button') { try { history.pushState({ arwPfs: 1 }, ''); } catch(e){} }
      sync();
    }
    function exitPseudo(fromHistory){
      if (!pseudo) return;
      var kind = pseudo;
      pseudo = null;
      box.classList.remove('arw-pfs');
      root.classList.remove('arw-pfs-on');
      sync();
      if (kind === 'button' && !fromHistory) { try { if (history.state && history.state.arwPfs) history.back(); } catch(e){} }
    }
    window.addEventListener('popstate', function(){ if (pseudo === 'button') exitPseudo(true); });
    function canRealFs(){
      return !!(box && (box.requestFullscreen || box.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
    }
    function toggle(){
      if (!box) return;
      var fs = realFs();
      if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      if (pseudo) { exitPseudo(); return; }
      // nothing playing yet: the button starts it, then fills the screen
      if (watchDeck && watchDeck.classList.contains('is-idle') && typeof startPlayback === 'function') startPlayback();
      if (!canRealFs()) { enterPseudo('button'); return; }
      var req;
      try { req = box.requestFullscreen ? box.requestFullscreen({ navigationUI: 'hide' }) : box.webkitRequestFullscreen(); }
      catch(e){ enterPseudo('button'); return; }
      if (req && req.then) req.then(lockLandscape, function(){ enterPseudo('button'); });
      else lockLandscape();
    }
    if (fsBtn) fsBtn.addEventListener('click', toggle);

    // Turning a phone or tablet sideways while a video plays fills the screen; turning it back returns it
    var coarse = window.matchMedia ? matchMedia('(pointer: coarse)') : null;
    var land = window.matchMedia ? matchMedia('(orientation: landscape)') : null;
    function playing(){ return !!(box && box.querySelector('iframe, video') && !(watchDeck && watchDeck.classList.contains('is-idle'))); }
    function onRotate(){
      if (!coarse || !coarse.matches || realFs()) return;
      if (land.matches) { if (playing() && !pseudo) enterPseudo('rotate'); }
      else if (pseudo === 'rotate') exitPseudo();
    }
    if (land) { if (land.addEventListener) land.addEventListener('change', onRotate); else if (land.addListener) land.addListener(onRotate); }

    return { toggle: toggle, exit: function(){ exitPseudo(); }, active: function(){ return !!pseudo; } };
  })();

  // Keyboard Shortcuts (F: full screen, R: reload, Esc: leave the site's own full screen)
  document.addEventListener('keydown', function(e){
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    var key = e.key;
    if (key === 'Escape') {
      if (playerFs.active()) playerFs.exit();
    } else if (key === 'f' || key === 'F' || key === 'ب') {
      e.preventDefault();
      playerFs.toggle();
    } else if (key === 'r' || key === 'R' || key === 'ق') {
      e.preventDefault();
      reloadCurrentServer();
    } else if (/^[1-9١-٩]$/.test(key)) {
      // 1–9 (or ١–٩) picks that server
      var n = /[١-٩]/.test(key) ? key.charCodeAt(0) - 0x660 : +key;
      if (srvRows[n - 1] && !srvRows[n - 1].classList.contains('active')) { e.preventDefault(); srvRows[n - 1].click(); }
    }
  });

