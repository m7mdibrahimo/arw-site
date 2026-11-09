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
    // Google Drive's sharing link -> its player (lib/embed.cjs)
    url = url.replace(/^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]{10,})(?:[\/?#&].*)?$/i, 'https://drive.google.com/file/d/$1/preview');
    url = url.replace(/^https?:\/\/(?:m\.)?ok\.ru\/video\/(\d+)/i, 'https://ok.ru/videoembed/$1');
    url = url.replace(/^https?:\/\/(vidtube\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(uqload\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(streamtape\.[a-z]+)\/v\/([a-zA-Z0-9_-]+)(?:\/[^\s?]*)?/i, 'https://$1/e/$2');
    url = url.replace(/^https?:\/\/(dood(?:stream)?\.[a-z]+)\/d\/([a-zA-Z0-9_-]+)/i, 'https://$1/e/$2');
    url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(vidmoly\.[a-z]+)\/(?!embed-)(?:w\/)?([a-zA-Z0-9_-]+)(?:\.html)?(?:[\/?].*)?$/i, 'https://$1/embed-$2.html');
    url = url.replace(/^https?:\/\/(?:streamwish\.[a-z]+|swish\.[a-z]+|wishfast\.[a-z]+|awish\.[a-z]+|mwish\.[a-z]+|sfastwish\.[a-z]+)\/(?:[fe]\/)?([a-zA-Z0-9_-]+)/i, 'https://streamwish.to/e/$1');
    url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:hgcloud|streamhg|shgcloud|hgplayer|hgstream|hanerix)\.[a-zA-Z0-9-]+\/(?:[dfe]\/)?([a-zA-Z0-9_-]+)(?:[\/?].*)?$/i, 'https://hgcloud.to/e/$1');
    url = url.replace(/^https?:\/\/(?:filelions\.[a-z]+|lion\.[a-z]+)\/(?:[vf]\/)?([a-zA-Z0-9_-]+)/i, 'https://filelions.to/v/$1');
    url = url.replace(/^https?:\/\/([a-z0-9.-]*fe(?:mbed|url)[a-z0-9.-]*)\/[vf]\/([a-zA-Z0-9_-]+)/i, 'https://$1/embed/$2');
    // Send.now, VikingFile, PixelDrain, GoFile share links (owner 2026-11-09; what each host allows: lib/embed.cjs)
    url = url.replace(/^https?:\/\/(?:www\.)?send\.(?:now|cm)\/(?:embed-)?([a-z0-9]{12})(?:[\/.?#].*)?$/i, function(m, id) { return 'https://send.now/embed-' + id.toLowerCase() + '.html'; });
    url = url.replace(/^https?:\/\/(?:www\.)?vik[i1]ngf[i1]le\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\/(?:f|e|d|embed)\/([a-zA-Z0-9_-]+)(?:[\/?#].*)?$/i, 'https://vikingfile.com/f/$1');
    url = url.replace(/^https?:\/\/(?:www\.)?pixeldrain\.(?:com|net)\/(?:u|api\/file)\/([a-zA-Z0-9_-]+)\/?(?:[?#].*)?$/i, 'https://pixeldrain.com/api/file/$1');
    url = url.replace(/^https?:\/\/(?:www\.)?gofile\.io\/d\/([a-zA-Z0-9_-]+)\/?(?:[?#].*)?$/i, 'https://gofile.io/d/$1');
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
  // lib/embed.cjs playerKind / hostPage: «video» plays the file in the page's <video>, «page» can only open on the host
  function playerKind(u) {
    u = String(u || '');
    if (/^https:\/\/gofile\.io\/d\//i.test(u)) return 'page';
    if (/^https:\/\/pixeldrain\.com\/api\/file\/[a-zA-Z0-9_-]+\/?(?:[?#]|$)/i.test(u) || /^https?:\/\/[a-z0-9-]+\.gofile\.io\/download\//i.test(u) || /\.(?:mp4|webm)(?:\?|$)/i.test(u)) return 'video';
    return 'iframe';
  }
  function hostPage(u) {
    u = String(u || '');
    var m = u.match(/^https:\/\/pixeldrain\.com\/api\/file\/([a-zA-Z0-9_-]+)/i);
    if (m) return { name: 'PixelDrain', href: 'https://pixeldrain.com/u/' + m[1] };
    m = u.match(/^https:\/\/gofile\.io\/d\/([a-zA-Z0-9_-]+)/i);
    if (m) return { name: 'GoFile', href: 'https://gofile.io/d/' + m[1] };
    return null;
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

  // A server whose host won't play its video inside another site (GoFile's pages, PixelDrain without Pro): a panel over
  // the player with the host's own page, opened in a new tab, and the next server. null takes it away.
  var EXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
  function showHostPage(box, page) {
    var old = document.getElementById('wdExt');
    if (old) old.remove();
    if (watchDeck) watchDeck.classList.toggle('is-ext', !!page);
    if (!page || !box) return;
    var pane = document.createElement('div');
    pane.className = 'wd-pm wd-ext';
    pane.id = 'wdExt';
    var tag = document.createElement('span'); tag.className = 'wd-lock-tag'; tag.innerHTML = EXT_ICON; tag.appendChild(document.createTextNode(page.name));
    var t = document.createElement('b'); t.className = 'wd-lock-t'; t.textContent = 'يُشاهَد هذا السيرفر على موقع ' + page.name;
    var sub = document.createElement('span'); sub.className = 'wd-lock-s'; sub.textContent = 'لا يتيح ' + page.name + ' تشغيل هذا الفيديو داخل المواقع الأخرى، فشاهده على صفحته في نافذة جديدة.';
    var acts = document.createElement('span'); acts.className = 'wd-lock-acts';
    var a = document.createElement('a'); a.className = 'wd-lock-btn'; a.href = page.href; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
    a.innerHTML = EXT_ICON; var at = document.createElement('span'); at.textContent = 'شاهد على ' + page.name; a.appendChild(at);
    acts.appendChild(a);
    pane.appendChild(tag); pane.appendChild(t); pane.appendChild(sub); pane.appendChild(acts);
    if (srvRows.length > 1) {
      var next = document.createElement('button'); next.type = 'button'; next.className = 'wd-pm-back'; next.textContent = 'أو جرّب سيرفرًا آخر';
      next.addEventListener('click', function(){ switchToNextServer(); });
      pane.appendChild(next);
    }
    box.appendChild(pane);
  }

  // Every mount gets a number: a late load event from the previous server must not hide the new loader.
  var mountSeq = 0;
  function mountVideo(box, rawSrc, serverLabel) {
    if (!box || !rawSrc) return;
    if (watchDeck) watchDeck.classList.remove('is-idle');
    // «تابع المشاهدة»: the member's account is told this show has started (assets/features.js)
    if (!mountSeq) { try { window.dispatchEvent(new CustomEvent('arw-watch-start')); } catch (e) {} }
    var seq = ++mountSeq;
    var mountedAt = Date.now();
    currentActiveServerSrc = rawSrc;
    var src = toEmbedUrl(rawSrc);
    var kind = playerKind(src);
    var isDirect = kind === 'video';
    var page = hostPage(src);
    showHostPage(box, null);
    if (kind === 'page') {
      var oldFrame = box.querySelector('#videoFrame'), oldVideo = box.querySelector('#videoPlayer');
      if (oldFrame) oldFrame.remove();
      if (oldVideo) { try { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); } catch(e){} oldVideo.remove(); }
      setLoader(false);
      showHostPage(box, page);
      return;
    }

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
        // PixelDrain plays a file on other sites only for its Pro accounts: the rest open on its own page
        if (page) { setLoader(false); v.remove(); showHostPage(box, page); return; }
        if (loaderStatus) loaderStatus.textContent = 'هذا السيرفر لا يعمل حاليا، جرب سيرفرا آخر';
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
      // No load at all = the server is down: the loader stays with «جرب سيرفر تاني» (INCIDENTS #277).
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
  // the rows are read again whenever servers are added (a premium member's own servers, an early show's links)
  // a locked «سيرفر مميز» row (_includes/post-layout.njk) is never one of them: it opens the subscribe panel instead
  var srvRows = Array.from(document.querySelectorAll('.srv-row:not(.is-locked)'));
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

  // «سيرفر مميز» for someone who isn't a premium member: the subscribe panel over the player (owner 2026-11-09, the second
  // of three pictures); any free server, or «أو شاهد على سيرفر 1 مجانًا», takes it away
  function pmLock(on, btn) {
    var pane = document.getElementById('wdPmLock'), deck = document.getElementById('watchDeck');
    if (on && !pane) { location.href = (document.documentElement.lang === 'en' ? '/en' : '') + '/premium/#subscribe'; return; }
    if (!pane) return;
    if (on) showHostPage(null, null);
    pane.hidden = !on;
    if (deck) deck.classList.toggle('is-pmlock', !!on);
    document.querySelectorAll('.srv-row.is-locked').forEach(function(b){ b.classList.toggle('active', !!on && b === btn); b.setAttribute('aria-selected', on && b === btn ? 'true' : 'false'); });
    if (on) srvRows.forEach(function(b){ b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  }
  var pmBack = document.getElementById('wdPmBack');
  if (pmBack) pmBack.addEventListener('click', function(){ pmLock(false); if (srvRows[0]) srvRows[0].click(); });

  // Server tabs switcher
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.srv-row');
    if (!btn) return;
    if (btn.classList.contains('is-locked')) { pmLock(true, btn); return; }
    pmLock(false);
    (function(){
      markServer(btn);
      var rawEnc = (btn.dataset.srv || '').trim();
      var box = document.getElementById('videoEmbedBox') || document.querySelector('.video-embed');
      if (!box || !rawEnc) return;

      var rawSrc = deobfuscateUrl(rawEnc);
      var srvLabel = btn.getAttribute('data-srv-name') || 'السيرفر';
      if (rawSrc) {
        mountVideo(box, rawSrc, srvLabel);
      }
    })();
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
  function labelNextBtn() { if (loaderNextBtn) loaderNextBtn.textContent = srvRows.length <= 1 ? 'إعادة تحديث المشغل ↻' : 'تجربة سيرفر آخر ⏭'; }
  if (loaderNextBtn) {
    labelNextBtn();
    loaderNextBtn.addEventListener('click', function(){ if (srvRows.length <= 1) reloadCurrentServer(); else switchToNextServer(); });
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


  // ==== «العضوية المميزة» on a show page (owner 2026-10-14) ====
  // A premium member's own servers (no ads) and downloads come from the worker, never from the page; everyone else sees a
  // line saying they exist. A show dated later is built without its links (_includes/post-layout.njk): a premium member
  // gets them now, everyone else when its time comes, before the site's next build. The worker: worker/src/premium.ts.
  (function(){
    var deck = document.getElementById('watchDeck');
    var pk = deck && deck.getAttribute('data-pk');
    if (!pk) return;
    var API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/premium/';
    var HOME = document.documentElement.lang === 'en' ? '/en' : '';
    var CROWN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
    var DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    var session = null;
    try { session = JSON.parse(localStorage.getItem('arw-member') || 'null'); } catch (e) {}
    var token = session && session.token || '';
    var known = session && session.member || null;
    var thinksPremium = !!(known && (known.official || known.premium > Date.now()));
    // signed in already: no «سجّل دخولك» under the subscribe buttons
    if (token) document.querySelectorAll('.wd-pm-in').forEach(function(x){ x.remove(); });
    function get(what) {
      // the page asked already, while it was still loading (_includes/post-layout.njk, next to the premium line)
      if (what === 'media' && window.__arwPrem) { var early = window.__arwPrem; window.__arwPrem = null; return early; }
      return fetch(API + what + '?k=' + encodeURIComponent(pk), { headers: token ? { Authorization: 'Bearer ' + token } : {}, credentials: 'omit' })
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ d.status = r.status; return d; }); });
    }
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function enc(u) { try { return btoa(u).split('').reverse().join(''); } catch (e) { return ''; } }
    function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
    // a server with its own quality menu (eleventy.config.js MULTI_QUALITY_RE)
    // StreamHG no longer has qualities (owner 2026-10-16); the premium server (Google Drive) always has
    function multi(u) { return /(^|\.)ok\.ru$/i.test(host(toEmbedUrl(u))); }
    // a download site's own name and logo, as the page's download cards show them (eleventy.config.js KNOWN_HOST_NAMES/LOGOS):
    // «Google Drive» with its logo, not «drive.google.com» with Google's (owner 2026-10-16)
    var SITES = { 'drive.google.com': ['Google Drive', '/assets/hosts/google-drive.svg'], 'docs.google.com': ['Google Drive', '/assets/hosts/google-drive.svg'],
      'mega.nz': ['MEGA'], 'mediafire.com': ['MediaFire'], 'gofile.io': ['GoFile'], 'pixeldrain.com': ['PixelDrain'], '1fichier.com': ['1Fichier'],
      'krakenfiles.com': ['KrakenFiles'], 'multiup.io': ['MultiUp'], 'uqload.vc': ['Uqload', '/assets/hosts/uqload.png'], 'uqload.to': ['Uqload', '/assets/hosts/uqload.png'] };
    function siteOf(h) {
      var k = SITES[h] || SITES[h.split('.').slice(-2).join('.')];
      return { name: k ? k[0] : h, logo: k && k[1] ? k[1] : 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(h) + '&sz=64' };
    }
    function clean(list) { return (list || []).filter(function(u){ return /^https?:\/\/\S+$/.test(String(u || '')); }); }

    // ── servers: added as rows of the list (a premium member's first, marked with the crown) ──
    function row(code, name, num, sub, prem) {
      var b = el('button', 'srv-row' + (prem ? ' is-prem' : ''));
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false');
      b.dataset.srv = code; b.setAttribute('data-srv-name', name);
      b.innerHTML = '<span class="srv-num">' + (prem ? CROWN : num) + '</span><span class="srv-name"><b></b>' + (sub ? '<span class="srv-mq"></span>' : '') + '</span>'
        + '<span class="srv-state"><span class="s-ready">جاهز</span><span class="s-load">جار التشغيل</span><span class="s-on">يعمل الآن</span></span>';
      b.querySelector('b').textContent = name;
      if (sub) b.querySelector('.srv-mq').textContent = sub;
      return b;
    }
    function addServers(list, prem) {
      list = clean(list);
      if (!list.length) return 0;
      var body = deck.querySelector('.wd-body'), box = document.getElementById('videoEmbedBox');
      var tabs = document.getElementById('serverTabs');
      if (!tabs) {
        var side = el('div', 'wd-side');
        tabs = el('div', 'wd-list'); tabs.id = 'serverTabs';
        tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'سيرفرات المشاهدة');
        side.appendChild(tabs); body.insertBefore(side, body.firstChild);
        // the page's one server becomes the first row of the list
        if (box && box.dataset.initSrv) tabs.appendChild(row(box.dataset.initSrv, 'سيرفر 1', '1', '', false));
      }
      var have = tabs.querySelectorAll('.srv-row:not(.is-prem)').length, frag = document.createDocumentFragment();
      list.forEach(function(u, i){
        var code = enc(u);
        if (!code) return;
        if (prem) {
          // the premium server: Google Drive's player, every quality in its settings («بدون إعلانات» left out — owner 2026-10-18)
          var p = row(code, list.length > 1 ? 'سيرفر مميز ' + (i + 1) : 'سيرفر مميز', '', 'متعدد الجودات', true);
          p.classList.add('is-mq'); p.dataset.mq = '1';
          frag.appendChild(p);
        }
        else {
          var r = row(code, 'سيرفر ' + (have + i + 1), String(have + i + 1), multi(u) ? 'متعدد الجودات' : '', false);
          if (multi(u)) { r.classList.add('is-mq'); r.dataset.mq = '1'; }
          frag.appendChild(r);
        }
      });
      if (prem) tabs.insertBefore(frag, tabs.firstChild); else tabs.appendChild(frag);
      srvRows = Array.from(document.querySelectorAll('.srv-row:not(.is-locked)'));
      deck.classList.toggle('is-single', srvRows.length < 2);
      if (box && !box.dataset.initSrv && srvRows[0]) box.dataset.initSrv = srvRows[0].dataset.srv;
      labelNextBtn();
      // not playing yet: the poster's play button starts the first row (a premium server when there is one)
      if (!currentActiveServerSrc && srvRows[0]) markServer(srvRows[0]);
      return list.length;
    }

    // ── downloads: one more card in «روابط التحميل», opening its own list ──
    // opt: one quality of an early show's links ({tier, label, sub}), as the page's own quality buttons show it
    function addDownloads(list, prem, opt) {
      list = clean(list);
      if (!list.length) return;
      var wrap = document.getElementById('downloads');
      if (!wrap) {
        wrap = el('div', 'download-links', '<h3>روابط التحميل</h3><div class="quality-grid"></div>');
        wrap.id = 'downloads';
        deck.parentNode.insertBefore(wrap, deck.nextSibling);
      }
      var grid = wrap.querySelector('.quality-grid'), id = prem ? 'dlModalPrem' : 'dlModalEarly' + (opt ? '-' + opt.tier : '');
      var btn = el('button', 'quality-btn' + (prem ? ' is-prem' : ''), '<span class="quality-icon">' + (prem ? CROWN : DL) + '</span><span class="quality-label"></span><span class="quality-sub"></span>');
      btn.type = 'button'; btn.setAttribute('data-tier', prem ? 'prem' : opt ? opt.tier : 'high');
      btn.querySelector('.quality-label').textContent = prem ? 'تحميل مميز' : opt ? opt.label : 'تحميل العرض';
      btn.querySelector('.quality-sub').textContent = prem ? 'مباشر وسريع' : opt ? opt.sub : 'كل الجودات';
      if (prem) grid.insertBefore(btn, grid.firstChild); else grid.appendChild(btn);
      var modal = el('div', 'dl-modal-backdrop');
      modal.id = id;
      modal.innerHTML = '<div class="dl-modal" role="dialog" aria-modal="true"><div class="dl-modal-head"><h4></h4><button type="button" class="dl-modal-close" aria-label="إغلاق"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="dl-modal-body"></div></div>';
      var title = prem ? 'روابط التحميل المميزة' : opt ? 'روابط التحميل · ' + opt.label + ' ' + opt.sub : 'روابط التحميل';
      modal.querySelector('h4').textContent = title;
      modal.querySelector('.dl-modal').setAttribute('aria-label', title);
      var listEl = modal.querySelector('.dl-modal-body');
      list.forEach(function(u){
        var h = host(u), st = siteOf(h), a = el('a', 'dl-site-card' + (prem ? ' is-prem' : ''));
        a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.dataset.ready = '1';
        a.innerHTML = '<img class="dl-site-logo" alt="" loading="lazy"><span class="dl-site-info"><span class="dl-site-name"></span><span class="dl-site-quality"></span></span><svg class="dl-site-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
        a.querySelector('img').src = st.logo;
        a.querySelector('img').alt = st.name;
        a.querySelector('.dl-site-name').textContent = st.name || 'رابط التحميل';
        a.querySelector('.dl-site-quality').textContent = prem ? 'تحميل مباشر وسريع' : opt ? opt.sub : 'اضغط هنا للتحميل';
        listEl.appendChild(a);
      });
      document.body.appendChild(modal);
      function close() { modal.classList.remove('open'); document.body.classList.remove('dl-modal-lock'); }
      btn.addEventListener('click', function(){ modal.classList.add('open'); document.body.classList.add('dl-modal-lock'); });
      modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
      modal.querySelector('.dl-modal-close').addEventListener('click', close);
    }

    // ── for everyone else: what this show has for premium members ──
    var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    // premium links the page wasn't built with (added in the panel since the last build): their locked row and card now
    function lockedRows(servers, downloads) {
      if (servers && !document.querySelector('.srv-row.is-locked') && !document.querySelector('.srv-row.is-prem')) {
        addServers(['https://arab-wrestling.com/premium/'], true);
        var r = document.querySelector('.srv-row.is-prem');
        if (r) {
          r.classList.add('is-locked'); delete r.dataset.srv; r.dataset.mq = '';
          r.querySelector('.srv-state').outerHTML = '<span class="srv-state srv-locked">' + LOCK + '<span>للمشتركين</span></span>';
          srvRows = Array.from(document.querySelectorAll('.srv-row:not(.is-locked)'));
          if (srvRows[0] && !currentActiveServerSrc) markServer(srvRows[0]);
        }
      }
      if (downloads && !document.querySelector('#downloads .quality-btn.is-prem')) {
        var grid = document.querySelector('#downloads .quality-grid');
        if (!grid) return;
        var a = el('a', 'quality-btn is-prem is-locked', '<span class="q-lock">' + LOCK + '</span><span class="quality-icon">' + CROWN + '</span><span class="quality-label">تحميل مميز</span><span class="quality-sub">مباشر وسريع</span>');
        a.href = HOME + '/premium/#subscribe'; a.setAttribute('data-tier', 'prem');
        grid.insertBefore(a, grid.firstChild);
      }
    }
    function promo(servers, downloads) {
      var built = document.getElementById('wdPrem');
      if (!servers && !downloads) { if (built) built.remove(); return; }
      lockedRows(servers, downloads);
      var what = servers && downloads ? 'إضافة للأعضاء المميزين: سيرفر خاص متعدد الجودات وتحميل مباشر سريع' : servers ? 'إضافة للأعضاء المميزين: سيرفر خاص متعدد الجودات بدون إعلانات' : 'إضافة للأعضاء المميزين: تحميل مباشر وسريع بدون إعلانات';
      // the page came with it (built from the worker's counts): only its words may have changed since
      if (built) { built.querySelector('b').textContent = what; built.hidden = false; return; }
      var a = el('a', 'wd-prem', '<span class="wd-prem-ic">' + CROWN + '</span><span class="wd-prem-tx"><b></b><small></small></span><span class="wd-prem-go"></span>');
      a.querySelector('small').textContent = 'العرض متاح للجميع مجانًا على باقي السيرفرات، وهذه الإضافة للمشتركين في العضوية المميزة فقط.';
      a.querySelector('.wd-prem-go').textContent = 'اشترك';
      a.href = HOME + '/premium/';
      a.querySelector('b').textContent = what;
      var note = deck.querySelector('.wd-note');
      deck.insertBefore(a, note || null);
    }

    // ── a show dated later: the lock, its countdown, and the links when they're open ──
    var lock = document.getElementById('wdLock');
    var pub = Number(deck.getAttribute('data-pub')) || 0;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    // the clock: hours, minutes, seconds (and days, past one day) — the worker's timeLeft says the same (worker/src/early.ts)
    var clock = document.getElementById('wdClock');
    function paint(ms) {
      if (!clock) return;
      var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
      var v = { d: d, h: d ? Math.floor(s % 86400 / 3600) : Math.floor(s / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
      ['d', 'h', 'm', 's'].forEach(function(k){ var u = clock.querySelector('[data-u="' + k + '"]'); if (u) u.querySelector('b').textContent = pad(v[k]); });
      var du = clock.querySelector('[data-u="d"]');
      if (du && du.hidden !== !d) { du.hidden = !d; if (du.nextElementSibling) du.nextElementSibling.hidden = !d; }
    }
    var LOCK_S = lock ? lock.querySelector('.wd-lock-s').textContent : '';
    // the qualities in the page's own order and words (_includes/post-layout.njk)
    var TIERS = [['light', 'جودة خفيفة', '360p'], ['low', 'جودة منخفضة', '480p'], ['medium', 'جودة متوسطة', '720p'], ['high', 'جودة عالية', '1080p']];
    function unlock(d) {
      var n = addServers(d.servers, false);
      if (d.dl) {
        var rest = clean((d.dl.multi || []).concat(d.dl.other || []));
        TIERS.forEach(function(t){ addDownloads(d.dl[t[0]], false, { tier: t[0], label: t[1], sub: t[2] }); });
        addDownloads(rest, false);
      } else addDownloads(d.downloads, false);
      if (!n && !clean(d.downloads).length) return false;
      if (lock) lock.remove();
      deck.classList.remove('is-locked');
      if (d.premium && pub > Date.now()) {
        var h = deck.querySelector('.wd-head h3');
        if (h && !h.querySelector('.wd-early')) { var tag = el('span', 'wd-early', CROWN + '<span>قبل الجميع</span>'); tag.title = 'تشاهده قبل الجميع لأنك عضو مميز'; h.appendChild(tag); }
      }
      return true;
    }
    // a message in place of the clock (clock: true puts the clock back)
    function lockSay(title, sub, withClock) {
      if (!lock) return;
      if (title) lock.querySelector('.wd-lock-t').textContent = title;
      if (sub != null) lock.querySelector('.wd-lock-s').textContent = sub;
      if (clock) clock.hidden = !withClock;
    }
    function countdown() {
      var tries = 0;
      (function tick() {
        if (!lock || !lock.isConnected) return;
        var ms = pub - Date.now();
        // on the second: the next tick lands just after the clock's second changes
        if (ms > 0) { paint(ms); setTimeout(tick, (ms % 1000) + 20); return; }
        paint(0);
        lockSay('العرض متاح للجميع الآن', 'لحظات ويظهر المشغل…');
        get('early').then(function(d){
          if (d.ok && unlock(d)) return;
          if (++tries < 10) setTimeout(tick, 30000); else lockSay(null, 'أعد تحميل الصفحة بعد دقيقة.');
        }).catch(function(){ if (++tries < 10) setTimeout(tick, 30000); });
      })();
    }

    // a premium member's links of the shows they opened, kept in their browser: the rows show at once on a second visit
    var CACHE = 'arw-prem-links';
    function cached() { try { return (JSON.parse(localStorage.getItem(CACHE) || '{}') || {})[pk] || null; } catch (e) { return null; } }
    function keep(links) {
      try {
        var all = JSON.parse(localStorage.getItem(CACHE) || '{}') || {};
        delete all[pk];
        if (links) all[pk] = links;
        var keys = Object.keys(all);
        while (keys.length > 40) delete all[keys.shift()];
        localStorage.setItem(CACHE, JSON.stringify(all));
      } catch (e) {}
    }
    function dropPrem() {
      document.querySelectorAll('.srv-row.is-prem:not(.is-locked), #downloads .quality-btn.is-prem:not(.is-locked), #dlModalPrem').forEach(function(x){ x.remove(); });
      srvRows = Array.from(document.querySelectorAll('.srv-row:not(.is-locked)'));
    }
    function showPrem(links) {
      var b = document.getElementById('wdPrem');
      if (b) b.remove();
      // the locked rows the page was built with give way to the member's own
      pmLock(false);
      document.querySelectorAll('.srv-row.is-locked, #downloads .quality-btn.is-locked, #wdPmLock, #dlModalLocked').forEach(function(x){ x.remove(); });
      addServers(links.servers, true); addDownloads(links.downloads, true);
    }
    function extras() {
      var shown = thinksPremium ? cached() : null;
      if (shown) showPrem(shown);
      return get('media').then(function(d){
        if (!d.ok) return;
        if (d.links) {
          var same = shown && JSON.stringify(shown) === JSON.stringify(d.links);
          keep(d.links);
          if (same) return;
          // a link changed since: the new ones, unless the member already plays one of the old ones
          if (shown) { if (document.querySelector('.srv-row.is-prem.active')) return; dropPrem(); }
          showPrem(d.links);
        } else {
          if (shown) { dropPrem(); keep(null); }
          promo(d.servers, d.downloads);
        }
      }).catch(function(){ var b = document.getElementById('wdPrem'); if (b && !shown) b.hidden = false; });
    }

    if (!lock) { extras(); return; }
    paint(pub - Date.now());
    if (token) { var signIn = lock.querySelector('.wd-lock-in'); if (signIn) signIn.remove(); }
    if (token && thinksPremium) lockSay('جار تجهيز العرض لك…', '');
    if (token || pub <= Date.now()) {
      get('early').then(function(d){
        if (d.ok && unlock(d)) { extras(); return; }
        if (d.status === 403) {
          lockSay('هذا العرض متاح الآن لأعضاء العضوية المميزة', LOCK_S, true);
          countdown();
        } else lockSay('تعذر تجهيز العرض الآن', 'أعد تحميل الصفحة بعد قليل.');
        extras();
      }).catch(function(){ lockSay('تعذر الاتصال', 'أعد تحميل الصفحة بعد قليل.'); });
    } else { countdown(); extras(); }
  })();
