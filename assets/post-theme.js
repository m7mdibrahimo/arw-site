// Moved out of _includes/post-layout.njk so the ~2,900 article pages share one cached copy (INCIDENTS #311).
  (function(){
    var saved = null;
    try{ saved = localStorage.getItem('arw-theme'); }catch(e){}
    if(saved !== 'dark' && saved !== 'light'){
      try{
        var m = document.cookie.match(/(?:^|; )arw-theme=([^;]*)/);
        if(m) saved = decodeURIComponent(m[1]);
      }catch(e){}
    }
    if(saved === 'dark'){ document.documentElement.classList.add('arw-dark'); }
  })();
  var themeBtn = document.getElementById('arwThemeToggle');
  if(themeBtn){
    themeBtn.addEventListener('click', function(){
      var isDark = document.documentElement.classList.toggle('arw-dark');
      var val = isDark ? 'dark' : 'light';
      try{ localStorage.setItem('arw-theme', val); }catch(e){}
      document.cookie = 'arw-theme=' + val + ';path=/;max-age=31536000';
      window.dispatchEvent(new CustomEvent('arw-theme-changed', { detail: { isDark: isDark } }));
    });
  }

  (function(){
    var prefetched = new Set();
    function prefetch(url) {
      if(!url || prefetched.has(url) || url.startsWith('#') || (url.startsWith('http') && !url.includes(location.hostname))) return;
      prefetched.add(url);
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    }
    document.addEventListener('mouseover', function(e){
      var a = e.target.closest && e.target.closest('a');
      if(a && a.href && a.origin === location.origin) prefetch(a.href);
    }, { passive: true });
    document.addEventListener('touchstart', function(e){
      var a = e.target.closest && e.target.closest('a');
      if(a && a.href && a.origin === location.origin) prefetch(a.href);
    }, { passive: true });
  })();

  /* Social Media Auto-Embed Processor (X/Twitter, Instagram, Reddit, Facebook, YouTube, TikTok) */
  (function(){
    function loadScript(src, id, onload) {
      if (document.getElementById(id)) {
        if (onload) onload();
        return;
      }
      var s = document.createElement('script');
      s.id = id;
      s.src = src;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      if (onload) s.onload = onload;
      document.body.appendChild(s);
    }

    var postBody = document.querySelector('.post-body');
    if (!postBody) return;

    var paragraphs = postBody.querySelectorAll('p');
    var hasTwitter = false, hasInsta = false, hasReddit = false, hasFB = false, hasTikTok = false;

    paragraphs.forEach(function(p) {
      var txt = p.textContent.trim();
      var link = p.querySelector('a');
      var url = link ? link.href.trim() : (txt.match(/^https?:\/\/[^\s]+$/) ? txt : '');

      if (!url) return;

      // Ensure the paragraph is solely or primarily containing this URL/link
      if (link && p.childNodes.length === 1) {
        url = link.href.trim();
      } else if (link && p.textContent.trim() === link.textContent.trim()) {
        url = link.href.trim();
      } else if (!link && !txt.match(/^https?:\/\/[^\s]+$/)) {
        return;
      }

      // 1. Twitter / X
      var twitterMatch = url.match(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/i);
      if (twitterMatch) {
        var user = twitterMatch[1];
        var tweetId = twitterMatch[2];
        var isDark = document.documentElement.classList.contains('arw-dark');
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-twitter';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'en';
        embedDiv.innerHTML = '<blockquote class="twitter-tweet" data-lang="en" lang="en" data-dnt="true" data-theme="' + (isDark ? 'dark' : 'light') + '" dir="ltr"><div class="embed-skeleton-card"><div class="embed-platform-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span>X (Twitter)</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور X...</span><span class="embed-skeleton-link"><a href="https://twitter.com/' + user + '/status/' + tweetId + '" target="_blank" rel="noopener">فتح المنشور على X (@' + user + ') &rarr;</a></span></div></blockquote>';
        p.parentNode.replaceChild(embedDiv, p);
        hasTwitter = true;
        return;
      }

      // 2. Instagram (Post, Reel, Reels, TV)
      var instaMatch = url.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/i);
      if (instaMatch) {
        var instaCode = instaMatch[1];
        var cleanInstaUrl = 'https://www.instagram.com/p/' + instaCode + '/?hl=en_US';
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-instagram';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'en-US';
        embedDiv.innerHTML = '<blockquote class="instagram-media instagram-embed" lang="en-US" dir="ltr" data-instgrm-locale="en_US" data-instgrm-captioned data-instgrm-permalink="' + cleanInstaUrl + '" data-instgrm-version="14"><div class="embed-skeleton-card instagram-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg><span>Instagram</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور إنستجرام...</span><span class="embed-skeleton-link"><a href="' + cleanInstaUrl + '" target="_blank" rel="noopener">فتح المنشور على Instagram &rarr;</a></span></div></blockquote>';
        p.parentNode.replaceChild(embedDiv, p);
        hasInsta = true;
        return;
      }

      // 3. Reddit
      var redditMatch = url.match(/^https?:\/\/(?:www\.)?(?:reddit\.com\/r\/[^\s\"\'<>]+|redd\.it\/[a-zA-Z0-9]+)/i);
      if (redditMatch) {
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-reddit';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'en';
        embedDiv.innerHTML = '<blockquote class="reddit-embed-bq" lang="en" dir="ltr" data-embed-height="500"><div class="embed-skeleton-card"><div class="embed-platform-badge"><span>Reddit</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور Reddit...</span><span class="embed-skeleton-link"><a href="' + url + '" target="_blank" rel="noopener">فتح المنشور على Reddit &rarr;</a></span></div></blockquote>';
        p.parentNode.replaceChild(embedDiv, p);
        hasReddit = true;
        return;
      }

      // 4. YouTube Video, Live Streams or Shorts
      var ytMatch = url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s"']*(?:&|&amp;))*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch) {
        var ytId = ytMatch[1];
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-yt-wrap yt-facade';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'en';
        embedDiv.setAttribute('data-yt', ytId);
        embedDiv.innerHTML = '<button type="button" class="yt-facade-btn" aria-label="تشغيل فيديو يوتيوب"><img src="https://i.ytimg.com/vi/' + ytId + '/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="yt-play" aria-hidden="true"></span></button><a class="yt-facade-link" href="https://www.youtube.com/watch?v=' + ytId + '" target="_blank" rel="noopener">فتح على YouTube</a>';
        p.parentNode.replaceChild(embedDiv, p);
        return;
      }

      // 5. TikTok
      var tiktokMatch = url.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video\/([0-9]+)/i);
      if (tiktokMatch) {
        var ttUser = tiktokMatch[1];
        var ttId = tiktokMatch[2];
        var ttUrl = 'https://www.tiktok.com/@' + ttUser + '/video/' + ttId + '?lang=en';
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-tiktok';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'en';
        embedDiv.innerHTML = '<blockquote class="tiktok-embed" lang="en" dir="ltr" cite="' + ttUrl + '" data-video-id="' + ttId + '"><section><div class="embed-skeleton-card"><div class="embed-platform-badge"><span>TikTok</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل فيديو TikTok...</span><span class="embed-skeleton-link"><a target="_blank" href="' + ttUrl + '">فتح الفيديو على TikTok &rarr;</a></span></div></section></blockquote>';
        p.parentNode.replaceChild(embedDiv, p);
        hasTikTok = true;
        return;
      }

      // 6. Facebook (Posts, Shares, Videos, Reels, Permalinks)
      var fbMatch = url.match(/^https?:\/\/(?:www\.|m\.)?(?:facebook\.com\/(?:share\/(?:p|v|r)?\/[a-zA-Z0-9_-]+|[^\/\s"']+\/(?:posts|videos|photos)\/[0-9]+|permalink\.php\?[^\s"']+|photo(?:\.php|\/)\?[^\s"']+|watch\/?\?[^\s"']+|reel\/[0-9]+|story\.php\?[^\s"']+|[^\s"'<>]+)|fb\.watch\/[a-zA-Z0-9_-]+)/i);
      if (fbMatch) {
        var embedDiv = document.createElement('div');
        embedDiv.className = 'social-embed-box embed-facebook';
        embedDiv.dir = 'ltr';
        embedDiv.lang = 'ar';
        embedDiv.style.minHeight = '420px';
        embedDiv.style.maxWidth = '580px';
        embedDiv.style.margin = '36px auto';
        embedDiv.style.display = 'flex';
        embedDiv.style.justifyContent = 'center';
        embedDiv.style.textAlign = 'center';
        embedDiv.innerHTML = '<div class="fb-post" data-href="' + url + '" data-width="auto" data-show-text="true" style="margin:0 auto; width:100%; display:flex; justify-content:center;"><blockquote cite="' + url + '" class="fb-xfbml-parse-ignore"><div class="embed-skeleton-card facebook-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg><span>Facebook</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور فيسبوك...</span><span class="embed-skeleton-link"><a href="' + url + '" target="_blank" rel="noopener">فتح المنشور على Facebook &rarr;</a></span></div></blockquote></div>';
        p.parentNode.replaceChild(embedDiv, p);
        hasFB = true;
        return;
      }
    });

    if (hasTwitter || document.querySelector('.twitter-tweet')) {
      if (window.twttr && window.twttr.widgets) {
        window.twttr.widgets.load();
      } else {
        loadScript('https://platform.twitter.com/widgets.js', 'twitter-wjs', function(){
          if (window.twttr && window.twttr.widgets) {
            window.twttr.widgets.load();
          }
        });
      }
    }

    if (hasInsta || document.querySelector('.instagram-media')) {
      if (window.instgrm && window.instgrm.Embeds) {
        window.instgrm.Embeds.process();
      } else {
        loadScript('https://www.instagram.com/embed.js', 'instagram-wjs', function(){
          if (window.instgrm && window.instgrm.Embeds) {
            window.instgrm.Embeds.process();
          }
        });
      }
    }

    if (hasReddit || document.querySelector('.reddit-embed-bq')) {
      loadScript('https://embed.reddit.com/widgets.js', 'reddit-wjs');
    }

    if (hasTikTok || document.querySelector('.tiktok-embed')) {
      loadScript('https://www.tiktok.com/embed.js', 'tiktok-wjs');
    }

    if (hasFB || document.querySelector('.fb-post, .fb-video')) {
      if (!document.getElementById('fb-root')) {
        var fbRoot = document.createElement('div');
        fbRoot.id = 'fb-root';
        document.body.insertBefore(fbRoot, document.body.firstChild);
      }
      var parseFB = function() {
        if (window.FB && window.FB.XFBML) {
          window.FB.XFBML.parse();
        }
      };
      if (window.FB && window.FB.XFBML) {
        parseFB();
      } else {
        loadScript('https://connect.facebook.net/ar_AR/sdk.js#xfbml=1&version=v19.0', 'facebook-jssdk', parseFB);
      }
    }
  })();

