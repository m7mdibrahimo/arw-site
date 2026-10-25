/**
 * Arab Wrestling - Client Enhancements
 * 1. Instant Live Search Dropdown
 * 2. Watch Later / Bookmarks (المفضلة وقائمة المشاهدة لاحقا)
 * 3. Interactive Spoiler Blocker (كشف/إخفاء الفائزين)
 */
(function() {
  'use strict';
  // the English edition's own pages for links this script builds (the mirror only rewrites the page's HTML)
  var LP = document.documentElement.lang === 'en' ? '/en' : '';
  // the worker's messages in English on the English pages (lib/i18n/server-en.cjs → /assets/server-en.js); a message
  // with a number in it is matched by its shape; one not known yet gives '' (the page shows its own English words)
  if (LP) {
    var sx = document.createElement('script'); sx.src = '/assets/server-en.js?v=20261015b'; sx.async = true; document.head.appendChild(sx);
  }
  window.arwMsg = function (t) {
    t = String(t || '').trim();
    var map = window.ARW_EN_MSG || {};
    if (map[t]) return map[t];
    var m = t.match(/^الملف كبير، الحد الأقصى (\d+) ميجابايت\.$/); if (m) return 'The file is too large, the limit is ' + m[1] + ' MB.';
    m = t.match(/^يمكنك متابعة (\d+) برنامجا واتحادا على الأكثر\.$/); if (m) return 'You can follow at most ' + m[1] + ' programs and promotions.';
    return '';
  };

  /* ==========================================================================
     Arabic String Normalizer
     ========================================================================== */
  function normalizeArabic(str) {
    if (!str) return '';
    var eastern = '٠١٢٣٤٥٦٧٨٩', extended = '۰۱۲۳۴۵۶۷۸۹';
    var out = String(str);
    out = out.normalize ? out.normalize('NFC') : out;
    out = out.replace(/[٠-٩۰-۹]/g, function(ch) {
      var i = eastern.indexOf(ch); if (i > -1) return String(i);
      i = extended.indexOf(ch); if (i > -1) return String(i);
      return ch;
    });
    out = out.toLowerCase();
    out = out.replace(/[إأآا]/g, 'ا');
    out = out.replace(/[ىي]/g, 'ي');
    out = out.replace(/ة/g, 'ه');
    out = out.replace(/[\u064B-\u0652\u0640]/g, '');
    out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  /* ==========================================================================
     1. Instant Live Search Dropdown
     ========================================================================== */
  var searchIndexCache = null;
  var isFetchingIndex = false;
  var pendingSearchCallback = null;

  function loadSearchIndex(callback) {
    if (searchIndexCache) {
      callback(searchIndexCache);
      return;
    }
    if (isFetchingIndex) {
      pendingSearchCallback = callback;
      return;
    }
    isFetchingIndex = true;
    fetch('/search-index.json')
      .then(function(res) {
        if (!res.ok) throw new Error('Failed to load search index');
        return res.json();
      })
      .then(function(data) {
        searchIndexCache = data;
        isFetchingIndex = false;
        if (callback) callback(data);
        if (pendingSearchCallback) {
          pendingSearchCallback(data);
          pendingSearchCallback = null;
        }
      })
      .catch(function(err) {
        console.warn('ARW Instant Search: could not load index', err);
        isFetchingIndex = false;
      });
  }

  function initInstantSearch() {
    var searchForms = document.querySelectorAll('form.site-search');
    if (!searchForms.length) return;

    if (!document.getElementById('arw-instant-search-css')) {
      var s = document.createElement('style');
      s.id = 'arw-instant-search-css';
      s.textContent = 
        '.site-search{position:relative!important;}' +
        '@media(min-width:1581px){.site-search{flex:0 1 400px!important;width:400px!important;max-width:460px!important;min-width:240px!important;}}' +
        '@media(min-width:1341px) and (max-width:1580px){.site-search{flex:0 1 240px!important;width:240px!important;max-width:260px!important;min-width:160px!important;}}' +
        '@media(min-width:1151px) and (max-width:1340px){.site-search{flex:0 1 185px!important;width:185px!important;max-width:200px!important;min-width:140px!important;}}' +
        '@media(max-width:1150px){.site-search{flex-basis:100%!important;width:100%!important;max-width:none!important;min-width:0!important;}}' +
        '.instant-search-dropdown{position:absolute!important;top:calc(100% + 8px)!important;right:0;left:0;width:100%;min-width:100%;max-width:100%;background:var(--card,#11141a)!important;border:1px solid var(--line,#242b38)!important;border-radius:16px!important;box-shadow:0 16px 40px -10px rgba(0,0,0,0.6)!important;z-index:99999!important;overflow:hidden!important;overflow-x:hidden!important;direction:rtl!important;text-align:right!important;box-sizing:border-box!important;opacity:0;visibility:hidden;transform:translateY(-8px) scale(0.98);transition:all 0.22s cubic-bezier(0.16,1,0.3,1);}' +
        '.instant-search-dropdown.open{opacity:1!important;visibility:visible!important;transform:translateY(0) scale(1)!important;}' +
        '.instant-search-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:10px 14px!important;border-bottom:1px solid var(--line,#242b38)!important;background:var(--bg,#090c10)!important;font-size:11.5px!important;font-weight:700!important;color:var(--muted,#94a3b8)!important;direction:rtl!important;text-align:right!important;box-sizing:border-box!important;}' +
        '.instant-search-list{list-style:none!important;margin:0!important;padding:6px!important;max-height:420px!important;overflow-y:auto!important;overflow-x:hidden!important;display:flex!important;flex-direction:column!important;gap:5px!important;direction:rtl!important;text-align:right!important;width:100%!important;box-sizing:border-box!important;}' +
        '.instant-search-item{width:100%!important;box-sizing:border-box!important;margin:0!important;padding:0!important;list-style:none!important;}' +
        '.instant-search-item a{display:flex!important;flex-direction:row!important;align-items:flex-start!important;gap:10px!important;padding:8px 10px!important;border-radius:12px!important;text-decoration:none!important;color:var(--ink,#ffffff)!important;background:transparent!important;transition:background 0.15s ease!important;direction:rtl!important;text-align:right!important;width:100%!important;box-sizing:border-box!important;min-width:0!important;overflow:hidden!important;}' +
        '.instant-search-item a:hover,.instant-search-item.selected a{background:var(--teal-soft,rgba(14,149,148,0.15))!important;}' +
        '.instant-search-thumb{width:62px!important;height:42px!important;min-width:62px!important;max-width:62px!important;border-radius:8px!important;object-fit:cover!important;flex-shrink:0!important;background:#181c24!important;border:1px solid var(--line,#242b38)!important;box-shadow:0 2px 6px rgba(0,0,0,0.25)!important;display:block!important;order:1!important;margin:0!important;}' +
        '.instant-search-info{flex:1 1 0%!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:4px!important;direction:rtl!important;text-align:right!important;overflow:hidden!important;order:2!important;}' +
        '.instant-search-title{font-family:Cairo,\'Tajawal\',sans-serif!important;font-size:12.5px!important;font-weight:700!important;line-height:1.4!important;color:var(--ink,#f1f5f9)!important;white-space:normal!important;word-break:break-word!important;overflow-wrap:anywhere!important;text-overflow:unset!important;overflow:visible!important;direction:rtl!important;text-align:right!important;margin:0!important;padding:0!important;width:100%!important;}' +
        '.instant-search-meta{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:6px!important;font-size:10.5px!important;color:var(--muted,#94a3b8)!important;direction:rtl!important;text-align:right!important;width:100%!important;}' +
        '.instant-search-badge{font-size:10px!important;font-weight:800!important;padding:2px 7px!important;border-radius:999px!important;white-space:nowrap!important;flex-shrink:0!important;}' +
        '.instant-search-badge.badge-show{background:var(--gold-soft,#fef3c7)!important;color:#b58509!important;}' +
        '.instant-search-badge.badge-recap{background:rgba(124,110,232,0.15)!important;color:var(--violet,#7c6ee8)!important;}' +
        '.instant-search-badge.badge-news{background:var(--coral-soft,#fee2e2)!important;color:var(--coral,#ef4444)!important;}' +
        '.instant-search-footer{padding:10px 14px!important;border-top:1px solid var(--line,#242b38)!important;background:var(--bg,#090c10)!important;text-align:center!important;}' +
        '.instant-search-all-btn{color:var(--teal,#0e9594)!important;font-size:12.5px!important;font-weight:800!important;text-decoration:none!important;display:inline-flex!important;align-items:center!important;gap:4px!important;}' +
        '.instant-search-all-btn:hover{text-decoration:underline!important;}' +
        '.instant-search-empty{padding:24px 16px!important;text-align:center!important;color:var(--muted,#94a3b8)!important;font-size:13px!important;}' +
        '.instant-search-loading{padding:20px 16px!important;text-align:center!important;color:var(--muted,#94a3b8)!important;font-size:12.5px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;}';
      document.head.appendChild(s);
    }

    searchForms.forEach(function(form) {
      var input = form.querySelector('input[name="q"]');
      if (!input) return;

      // Prevent duplicate attachment
      if (form.getAttribute('data-instant-search-ready')) return;
      form.setAttribute('data-instant-search-ready', 'true');
      input.setAttribute('autocomplete', 'off');

      // Create Dropdown Element
      var dropdown = document.createElement('div');
      dropdown.className = 'instant-search-dropdown';
      dropdown.setAttribute('role', 'listbox');
      dropdown.setAttribute('dir', 'rtl');
      dropdown.innerHTML = '<div class="instant-search-loading"><div class="instant-search-spinner"></div><span>جاري تحميل الفهرس...</span></div>';
      form.appendChild(dropdown);

      // Preload index when user focuses input or hovers
      var preloadTrigger = function() {
        loadSearchIndex(function() {});
        input.removeEventListener('focus', preloadTrigger);
        form.removeEventListener('mouseenter', preloadTrigger);
      };
      input.addEventListener('focus', preloadTrigger);
      form.addEventListener('mouseenter', preloadTrigger);

      var debounceTimer = null;
      var selectedIndex = -1;

      function updateDropdownPosition() {
        var brand = null;
        var p = form.parentElement;
        while (p && !brand && p !== document.body) {
          brand = p.querySelector('.brand');
          p = p.parentElement;
        }
        if (brand) {
          var brandRect = brand.getBoundingClientRect();
          var formRect = form.getBoundingClientRect();
          var isSameRow = (brandRect.bottom > formRect.top - 10) && (brandRect.top < formRect.bottom + 10);
          if (brandRect.right > formRect.right + 10 && isSameRow) {
            var span = brand.querySelector('.brand-name span') || brand.querySelector(':scope > span:not(.brand-mark)');
            var spanRect = span ? span.getBoundingClientRect() : null;
            var homeLink = document.querySelector('#navMenu a.navlink') || document.querySelector('.nav a.navlink');
            var homeRect = homeLink ? homeLink.getBoundingClientRect() : null;

            // Right edge: start of 'راسلنج' (leaving 'عرب' visible on the right)
            var targetRight = spanRect ? spanRect.right : (brandRect.right - 50);
            targetRight = Math.min(targetRight, (window.innerWidth || document.documentElement.clientWidth) - 12);

            // Left edge: middle of the menu's first link («مكتبة العروض»; «الرئيسية» left the menu on 2026-10-14)
            var targetLeft = homeRect ? (homeRect.left + homeRect.width / 2) : (formRect.left - 60);
            targetLeft = Math.max(targetLeft, 12);

            var offsetRight = Math.round(targetRight - formRect.right);
            var offsetLeft = Math.round(formRect.left - targetLeft);
            var totalWidth = Math.round(targetRight - targetLeft);

            dropdown.style.setProperty('right', (-offsetRight) + 'px', 'important');
            dropdown.style.setProperty('left', (-offsetLeft) + 'px', 'important');
            dropdown.style.setProperty('width', totalWidth + 'px', 'important');
            dropdown.style.setProperty('min-width', totalWidth + 'px', 'important');
            dropdown.style.setProperty('max-width', totalWidth + 'px', 'important');
            return;
          }
        }
        dropdown.style.removeProperty('right');
        dropdown.style.removeProperty('left');
        dropdown.style.removeProperty('width');
        dropdown.style.removeProperty('min-width');
        dropdown.style.removeProperty('max-width');
      }

      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition, { passive: true });

      function performSearch(query) {
        var trimmed = query.trim();
        if (!trimmed) {
          dropdown.classList.remove('open');
          dropdown.innerHTML = '';
          return;
        }

        updateDropdownPosition();
        dropdown.innerHTML = '<div class="instant-search-loading"><div class="instant-search-spinner"></div><span>جاري البحث...</span></div>';
        dropdown.classList.add('open');

        loadSearchIndex(function(indexData) {
          var qNorm = normalizeArabic(trimmed);
          var terms = qNorm.split(' ').filter(Boolean);
          if (!terms.length) {
            dropdown.classList.remove('open');
            return;
          }

          var matches = [];
          for (var i = 0; i < indexData.length; i++) {
            var item = indexData[i];
            var nTitle = normalizeArabic(item.title);
            var nHeadline = normalizeArabic(item.headline);
            var nTags = normalizeArabic(Array.isArray(item.tags) ? item.tags.join(' ') : String(item.tags || ''));
            var nFed = normalizeArabic(item.federation);
            var allText = nTitle + ' ' + nHeadline + ' ' + nTags + ' ' + nFed;

            var matchAll = terms.every(function(t) { return allText.indexOf(t) !== -1; });
            if (!matchAll) continue;

            var score = 0;
            if (nTitle === qNorm) score += 200;
            else if (nTitle.indexOf(qNorm) === 0) score += 100;
            terms.forEach(function(t) {
              if (nTitle.indexOf(t) !== -1) score += 50;
              if (nHeadline.indexOf(t) !== -1) score += 30;
              if (nTags.indexOf(t) !== -1) score += 20;
              if (nFed.indexOf(t) !== -1) score += 10;
            });

            matches.push({ item: item, score: score });
          }

          matches.sort(function(a, b) { return b.score - a.score; });
          var topMatches = matches.slice(0, 6).map(function(m) { return m.item; });

          if (!topMatches.length) {
            dropdown.innerHTML = '<div class="instant-search-empty">لم يتم العثور على نتائج مطابقة لـ "' + escapeHtml(trimmed) + '"</div>' +
              '<div class="instant-search-footer"><a class="instant-search-all-btn" href="' + LP + '/search/?q=' + encodeURIComponent(trimmed) + '">البحث الشامل في الموقع &larr;</a></div>';
            updateDropdownPosition();
            return;
          }

          var html = '<div class="instant-search-header"><span>أبرز النتائج السريعة</span><span>' + topMatches.length + ' من ' + matches.length + '</span></div>';
          html += '<ul class="instant-search-list">';
          topMatches.forEach(function(it, idx) {
            var badgeClass = it.kind === 'show' ? 'badge-show' : (it.kind === 'recap' ? 'badge-recap' : 'badge-news');
            var kindLabel = it.kindLabel || (it.kind === 'show' ? 'عرض' : (it.kind === 'recap' ? 'ملخص' : 'خبر'));
            var thumb = it.image || 'https://i.ibb.co/1fd4qVfY/9ovb3phc5b2u3q4d.jpg';
            var dateStr = '';
            if (it.date) {
              try {
                var d = new Date(it.date);
                dateStr = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
              } catch(e) {}
            }

            html += '<li class="instant-search-item" data-index="' + idx + '">' +
              '<a href="' + it.url + '">' +
                '<img class="instant-search-thumb" src="' + thumb + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'https://i.ibb.co/1fd4qVfY/9ovb3phc5b2u3q4d.jpg\';">' +
                '<div class="instant-search-info">' +
                  '<div class="instant-search-title">' + escapeHtml(it.title) + '</div>' +
                  '<div class="instant-search-meta">' +
                    '<span class="instant-search-badge ' + badgeClass + '">' + kindLabel + '</span>' +
                    (it.federation ? '<span class="instant-search-fed">' + escapeHtml(it.federation) + '</span>' : '') +
                    (dateStr ? '<span class="instant-search-date">' + dateStr + '</span>' : '') +
                  '</div>' +
                '</div>' +
              '</a>' +
            '</li>';
          });
          html += '</ul>';
          html += '<div class="instant-search-footer"><a class="instant-search-all-btn" href="' + LP + '/search/?q=' + encodeURIComponent(trimmed) + '">عرض جميع النتائج (' + matches.length + ') &larr;</a></div>';
          dropdown.innerHTML = html;
          updateDropdownPosition();
          selectedIndex = -1;
        });
      }

      input.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          performSearch(input.value);
        }, 120);
      });

      input.addEventListener('focus', function() {
        updateDropdownPosition();
        if (input.value.trim().length > 0) {
          performSearch(input.value);
        }
      });

      // Keyboard navigation (Arrow Down, Up, Enter, Esc)
      input.addEventListener('keydown', function(e) {
        if (!dropdown.classList.contains('open')) return;
        var items = dropdown.querySelectorAll('.instant-search-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedIndex = (selectedIndex + 1) % items.length;
          updateSelection(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIndex = (selectedIndex - 1 + items.length) % items.length;
          updateSelection(items);
        } else if (e.key === 'Enter') {
          if (selectedIndex >= 0 && items[selectedIndex]) {
            e.preventDefault();
            var link = items[selectedIndex].querySelector('a');
            if (link) window.location.href = link.href;
          }
        } else if (e.key === 'Escape') {
          dropdown.classList.remove('open');
          selectedIndex = -1;
        }
      });

      function updateSelection(items) {
        items.forEach(function(el, i) {
          if (i === selectedIndex) {
            el.classList.add('selected');
            el.scrollIntoView({ block: 'nearest' });
          } else {
            el.classList.remove('selected');
          }
        });
      }

      // Close dropdown when clicked outside
      document.addEventListener('click', function(e) {
        if (!form.contains(e.target)) {
          dropdown.classList.remove('open');
          selectedIndex = -1;
        }
      });
    });
  }

  /* ==========================================================================
     2. Watch Later / Bookmarks (المفضلة وقائمة المشاهدة لاحقا)
     ========================================================================== */
  var BOOKMARKS_KEY = 'arw_bookmarks';

  function getBookmarks() {
    try {
      var raw = localStorage.getItem(BOOKMARKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) {
      return [];
    }
  }

  function saveBookmarks(list) {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
      updateBookmarksBadge();
      renderBookmarksDrawer();
      updatePostBookmarkButtonState();
    } catch(e) {
      console.warn('ARW: Could not save bookmark to localStorage', e);
    }
  }

  function isBookmarked(url) {
    if (!url) return false;
    var normUrl = url.replace(/\/+$/, '') || '/';
    var list = getBookmarks();
    return list.some(function(item) {
      var itemNorm = (item.url || '').replace(/\/+$/, '') || '/';
      return itemNorm === normUrl;
    });
  }

  function toggleBookmark(item) {
    if (!item || !item.url) return;
    var normUrl = item.url.replace(/\/+$/, '') || '/';
    var list = getBookmarks();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      var itemNorm = (list[i].url || '').replace(/\/+$/, '') || '/';
      if (itemNorm === normUrl) {
        idx = i;
        break;
      }
    }

    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      var added = {
        url: item.url,
        title: item.title,
        image: item.image,
        kind: item.kind,
        kindLabel: item.kindLabel || (item.kind === 'show' ? 'عرض' : (item.kind === 'recap' ? 'ملخص' : 'خبر')),
        fed: item.fed || '',
        addedAt: Date.now()
      };
      list.unshift(added);
    }
    saveBookmarks(list);
    savedOp(idx >= 0 ? { op: 'remove', url: item.url } : { op: 'add', item: added });
  }

  // «المفضلة وشاهد لاحقا على كل أجهزتك» (owner 2026-10-15): a member's list lives with their account (worker/src/saved.ts).
  // Each change is sent at once (kept to send again if the connection drops); the account's list then replaces this
  // device's. The first time a device signs in, what it had saved is added to the account's.
  var SAVED_API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/saved', SAVED_OPS = 'arw-saved-ops';
  function savedMember() { try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); return s && s.token && s.member ? s : null; } catch (e) { return null; } }
  function savedOps(v) { try { if (v) localStorage.setItem(SAVED_OPS, JSON.stringify(v)); else return JSON.parse(localStorage.getItem(SAVED_OPS) || '[]'); } catch (e) { return []; } }
  function savedCall(body) {
    var s = savedMember();
    return fetch(SAVED_API, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json(); });
  }
  function savedTake(d) {
    if (!d || !d.ok || !Array.isArray(d.items)) return;
    var keep = d.items.map(function (x) { return { url: x.url, title: x.title, image: x.image, kind: x.kind, kindLabel: x.kind === 'show' ? 'عرض' : (x.kind === 'recap' ? 'ملخص' : 'خبر'), fed: x.fed, addedAt: x.addedAt }; });
    saveBookmarks(keep);
  }
  var savedBusy = false;
  function savedFlush() {
    var s = savedMember();
    if (!s || savedBusy) return Promise.resolve();
    var ops = savedOps();
    if (!ops.length) return Promise.resolve();
    savedBusy = true;
    var op = ops[0];
    return savedCall(op).then(function (d) {
      savedBusy = false;
      if (d && (d.ok || d.error)) { var rest = savedOps().slice(1); savedOps(rest.length ? rest : []); if (!rest.length) try { localStorage.removeItem(SAVED_OPS); } catch (e) {} }
      if (savedOps().length) return savedFlush();
      savedTake(d);
    }).catch(function () { savedBusy = false; });
  }
  function savedOp(op) {
    if (!savedMember()) return;
    var ops = savedOps(); ops.push(op); savedOps(ops.slice(-100));
    savedFlush();
  }
  function initSavedSync() {
    var s = savedMember();
    if (!s) return;
    var uid = s.member.username, mergedKey = 'arw-saved-merged:' + uid;
    var merged = false, last = 0;
    try { merged = !!localStorage.getItem(mergedKey); last = Number(sessionStorage.getItem('arw-saved-at')) || 0; } catch (e) {}
    savedFlush().then(function () {
      if (savedOps().length) return;
      if (!merged) {
        return savedCall({ op: 'merge', items: getBookmarks() }).then(function (d) { if (d && d.ok) { try { localStorage.setItem(mergedKey, '1'); sessionStorage.setItem('arw-saved-at', String(Date.now())); } catch (e) {} savedTake(d); } });
      }
      if (Date.now() - last < 120000) return;
      return savedCall(null).then(function (d) { if (d && d.ok) { try { sessionStorage.setItem('arw-saved-at', String(Date.now())); } catch (e) {} savedTake(d); } });
    }).catch(function () {});
  }

  function updateBookmarksBadge() {
    var count = getBookmarks().length;
    var badge = document.getElementById('arwBookmarkBadge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  function updatePostBookmarkButtonState() {
    var btn = document.getElementById('arwPostBookmarkBtn');
    if (!btn) return;
    var url = btn.getAttribute('data-url') || window.location.pathname;
    var bookmarked = isBookmarked(url);
    var textEl = btn.querySelector('.bm-btn-text');

    if (bookmarked) {
      btn.classList.add('bookmarked');
      btn.setAttribute('title', 'إزالة من المفضلة والمشاهدة لاحقا');
      if (textEl) textEl.textContent = 'محفوظ في المفضلة';
    } else {
      btn.classList.remove('bookmarked');
      btn.setAttribute('title', 'حفظ للمشاهدة لاحقا في المفضلة');
      if (textEl) textEl.textContent = 'حفظ للمشاهدة لاحقا';
    }
  }

  function renderBookmarksDrawer() {
    var drawerBody = document.getElementById('arwBookmarksBody');
    var drawerCount = document.getElementById('arwBookmarksCount');
    if (!drawerBody) return;

    var list = getBookmarks();
    if (drawerCount) {
      drawerCount.textContent = list.length + ' عنصر محفوظ';
    }

    if (!list.length) {
      drawerBody.innerHTML = '<div class="bookmarks-empty">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
        '<p>قائمة المشاهدة لاحقا فارغة حاليا.<br>اضغط على زر <strong>«حفظ للمشاهدة لاحقا»</strong> في أي عرض أو خبر للرجوع إليه هنا في أي وقت!</p>' +
      '</div>';
      return;
    }

    var html = '';
    list.forEach(function(it) {
      if (!/^\/[^\s"'<>]*$/.test(String(it.url || ''))) return;
      if (it.image && !/^(\/|https:\/\/)[^\s"'<>]*$/.test(String(it.image))) it.image = '';
      var badgeClass = it.kind === 'show' ? 'bookmark-badge-show' : (it.kind === 'recap' ? 'bookmark-badge-recap' : 'bookmark-badge-news');
      var kindLabel = it.kindLabel || (it.kind === 'show' ? 'عرض' : (it.kind === 'recap' ? 'ملخص' : 'خبر'));
      var thumb = it.image || 'https://i.ibb.co/1fd4qVfY/9ovb3phc5b2u3q4d.jpg';

      html += '<div class="bookmark-card">' +
        '<a href="' + it.url + '" style="display:flex; align-items:center; gap:12px; flex:1; min-width:0; text-decoration:none; color:inherit;">' +
          '<img class="bookmark-card-thumb" src="' + thumb + '" alt="" loading="lazy">' +
          '<div class="bookmark-card-info">' +
            '<div class="bookmark-card-title">' + escapeHtml(it.title) + '</div>' +
            '<div class="bookmark-card-meta">' +
              '<span class="bookmark-badge-tag ' + badgeClass + '">' + kindLabel + '</span>' +
              (it.fed ? '<span class="bookmark-badge-fed">' + escapeHtml(it.fed) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</a>' +
        '<button class="bookmark-card-remove" data-url="' + escapeHtml(it.url) + '" title="حذف من المحفوظات" aria-label="حذف">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
      '</div>';
    });
    drawerBody.innerHTML = html;

    // Attach individual remove handlers
    drawerBody.querySelectorAll('.bookmark-card-remove').forEach(function(rmBtn) {
      rmBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var targetUrl = this.getAttribute('data-url');
        var cur = getBookmarks().filter(function(b) { return b.url !== targetUrl; });
        saveBookmarks(cur);
        savedOp({ op: 'remove', url: targetUrl });
      });
    });
  }

  function initBookmarksUI() {
    // 1. Inject Header Bookmark Button if not already in utility-row
    var utilityRow = document.querySelector('.utility-row');
    if (utilityRow && !document.getElementById('arwBookmarksBtn')) {
      var bmBtn = document.createElement('button');
      bmBtn.className = 'theme-toggle bookmarks-btn';
      bmBtn.id = 'arwBookmarksBtn';
      bmBtn.setAttribute('type', 'button');
      bmBtn.setAttribute('aria-label', 'المفضلة وقائمة المشاهدة لاحقا');
      bmBtn.setAttribute('title', 'المفضلة والمشاهدة لاحقا');
      bmBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
        '<span class="bookmark-badge" id="arwBookmarkBadge" style="display:none;">0</span>';
      utilityRow.insertBefore(bmBtn, utilityRow.firstChild);
    }

    // 2. Inject Drawer Modal to Body if missing
    if (!document.getElementById('arwBookmarksDrawer')) {
      var overlay = document.createElement('div');
      overlay.className = 'bookmarks-drawer-overlay';
      overlay.id = 'arwBookmarksOverlay';

      var drawer = document.createElement('div');
      drawer.className = 'bookmarks-drawer';
      drawer.id = 'arwBookmarksDrawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-label', 'المفضلة وقائمة المشاهدة لاحقا');

      drawer.innerHTML = '<div class="bookmarks-drawer-head">' +
        '<div class="bookmarks-drawer-title">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
          '<span>المفضلة والمشاهدة لاحقا</span>' +
        '</div>' +
        '<button class="bookmarks-drawer-close" id="arwBookmarksClose" type="button" aria-label="إغلاق">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
      '</div>' +
      '<div class="bookmarks-drawer-body" id="arwBookmarksBody"></div>' +
      '<div class="bookmarks-drawer-foot">' +
        '<span id="arwBookmarksCount">0 عنصر</span>' +
        '<button class="bookmarks-clear-btn" id="arwBookmarksClear" type="button">مسح جميع المحفوظات</button>' +
      '</div>';

      document.body.appendChild(overlay);
      document.body.appendChild(drawer);

      function openDrawer() {
        renderBookmarksDrawer();
        overlay.classList.add('active');
        drawer.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      function closeDrawer() {
        overlay.classList.remove('active');
        drawer.classList.remove('active');
        document.body.style.overflow = '';
      }

      var openBtn = document.getElementById('arwBookmarksBtn');
      if (openBtn) openBtn.addEventListener('click', openDrawer);

      var closeBtn = document.getElementById('arwBookmarksClose');
      if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
      overlay.addEventListener('click', closeDrawer);

      var clearBtn = document.getElementById('arwBookmarksClear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function() {
          if (confirm('هل أنت متأكد من مسح جميع العروض والأخبار المحفوظة في قائمتك؟')) {
            saveBookmarks([]);
          }
        });
      }

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && drawer.classList.contains('active')) {
          closeDrawer();
        }
      });
    }

    // 3. Connect Post Bookmark Toggle Button
    var postBtn = document.getElementById('arwPostBookmarkBtn');
    if (postBtn) {
      postBtn.addEventListener('click', function() {
        var item = {
          url: postBtn.getAttribute('data-url') || window.location.pathname,
          title: postBtn.getAttribute('data-title') || document.title,
          image: postBtn.getAttribute('data-image') || '',
          kind: postBtn.getAttribute('data-kind') || 'show',
          kindLabel: postBtn.getAttribute('data-kindlabel') || 'عرض',
          fed: postBtn.getAttribute('data-fed') || ''
        };
        toggleBookmark(item);
      });
    }

    updateBookmarksBadge();
    updatePostBookmarkButtonState();
  }

  /* ==========================================================================
     Helper Utilities
     ========================================================================== */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ==========================================================================
     Bootstrapping
     ========================================================================== */
  /* ==========================================================================
     Share bar: copy link + the phone's own share sheet
     ========================================================================== */
  function initShare() {
    if (navigator.share) document.documentElement.classList.add('arw-can-share');
    document.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('.arw-share .sh-copy');
      var nativeBtn = e.target.closest('.arw-share .sh-native');
      if (!copyBtn && !nativeBtn) return;
      var box = e.target.closest('.arw-share');
      var url = box.getAttribute('data-url'), title = box.getAttribute('data-title');
      if (nativeBtn) {
        navigator.share({ title: title, text: title, url: url }).catch(function () {});
        return;
      }
      var done = function () {
        var label = copyBtn.querySelector('.sh-copy-text');
        var before = label ? label.textContent : '';
        copyBtn.classList.add('copied');
        if (label) label.textContent = 'تم النسخ ✓';
        setTimeout(function () { copyBtn.classList.remove('copied'); if (label) label.textContent = before; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt('انسخ الرابط:', url); });
      } else {
        window.prompt('انسخ الرابط:', url);
      }
    });
  }

  /* ==========================================================================
     Phones: compact header that hides while scrolling down + bottom navigation
     ========================================================================== */
  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    shows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a1 1 0 0 1 1 1v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M18 8h2a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2"/><path d="M8 8h6M8 12h6M8 16h4"/></svg>',
    nostalgia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v14"/><path d="M9 19V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12"/><path d="m15 6.5 2.9-.8a1 1 0 0 1 1.2.7l3 11.4a1 1 0 0 1-.7 1.2l-2.9.8"/><path d="M3 19h18"/></svg>',
    feds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z"/></svg>',
    recaps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.43-8.06C.69 10.2 1.2 6.6 4.1 4.9c2.3-1.35 5.1-.7 6.6 1.2.5.6.9 1.3 1.3 2 .4-.7.8-1.4 1.3-2 1.5-1.9 4.3-2.55 6.6-1.2 2.9 1.7 3.41 5.3 1.53 8.04C18.72 16.65 12 21 12 21Z"/></svg>',
    tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>'
  };

  function initMobileChrome() {
    var header = document.querySelector('header');
    var path = location.pathname;

    // Search moves behind an icon on phones.
    var util = header && header.querySelector('#navMenu li.utility-row');
    var search = header && header.querySelector('.site-search');
    if (util && search && !header.querySelector('.arw-search-toggle')) {
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'arw-search-toggle';
      toggle.setAttribute('aria-label', 'بحث');
      toggle.innerHTML = ICONS.search;
      util.insertBefore(toggle, util.firstChild);
      toggle.addEventListener('click', function () {
        var open = header.classList.toggle('arw-search-open');
        if (open) { var input = search.querySelector('input'); if (input) setTimeout(function () { input.focus(); }, 30); }
      });
    }

    // The header stays fixed on phones; it only gains a soft shadow once the page scrolls.
    if (header) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          header.classList.toggle('arw-scrolled', window.scrollY > 8);
          ticking = false;
        });
      }, { passive: true });
    }

    if (document.querySelector('.arw-bottom-nav')) return;
    var section = path === '/' ? 'home'
      : /^\/(shows)\//.test(path) ? 'shows'
      : /^\/news\//.test(path) ? 'news'
      : /^\/nostalgia\//.test(path) ? 'nostalgia'
      : /^\/(federations?|recaps|apps|support|library|community)\//.test(path) ? 'more' : '';
    var items = [
      ['home', '/', 'الرئيسية'], ['shows', '/shows/', 'العروض'], ['news', '/news/', 'الأخبار'], ['nostalgia', '/nostalgia/', 'نوستالجيا']
    ];
    var nav = document.createElement('nav');
    nav.className = 'arw-bottom-nav';
    nav.setAttribute('aria-label', 'التنقل السريع');
    nav.innerHTML = items.map(function (it) {
      return '<a href="' + it[1] + '"' + (section === it[0] ? ' class="active" aria-current="page"' : '') + '>' + ICONS[it[0]] + '<span>' + it[2] + '</span></a>';
    }).join('') + '<button type="button" class="arw-more-btn' + (section === 'more' ? ' active' : '') + '" aria-haspopup="dialog" aria-expanded="false">' + ICONS.more + '<span>المزيد</span></button>';
    document.body.appendChild(nav);
    document.body.classList.add('arw-has-bottom-nav');

    var overlay = document.createElement('div');
    overlay.className = 'arw-more-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'arw-more-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'المزيد من الأقسام');
    var mem = memberNow();
    sheet.innerHTML = '<div class="arw-more-grip"></div>' +
      '<a class="arw-more-acct" href="' + (document.documentElement.lang === 'en' ? '/en/account/' : '/account/') + '"><span class="arw-more-acct-av">' + (mem ? '<span class="arw-acct-in">' + memberAvatar(mem) + '</span>' : USER_IC) + '</span><span><b></b><small></small></span><i aria-hidden="true">‹</i></a>' +
      // «مجتمع المصارعة» (pages/community.njk)
      '<a class="arw-more-cm" href="/community/"><span class="arw-more-cm-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg></span><span><b>مجتمع المصارعة</b><small>دردش مع محبي اتحادك مباشرة</small></span><i aria-hidden="true">‹</i></a>' +
      '<div class="arw-more-title">كل الأقسام</div><div class="arw-more-grid">' +
      '<a href="' + LP + '/library/">' + ICONS.library + 'مكتبة العروض</a>' +
      '<a href="' + LP + '/federations/">' + ICONS.feds + 'الاتحادات</a>' +
      '<a href="' + LP + '/recaps/">' + ICONS.recaps + 'ملخصات العروض</a>' +
      '<a href="' + LP + '/history/">' + ICONS.history + 'سجل المشاهدة</a>' +
      // «التوقعات» was removed (owner 2026-10-25: «الغي قسم التوقعات نهائي»); the apps link takes the whole last row
      '<a href="' + LP + '/apps/" style="grid-column:1/-1; justify-content:center;">' + ICONS.apps + 'تطبيقات الموقع</a>' +
      // «العضوية المميزة» (pages/premium.njk) took «ادعم الموقع»'s place; hidden for a member who has it
      '<a class="more-support premium-btn" href="' + LP + '/premium/" style="grid-column:1/-1; justify-content:center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>العضوية المميزة</a>' +
      '</div>';
    sheet.querySelector('.arw-more-acct > span:not(.arw-more-acct-av) b').textContent = mem ? (mem.display || mem.username) : 'حسابك في عرب راسلنج';
    sheet.querySelector('.arw-more-acct > span:not(.arw-more-acct-av) small').textContent = mem ? (mem.official ? 'الحساب الرسمي' : Number(mem.premium) > Date.now() ? 'عضو مميز' : 'حسابي') : 'ادخل أو أنشئ حساب مجاني';
    crowned(sheet.querySelector('.arw-more-acct-av'), mem);
    if (mem) {
      // the member's own links, under their name: settings and signing out (the menu of the computers' header)
      var links = document.createElement('div');
      links.className = 'arw-more-acct-links';
      var H = document.documentElement.lang === 'en' ? '/en' : '';
      links.innerHTML = '<a href="' + H + '/account/#follows">قائمتي</a>' + (mem.official ? '' : '<a href="' + H + '/account/#subscription">اشتراكي</a>') + '<a href="' + H + '/account/#settings">الإعدادات</a><button type="button">تسجيل الخروج</button>';
      links.querySelector('button').addEventListener('click', signOut);
      sheet.querySelector('.arw-more-acct').insertAdjacentElement('afterend', links);
    }
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
    var moreBtn = nav.querySelector('.arw-more-btn');
    function setMore(open) {
      document.documentElement.classList.toggle('arw-more-open', open);
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    moreBtn.addEventListener('click', function () { setMore(!document.documentElement.classList.contains('arw-more-open')); });
    overlay.addEventListener('click', function () { setMore(false); });
    sheet.addEventListener('click', function (ev) { inPage(ev, function () { setMore(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMore(false); });
    // Swipe the sheet down to close it.
    var startY = null;
    sheet.addEventListener('touchstart', function (e) { startY = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchend', function (e) { if (startY !== null && e.changedTouches[0].clientY - startY > 60) setMore(false); startY = null; });
  }

  // Answers to the visitor's comments, on any page (owner 2026-10-14: «يجي تنبيه للمتابع لما … حد يرد عليه»): the key
  // assets/comments.js made when they commented asks the comments' worker what came since they last looked; a card
  // at the bottom says who answered, and opens the answer. At most one ask every 2 minutes.
  function initCommentReplies() {
    var key, since;
    try { key = JSON.parse(localStorage.getItem('arw-cm-key') || '""'); since = Number(JSON.parse(localStorage.getItem('arw-cm-seen') || '0')) || 0; } catch (e) { return; }
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key || '')) return;
    try { if (Date.now() - Number(sessionStorage.getItem('arw-cm-asked') || 0) < 120000) return; sessionStorage.setItem('arw-cm-asked', String(Date.now())); } catch (e) {}
    var EN = document.documentElement.lang === 'en';
    fetch('https://arw-site-bot.m7mdibrahimpc.workers.dev/comments/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ k: key, since: since }) })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (d) {
        var items = (d && d.items) || [];
        if (!items.length || document.querySelector('.arw-reply-toast')) return;
        var first = items[0];
        var newest = Math.max.apply(null, items.map(function (i) { return i.at; }));
        var seen = function () { try { localStorage.setItem('arw-cm-seen', JSON.stringify(newest)); } catch (e) {} };
        var who = first.official ? (EN ? 'Arab Wrestling' : 'عرب راسلنج') : first.name;
        var card = document.createElement('div');
        card.className = 'arw-reply-toast';
        card.setAttribute('role', 'status');
        card.innerHTML = '<a class="arw-rt-link"><span class="arw-rt-av" aria-hidden="true"></span><span class="arw-rt-body"><b></b><span class="arw-rt-text"></span></span></a><button type="button" class="arw-rt-x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
        var link = card.querySelector('.arw-rt-link');
        link.href = first.url;
        var av = card.querySelector('.arw-rt-av');
        if (first.official) av.innerHTML = '<img src="' + (EN ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png') + '" alt="">';
        else av.textContent = (String(first.name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase();
        // a reply, or the site's heart on their comment («أعجب عرب راسلنج بتعليقك»)
        card.querySelector('b').textContent = items.length > 1
          ? (items.length === 2 ? 'تنبيهان جديدان على تعليقاتك' : (items.length <= 10 ? '{n} تنبيهات جديدة على تعليقاتك' : '{n} تنبيها جديدا على تعليقاتك').replace('{n}', items.length))
          : first.kind === 'heart' ? 'أعجب عرب راسلنج بتعليقك ❤️' : '{n} رد على تعليقك'.replace('{n}', who);
        card.querySelector('.arw-rt-text').textContent = first.text;
        card.querySelector('.arw-rt-text').dir = 'auto';
        var x = card.querySelector('.arw-rt-x');
        x.setAttribute('aria-label', 'إغلاق');
        link.addEventListener('click', seen);
        x.addEventListener('click', function () { seen(); card.classList.remove('is-in'); setTimeout(function () { card.remove(); }, 300); });
        document.body.appendChild(card);
        requestAnimationFrame(function () { card.classList.add('is-in'); });
      })
      .catch(function () {});
  }

  // The member's way in (owner 2026-10-14: the site's accounts, /account/): a button in the header on computers (the
  // member's picture once signed in), and the first line of the phones' «المزيد» sheet.
  function memberNow() {
    try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); return s && s.token && s.member ? s.member : null; } catch (e) { return null; }
  }
  function memberAvatar(m) {
    var pic = String(m.pic || '');
    var src = pic === 'official' ? (document.documentElement.lang === 'en' ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png') : /^w:[a-z0-9-]+$/.test(pic) ? '/avatars/' + pic.slice(2) + '.webp' : /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/(comments\/pic\/\d+\.webp|members\/pic\/\d+\/[a-f0-9]{16}\.(webp|jpg|png))$/.test(pic) ? pic : '';
    var letter = (String(m.display || m.username).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['?'])[0].toUpperCase();
    return src ? '<img src="' + src + '" alt="">' : '<b>' + letter.replace(/[<>&"]/g, '') + '</b>';
  }
  var USER_IC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function initAccountButton() {
    var util = document.querySelector('header #navMenu li.utility-row');
    if (!util || util.querySelector('.arw-acct-btn')) return;
    var m = memberNow();
    var a = document.createElement('a');
    a.className = 'theme-toggle arw-acct-btn' + (m ? ' is-in' : '');
    a.href = document.documentElement.lang === 'en' ? '/en/account/' : '/account/';
    a.setAttribute('aria-label', m ? 'حسابك' : 'تسجيل الدخول');
    a.title = m ? (m.display || m.username) : 'تسجيل الدخول أو إنشاء حساب';
    a.innerHTML = m ? '<span class="arw-acct-in">' + memberAvatar(m) + '</span>' : USER_IC;
    crowned(a, m);
    util.insertBefore(a, util.querySelector('.bookmarks-btn') || util.firstChild);
    // the night mode and the saved list live in this menu now (owner 2026-10-15), for members and visitors alike
    accountMenu(a);
    document.documentElement.classList.add('arw-am-on');
    // the account page saved a change: the picture, the name and the crown follow without a reload
    window.addEventListener('arw-member', function () {
      var m2 = memberNow();
      a.classList.toggle('is-in', !!m2);
      a.setAttribute('aria-label', m2 ? 'حسابك' : 'تسجيل الدخول');
      a.title = m2 ? (m2.display || m2.username) : 'تسجيل الدخول أو إنشاء حساب';
      a.innerHTML = m2 ? '<span class="arw-acct-in">' + memberAvatar(m2) + '</span>' : USER_IC;
      crowned(a, m2);
      document.documentElement.classList.toggle('arw-in', !!m2);
      document.documentElement.classList.toggle('arw-is-prem', isPremium(m2));
    });
  }

  // A subscriber's picture: a gold ring and a crown under it (owner 2026-10-15: «دايرة دهبي حواليه … ايقونة تاج»);
  // the site's own account too. Used in the header, its menu and the phones' «المزيد».
  function isPremium(m) { return !!(m && (m.official || Number(m.premium) > Date.now())); }
  function crowned(el, m) {
    if (!el) return;
    var on = isPremium(m);
    el.classList.toggle('is-crown', on);
    var c = el.querySelector(':scope > .arw-crown');
    if (on && !c) { c = document.createElement('i'); c.className = 'arw-crown'; c.setAttribute('aria-hidden', 'true'); c.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/></svg>'; el.appendChild(c); }
    else if (!on && c) c.remove();
  }

  // The member's menu (owner 2026-10-15: «لما اضغط علي العضوية يظهر قائمة … قائمتي والاعدادات»): who they are, their
  // membership (or what «العضوية المميزة» gives, for those without it), their account, settings, the community, out.
  var CROWN_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
  var MENU_IC = {
    history: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    me: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    settings: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    panel: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    out: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>'
  };
  var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function signOut() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('arw-member') || 'null'); } catch (e) {}
    var done = function () { try { localStorage.removeItem('arw-member'); localStorage.removeItem('arw-member-at'); } catch (e) {} location.reload(); };
    if (!s || !s.token) return done();
    fetch('https://arw-site-bot.m7mdibrahimpc.workers.dev/members/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit' }).catch(function () {}).then(done);
  }
  // A link to another part of the page already open (the account page's «الإعدادات», «قائمتي», «اشتراكي»): the menu
  // closes and the page changes in place, where the member stands, never a reload (owner 2026-10-15: «المفروض يحدث
  // مكانه ويفضل مكان ما انا واقف»)
  function inPage(e, done) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (a.origin !== location.origin || a.pathname !== location.pathname) return;
    done();
    // «حسابي» (no #) on the account page: its first tab, in place too
    if (!a.hash && !/\/account\/$/.test(a.pathname)) return;
    e.preventDefault();
    history.replaceState(history.state, '', location.pathname + a.hash);
    try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (x) { location.hash = a.hash; }
  }
  function accountMenu(btn) {
    var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
    var pop = null;
    // the two tools that used to sit in the header: the night mode (a switch) and the saved list (with its count)
    function tools() {
      var dark = document.documentElement.classList.contains('arw-dark');
      var badge = document.getElementById('arwBookmarkBadge');
      var n = badge && badge.style.display !== 'none' ? (Number(badge.textContent) || 0) : 0;
      return '<div class="arw-am-tools">' +
        '<button type="button" class="arw-am-tool" data-tool="theme" role="menuitemcheckbox" aria-checked="' + dark + '">' + MENU_IC.moon + '<span>الوضع الليلي</span><i class="arw-am-switch' + (dark ? ' is-on' : '') + '" aria-hidden="true"></i></button>' +
        '<button type="button" class="arw-am-tool" data-tool="saved" role="menuitem">' + MENU_IC.saved + '<span>المفضلة</span>' + (n ? '<b class="arw-am-count">' + n + '</b>' : '') + '</button>' +
      '</div>';
    }
    function wireTools(el) {
      var t = el.querySelector('[data-tool="theme"]');
      t.addEventListener('click', function () {
        var btn = document.getElementById('arwThemeToggle'), root = document.documentElement;
        if (!btn) return;
        // the switch moves at once, then follows the page's real theme (the page fades over a moment)
        var show = function (dark) { t.setAttribute('aria-checked', String(dark)); t.querySelector('.arw-am-switch').classList.toggle('is-on', dark); };
        show(!root.classList.contains('arw-dark'));
        var mo = new MutationObserver(function () { show(root.classList.contains('arw-dark')); });
        mo.observe(root, { attributes: true, attributeFilter: ['class'] });
        setTimeout(function () { mo.disconnect(); show(root.classList.contains('arw-dark')); }, 1500);
        btn.click();
      });
      el.querySelector('[data-tool="saved"]').addEventListener('click', function () {
        close();
        var btn = document.getElementById('arwBookmarksBtn');
        if (btn) btn.click();
      });
    }
    function build() {
      var m = memberNow();
      if (!m) {
        // a visitor: signing in or up, then the same tools
        var v = document.createElement('div');
        v.className = 'arw-am';
        v.setAttribute('role', 'menu');
        v.innerHTML =
          '<div class="arw-am-guest"><span class="arw-am-av">' + USER_IC + '</span><span class="arw-am-who"><b>حسابك في عرب راسلنج</b><small>مجاني، ويستغرق أقل من دقيقة</small></span></div>' +
          '<div class="arw-am-cta"><a href="' + HOME + '/account/?new" role="menuitem">أنشئ حساب</a><a href="' + HOME + '/account/" role="menuitem">تسجيل الدخول</a></div>' +
          tools();
        wireTools(v);
        return v;
      }
      var prem = !m.official && Number(m.premium) > Date.now();
      var el = document.createElement('div');
      el.className = 'arw-am' + (prem ? ' is-prem' : '') + (m.official ? ' is-official' : '');
      el.setAttribute('role', 'menu');
      var until = prem ? new Date(Number(m.premium)) : null;
      var status = m.official ? 'الحساب الرسمي' : prem ? 'عضو مميز حتى ' + until.getDate() + ' ' + AR_MONTHS[until.getMonth()] : 'حساب مجاني';
      el.innerHTML =
        '<a class="arw-am-me" href="' + HOME + '/account/" role="menuitem"><span class="arw-am-av"><span class="arw-acct-in">' + memberAvatar(m) + '</span></span><span class="arw-am-who"><b></b><small dir="ltr"></small></span></a>' +
        '<div class="arw-am-status">' + (m.official || prem ? CROWN_IC : '') + '<span></span></div>' +
        (m.official || prem ? '' :
          '<a class="arw-am-up" href="' + LP + '/premium/" role="menuitem"><span class="arw-am-up-ic">' + CROWN_IC + '</span><span><b>اشترك في العضوية المميزة</b><small>العروض قبل الجميع، وتوثيق حسابك، وحماية من الإعلانات</small></span></a>') +
        '<nav class="arw-am-list">' +
          '<a href="' + HOME + '/account/" role="menuitem">' + MENU_IC.me + '<span>حسابي</span></a>' +
          '<a href="' + HOME + '/account/#follows" role="menuitem">' + BELL_IC + '<span>قائمتي</span></a>' +
          '<a href="' + HOME + '/account/#settings" role="menuitem">' + MENU_IC.settings + '<span>الإعدادات</span></a>' +
          (m.official ? '' : '<a href="' + HOME + '/account/#subscription" role="menuitem">' + CROWN_IC + '<span>اشتراكي</span></a>') +
          '<a href="/community/" role="menuitem">' + MENU_IC.chat + '<span>مجتمع المصارعة</span></a>' +
          '<a href="' + LP + '/history/" role="menuitem">' + MENU_IC.history + '<span>سجل المشاهدة</span></a>' +
          (m.official ? '<a href="/admin/" role="menuitem">' + MENU_IC.panel + '<span>لوحة التحكم</span></a>' : '') +
        '</nav>' +
        tools() +
        '<button type="button" class="arw-am-out" role="menuitem">' + MENU_IC.out + '<span>تسجيل الخروج</span></button>';
      el.querySelector('.arw-am-who b').textContent = m.display || m.username;
      el.querySelector('.arw-am-who small').textContent = '@' + m.username;
      el.querySelector('.arw-am-status span').textContent = status;
      el.querySelector('.arw-am-out').addEventListener('click', signOut);
      wireTools(el);
      crowned(el.querySelector('.arw-am-av'), m);
      return el;
    }
    function place() {
      var r = btn.getBoundingClientRect(), w = pop.offsetWidth;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      pop.style.top = (r.bottom + 10) + 'px';
      pop.style.left = left + 'px';
    }
    function close() {
      if (!pop) return;
      pop.remove(); pop = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', place, true);
    }
    // a person's click outside closes it; the clicks the menu itself sends (night mode) don't
    function outside(e) { if (e.isTrusted && pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function (e) {
      // a modified click still opens the page itself
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      if (pop) { close(); return; }
      pop = build();
      if (!pop) { location.href = btn.href; return; }
      pop.addEventListener('click', function (ev) { inPage(ev, close); });
      document.body.appendChild(pop);
      place();
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', place, true);
      var first = pop.querySelector('a'); if (first) first.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { close(); btn.focus(); } });
  }

  // a member who already has «العضوية المميزة» (or the site's own account) doesn't see the button for it
  // «العضوية المميزة» leaves the header once the member has it. What the browser knows is read again from the worker
  // every 20 minutes, so a membership paid for on another device (or one that ended) shows here too.
  function initPremiumButton() {
    function apply(m) {
      var on = !!(m && (m.official || Number(m.premium) > Date.now()));
      var st = document.getElementById('arw-prem-hide');
      document.documentElement.classList.toggle('arw-is-prem', on);
      if (on && !st) { st = document.createElement('style'); st.id = 'arw-prem-hide'; st.textContent = '.premium-btn{display:none !important}'; document.head.appendChild(st); }
      else if (!on && st) st.remove();
      crowned(document.querySelector('#navMenu .arw-acct-btn.is-in'), m);
      crowned(document.querySelector('.arw-more-acct-av'), m);
    }
    apply(memberNow());
    var s = null, at = 0;
    try { s = JSON.parse(localStorage.getItem('arw-member') || 'null'); at = Number(localStorage.getItem('arw-member-at')) || 0; } catch (e) {}
    if (!s || !s.token || Date.now() - at < 20 * 60000) return;
    try { localStorage.setItem('arw-member-at', String(Date.now())); } catch (e) {}
    fetch('https://arw-site-bot.m7mdibrahimpc.workers.dev/members/me', { headers: { Authorization: 'Bearer ' + s.token }, credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.member) return;
        var cur = JSON.parse(localStorage.getItem('arw-member') || 'null');
        if (!cur || cur.token !== s.token) return;
        cur.member = d.member;
        localStorage.setItem('arw-member', JSON.stringify(cur));
        apply(d.member);
      }).catch(function () {});
  }

  // A gentle invitation (owner 2026-10-15: «اشعار او تنبيه … بيظهر ثواني ويختفي عن الاشتراك والانضمام»): a small card
  // that slides in once, stays ~9 seconds and goes. A visitor is asked to join (free), a member without «العضوية المميزة»
  // is shown one of its perks. Never on the account, premium, community or panel pages, never while a show is playing,
  // at most once a day, and three days of rest after the ✕.
  function initJoinNudge() {
    var EN = document.documentElement.lang === 'en', HOME = EN ? '/en' : '';
    var path = location.pathname.replace(/^\/en(?=\/)/, '');
    if (/^\/(account|premium|community|admin|studio)\//.test(path)) return;
    var m = memberNow();
    if (m && (m.official || Number(m.premium) > Date.now())) return;
    var now = Date.now(), seen = 0, rest = 0;
    try { seen = Number(localStorage.getItem('arw-nudge-at')) || 0; rest = Number(localStorage.getItem('arw-nudge-rest')) || 0; } catch (e) { return; }
    if (now - seen < 864e5 || now < rest) return;
    var CROWN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
    var JOIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/></svg>';
    // no free trial (owner 2026-10-15: «مفيش اشتراك مجاني خالص كله مدفوع»)
    var offers = m ? [
      ['العروض الجديدة قبل الجميع', 'مع العضوية المميزة تشاهد العرض قبل نشره للكل بساعات.', 'اعرف أكثر', HOME + '/premium/'],
      ['حماية دائمة من الإعلانات', 'عندما نضيف إعلانات للموقع لاحقا، لن تظهر أبدا للأعضاء المميزين.', 'اعرف أكثر', HOME + '/premium/'],
      ['وثق حسابك', 'علامة التوثيق بجانب اسمك، واسمك باللون الذهبي في التعليقات والمجتمع.', 'اشترك الآن', HOME + '/premium/'],
      ['اطلب أي عرض ونترجمه لك', 'الأعضاء المميزون يطلبون العروض القديمة والسلاسل، ونحن نترجمها.', 'اعرف أكثر', HOME + '/premium/']
    ] : [
      ['انضم إلى عرب راسلنج مجانا', 'علق باسمك، ودردش مع محبي المصارعة في مجتمع المصارعة.', 'أنشئ حسابك', HOME + '/account/?new'],
      ['مجتمع المصارعة في انتظارك', 'مجموعات دردشة مباشرة لمتابعي كل اتحاد. أنشئ حسابك المجاني وادخل الآن.', 'أنشئ حسابك', HOME + '/account/?new']
    ];
    var o = offers[Math.floor(now / 864e5) % offers.length];
    var shown = false;
    function playing() { var d = document.getElementById('watchDeck'); return !!(d && !d.classList.contains('is-idle')); }
    function busy() { return playing() || document.documentElement.classList.contains('arw-more-open') || document.body.classList.contains('dl-modal-lock') || document.querySelector('.arw-am'); }
    function show() {
      if (shown || document.hidden) return;
      if (busy()) { setTimeout(show, 15000); return; }
      shown = true;
      try { localStorage.setItem('arw-nudge-at', String(Date.now())); } catch (e) {}
      var el = document.createElement('aside');
      el.className = 'arw-nudge' + (m ? ' is-prem' : '');
      el.setAttribute('role', 'status');
      el.innerHTML = '<span class="arw-nudge-ic">' + (m ? CROWN : JOIN) + '</span><span class="arw-nudge-tx"><b></b><small></small></span><a class="arw-nudge-go"></a><button type="button" class="arw-nudge-x" aria-label="إغلاق">✕</button><i class="arw-nudge-bar" aria-hidden="true"></i>';
      el.querySelector('b').textContent = o[0];
      el.querySelector('small').textContent = o[1];
      el.querySelector('.arw-nudge-go').textContent = o[2];
      el.querySelector('.arw-nudge-go').href = o[3];
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('is-in'); document.documentElement.classList.add('arw-nudge-on'); });
      var t = null, left = 9000, started = 0;
      function go() { el.classList.remove('is-in'); document.documentElement.classList.remove('arw-nudge-on'); setTimeout(function () { el.remove(); }, 400); }
      function run() { started = Date.now(); el.style.setProperty('--d', left + 'ms'); el.classList.add('is-run'); t = setTimeout(go, left); }
      function hold() { clearTimeout(t); left = Math.max(1500, left - (Date.now() - started)); el.classList.remove('is-run'); }
      el.addEventListener('mouseenter', hold); el.addEventListener('mouseleave', run);
      el.addEventListener('touchstart', hold, { passive: true }); el.addEventListener('touchend', run);
      el.querySelector('.arw-nudge-x').addEventListener('click', function () {
        try { localStorage.setItem('arw-nudge-rest', String(Date.now() + 3 * 864e5)); } catch (e) {}
        clearTimeout(t); go();
      });
      setTimeout(run, 50);
    }
    // after the visitor has looked around: 25 seconds on the page, or half of it read
    var timer = setTimeout(show, 25000);
    window.addEventListener('scroll', function onScroll() {
      var h = document.documentElement.scrollHeight - innerHeight;
      if (h > 400 && scrollY / h > 0.5) { window.removeEventListener('scroll', onScroll); clearTimeout(timer); setTimeout(show, 1200); }
    }, { passive: true });
  }


  // ── «المتابعة» (owner 2026-10-15) ─────────────────────────────────────────────────────────────────────────────
  // A member follows a program or a whole promotion (the buttons the pages carry, _includes/follow-btn.njk) and is
  // told of each new full translated show: in the bell next to their picture, and on their device if they allow it.
  // What they follow is kept in the browser too, so the buttons show it from the first moment.
  var FOLLOW_API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/follow';
  var FOLLOW_KEY = 'arw-follows';
  var BELL_IC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  var CHECK_IC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  function followSession() { try { var s = JSON.parse(localStorage.getItem('arw-member') || 'null'); return s && s.token && s.member ? s : null; } catch (e) { return null; } }
  function followCache() { try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || 'null'); } catch (e) { return null; } }
  function followSave(c) { try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(c)); } catch (e) {} }
  function followCall(path, body) {
    var s = followSession();
    return fetch(FOLLOW_API + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s ? s.token : '') }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function isFollowing(kind, key) { var c = followCache(); return !!(c && c.list && c.list.indexOf(kind + ':' + key) > -1); }
  function followToast(text, action, onAction) {
    var old = document.querySelector('.arw-follow-toast'); if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'arw-follow-toast'; t.setAttribute('role', 'status');
    var sp = document.createElement('span'); sp.textContent = text; t.appendChild(sp);
    if (action) { var b = document.createElement('button'); b.type = 'button'; b.textContent = action; b.onclick = function () { t.remove(); onAction(); }; t.appendChild(b); }
    var x = document.createElement('button'); x.type = 'button'; x.className = 'arw-follow-toast-x'; x.setAttribute('aria-label', 'إغلاق'); x.textContent = '×'; x.onclick = function () { t.remove(); }; t.appendChild(x);
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    setTimeout(function () { if (t.parentNode) { t.classList.remove('is-on'); setTimeout(function () { t.remove(); }, 300); } }, action ? 12000 : 4000);
  }
  function drawFollowButtons() {
    document.querySelectorAll('.arw-follow-btn[data-follow]').forEach(function (b) {
      var on = isFollowing(b.getAttribute('data-follow'), b.getAttribute('data-key'));
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.arw-follow-tx').textContent = on ? 'تتابع' : 'تابع';
      var ic = b.querySelector('.arw-follow-ic');
      if (ic) ic.outerHTML = (on ? CHECK_IC : BELL_IC).replace('<svg ', '<svg class="arw-follow-ic" ');
      b.title = on ? 'اضغط لإلغاء المتابعة' : 'يصلك إشعار أول ما ينزل عرض جديد مترجم';
      b.setAttribute('data-ready', '1');
    });
  }
  // the device too: the same push as the comments' answers (one key for the site), then the service worker knows
  // this member's device key and reads the bell when a push wakes it (sw.js)
  function enableFollowPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) { followToast('جهازك لا يدعم الإشعارات، ستجدها في الجرس أعلى الصفحة.'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { followToast('لم تفعل الإشعارات. ستجد العروض الجديدة في الجرس أعلى الصفحة.'); return false; }
      return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub) return sub;
          return fetch(FOLLOW_API + '/push-key', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
            var raw = atob(String(d.key).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(d.key).length + 3) % 4)), key = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          });
        }).then(function (sub) {
          return followCall('/push', { endpoint: sub.endpoint }).then(function (d) {
            if (!d.ok) throw new Error(d.error || '');
            try { localStorage.setItem('arw-follow-pk', d.pk); } catch (e) {}
            if (reg.active) reg.active.postMessage({ type: 'ARW_FOLLOW_PK', pk: d.pk, en: document.documentElement.lang === 'en' });
            followToast('تم. سيصلك إشعار على هذا الجهاز أول ما ينزل عرض جديد.');
            return true;
          });
        });
      });
    }).catch(function () { followToast('تعذر تفعيل الإشعارات على هذا الجهاز، ستجدها في الجرس أعلى الصفحة.'); return false; });
  }
  window.arwEnableFollowPush = enableFollowPush;
  function maybeAskPush() {
    var asked = 0; try { asked = Number(localStorage.getItem('arw-follow-asked')) || 0; } catch (e) {}
    if (!window.Notification || Notification.permission !== 'default' || Date.now() - asked < 7 * 864e5) { followToast('أضيف إلى قائمتك. أول ما ينزل له عرض جديد ستجده في الجرس أعلى الصفحة.'); return; }
    try { localStorage.setItem('arw-follow-asked', String(Date.now())); } catch (e) {}
    followToast('أضيف إلى قائمتك. هل تريد أن يصلك إشعار على جهازك أيضا؟', 'فعل الإشعارات', enableFollowPush);
  }
  function toggleFollow(b) {
    var kind = b.getAttribute('data-follow'), key = b.getAttribute('data-key'), label = b.getAttribute('data-label') || key;
    if (!followSession()) {
      location.href = LP + '/account/?new&back=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var c = followCache() || { at: 0, list: [], unread: 0 };
    var id = kind + ':' + key, on = c.list.indexOf(id) < 0;
    c.list = on ? [id].concat(c.list) : c.list.filter(function (x) { return x !== id; });
    followSave(c); drawFollowButtons();
    b.disabled = true;
    followCall('', { kind: kind, key: key, label: label, on: on }).then(function (d) {
      b.disabled = false;
      if (d.signedOut) { location.href = LP + '/account/?back=' + encodeURIComponent(location.pathname); return; }
      if (!d.ok) throw new Error(d.error || '');
      if (on) maybeAskPush(); else followToast(document.documentElement.lang === 'en' ? 'Removed ' + label + ' from your list.' : 'حذفت ' + label + ' من قائمتك.');
      try { window.dispatchEvent(new CustomEvent('arw-follows')); window.dispatchEvent(new CustomEvent('arw-follows-changed')); } catch (e) {}
    }).catch(function (e) {
      b.disabled = false;
      var c2 = followCache() || { list: [] };
      c2.list = on ? c2.list.filter(function (x) { return x !== id; }) : [id].concat(c2.list);
      followSave(c2); drawFollowButtons();
      var em = e && e.message ? (LP ? window.arwMsg(e.message) : e.message) : '';
      followToast(em || 'تعذرت المتابعة، حاول مرة أخرى.');
    });
  }
  function refreshFollows(force) {
    var s = followSession(), c = followCache();
    if (!s) return Promise.resolve(null);
    if (!force && c && c.uid === s.member.username && Date.now() - (c.at || 0) < 120000) return Promise.resolve(c);
    return followCall('').then(function (d) {
      if (d.signedOut || !d.ok) return c;
      var n = { at: Date.now(), uid: s.member.username, list: (d.follows || []).map(function (f) { return f.kind + ':' + f.key; }), labels: d.follows || [], unread: d.unread || 0 };
      followSave(n); drawFollowButtons(); drawBellCount();
      return n;
    }).catch(function () { return c; });
  }
  function initFollow() {
    var s = followSession(), c = followCache();
    // another member signed in on this browser: their own list, not the last one's
    if (c && s && c.uid !== s.member.username) { followSave(null); }
    if (!s && c) followSave(null);
    drawFollowButtons();
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.arw-follow-btn[data-follow]');
      if (b) { e.preventDefault(); toggleFollow(b); }
    });
    window.addEventListener('arw-follows', function () { drawFollowButtons(); });
    if (s) { initBell(); refreshFollows(false); }
  }

  // the bell: the member's inbox (a new show of what they follow), next to their picture
  var bellBtn = null, bellPop = null;
  function drawBellCount() {
    if (!bellBtn) return;
    var c = followCache(), n = c ? Number(c.unread) || 0 : 0;
    var b = bellBtn.querySelector('.arw-bell-n');
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = !n;
    bellBtn.setAttribute('aria-label', n ? (document.documentElement.lang === 'en' ? n + ' new notifications' : 'الإشعارات، ' + n + ' جديدة') : 'الإشعارات');
  }
  function timeAgo(t) {
    var EN = document.documentElement.lang === 'en';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return EN ? 'just now' : 'الآن';
    if (m < 60) return EN ? m + ' min ago' : 'منذ ' + m + ' دقيقة';
    var h = Math.round(m / 60); if (h < 24) return EN ? h + (h === 1 ? ' hour ago' : ' hours ago') : 'منذ ' + h + ' ساعة';
    var d = Math.round(h / 24); return d === 1 ? (EN ? 'yesterday' : 'أمس') : EN ? d + ' days ago' : 'منذ ' + d + ' أيام';
  }
  function closeBell() { if (bellPop) { bellPop.remove(); bellPop = null; bellBtn.setAttribute('aria-expanded', 'false'); } }
  function openBell() {
    if (bellPop) return closeBell();
    var EN = document.documentElement.lang === 'en';
    bellPop = document.createElement('div');
    bellPop.className = 'arw-bell-pop';
    bellPop.setAttribute('role', 'dialog');
    bellPop.setAttribute('aria-label', 'الإشعارات');
    bellPop.innerHTML = '<div class="arw-bell-head"><b>الإشعارات</b><a href="' + LP + '/account/#follows">قائمتي</a></div><div class="arw-bell-list"><div class="arw-bell-wait"><span></span></div></div>';
    document.body.appendChild(bellPop);
    var r = bellBtn.getBoundingClientRect();
    bellPop.style.top = Math.round(r.bottom + 10) + 'px';
    if (window.innerWidth > 560) { var left = Math.max(12, Math.min(window.innerWidth - bellPop.offsetWidth - 12, r.left + r.width / 2 - bellPop.offsetWidth / 2)); bellPop.style.left = left + 'px'; }
    bellBtn.setAttribute('aria-expanded', 'true');
    var list = bellPop.querySelector('.arw-bell-list');
    followCall('/inbox').then(function (d) {
      if (!bellPop) return;
      list.textContent = '';
      var items = (d && d.items) || [];
      if (!items.length) {
        var e = document.createElement('div'); e.className = 'arw-bell-empty';
        e.innerHTML = '<span class="arw-bell-empty-ic">' + BELL_IC + '</span><b></b><p></p><a></a>';
        e.querySelector('b').textContent = 'لا توجد إشعارات بعد';
        e.querySelector('p').textContent = 'أضف برامجك واتحاداتك المفضلة إلى قائمتك بزر «تابع»، ويصلك إشعار هنا أول ما ينزل لها عرض جديد مترجم.';
        var a = e.querySelector('a'); a.href = LP + '/account/#follows'; a.textContent = 'أضف إلى قائمتي';
        list.appendChild(e);
        return;
      }
      items.forEach(function (it) {
        var a = document.createElement('a');
        a.className = 'arw-bell-item' + (it.read ? '' : ' is-new');
        a.href = (EN ? '/en' : '') + it.url;
        a.innerHTML = '<span class="arw-bell-img"></span><span class="arw-bell-tx"><small></small><b></b><time></time></span>';
        if (/^\/[^\s"'<>]*$/.test(it.image || '') || /^https:\/\/[^\s"'<>]+$/.test(it.image || '')) { var im = document.createElement('img'); im.onerror = function () { this.remove(); }; im.src = it.image; im.alt = ''; im.loading = 'lazy'; a.querySelector('.arw-bell-img').appendChild(im); }
        var isPred = /^\/predictions\//.test(it.url);
        a.querySelector('small').textContent = isPred ? (EN ? 'Predictions results' : 'نتائج التوقعات') : (EN ? 'New translated show' : 'عرض جديد مترجم') + (it.program ? ' · ' + it.program : '');
        a.querySelector('b').textContent = EN ? (it.title_en || it.title) : it.title;
        a.querySelector('time').textContent = timeAgo(it.at);
        list.appendChild(a);
      });
      // seen: the count goes, what was new stays marked while the bell is open
      if (d.unread) followCall('/read', { all: true }).then(function () { var c = followCache(); if (c) { c.unread = 0; followSave(c); } drawBellCount(); });
    }).catch(function () { if (bellPop) list.innerHTML = '<p class="arw-bell-err">تعذر تحميل الإشعارات، حاول مرة أخرى.</p>'; });
  }
  function initBell() {
    var util = document.querySelector('header #navMenu li.utility-row');
    if (!util || util.querySelector('.arw-bell')) return;
    bellBtn = document.createElement('button');
    bellBtn.type = 'button';
    bellBtn.className = 'theme-toggle arw-bell';
    bellBtn.setAttribute('aria-haspopup', 'dialog');
    bellBtn.setAttribute('aria-expanded', 'false');
    bellBtn.innerHTML = BELL_IC + '<span class="arw-bell-n" hidden></span>';
    var acct = util.querySelector('.arw-acct-btn');
    util.insertBefore(bellBtn, acct || util.firstChild);
    drawBellCount();
    bellBtn.addEventListener('click', function (e) { e.stopPropagation(); openBell(); });
    document.addEventListener('click', function (e) { if (bellPop && e.isTrusted && !bellPop.contains(e.target)) closeBell(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBell(); });
    window.addEventListener('resize', closeBell);
    window.addEventListener('scroll', function () { if (bellPop && window.innerWidth > 560) closeBell(); }, { passive: true });
    // a page left open: the count again every few minutes
    setInterval(function () { if (!document.hidden) refreshFollows(true); }, 5 * 60000);
  }


  // ── «تابع المشاهدة» و«سجل المشاهدة» (owner 2026-10-15) ───────────────────────────────────────────────────────────
  // A signed-in member who starts a show, a recap or a nostalgia episode has it kept with their account
  // (worker/src/watch.ts), with about how long the page played; the home page offers to go back to it (#continue),
  // and /history/ lists everything they watched.
  var WATCH_API = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/watch', CW_KEY = 'arw-cw';
  function watchCall(q, body, keep) {
    var s = savedMember();
    if (!s) return Promise.resolve({});
    return fetch(WATCH_API + (q || ''), { method: body ? 'POST' : 'GET', keepalive: !!keep, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) { return r.json(); }).catch(function () { return {}; });
  }
  function initWatchTrack() {
    var btn = document.getElementById('arwPostBookmarkBtn');
    if (!btn || !savedMember()) return;
    var url = btn.getAttribute('data-url') || location.pathname;
    if (!/^\/(shows|recaps|nostalgia)\//.test(url)) return;
    var item = { url: url, title: btn.getAttribute('data-title') || document.title, image: btn.getAttribute('data-image') || '', fed: btn.getAttribute('data-fed') || '', duration: btn.getAttribute('data-duration') || '' };
    var started = false, acc = 0;
    function flush(keep) { if (!acc) return; var secs = acc; acc = 0; watchCall('', { op: 'tick', url: url, secs: secs }, keep); }
    window.addEventListener('arw-watch-start', function () {
      if (started) return;
      started = true;
      try { localStorage.removeItem(CW_KEY); } catch (e) {}
      watchCall('', { op: 'start', item: item });
      // the time the page plays while it's in front of them; sent every two minutes and when they leave
      setInterval(function () { if (!document.hidden) { acc += 30; if (acc >= 120) flush(false); } }, 30000);
      document.addEventListener('visibilitychange', function () { if (document.hidden) flush(true); });
      window.addEventListener('pagehide', function () { flush(true); });
    });
  }
  function watchKind(k) { return k === 'recap' ? 'ملخص' : k === 'nostalgia' ? 'نوستالجيا' : 'عرض'; }
  function watchedLine(it) {
    var EN = document.documentElement.lang === 'en';
    var m = Math.round((it.watched || 0) / 60), d = Math.round((it.duration || 0) / 60);
    if (!m) return EN ? 'Just started' : 'بدأت المشاهدة';
    if (d) return EN ? m + ' of ' + d + ' min' : 'شاهدت ' + m + ' من ' + d + ' دقيقة';
    return EN ? m + ' min watched' : 'شاهدت ' + m + ' دقيقة';
  }
  function initContinue() {
    var sec = document.getElementById('continue');
    if (!sec) return;
    var s = savedMember();
    var row = sec.querySelector('.arw-cw-row');
    function draw(items) {
      try { localStorage.setItem('arw-cw-n', String(items.length)); } catch (e) {}
      sec.hidden = !items.length;
      document.documentElement.classList.toggle('arw-has-cw', !!items.length);
      row.textContent = '';
      items.forEach(function (it) {
        if (!/^\/(shows|recaps|nostalgia)\/[^\s"'<>]*$/.test(String(it.url || ''))) return;
        var a = document.createElement('a');
        a.className = 'arw-cw-card';
        a.href = LP + it.url;
        var pct = it.duration ? Math.min(100, Math.max(4, Math.round((it.watched / it.duration) * 100))) : 0;
        a.innerHTML = '<span class="arw-cw-img"><span class="arw-cw-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span><i class="arw-cw-bar"><i></i></i></span><span class="arw-cw-tx"><small></small><b></b><em></em></span><button type="button" class="arw-cw-x" aria-label="إخفاء من تابع المشاهدة" title="إخفاء من تابع المشاهدة">×</button>';
        if (it.image && /^(\/|https:\/\/)[^\s"'<>]*$/.test(it.image)) { var im = document.createElement('img'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; im.onerror = function () { this.remove(); }; a.querySelector('.arw-cw-img').prepend(im); }
        a.querySelector('.arw-cw-bar > i').style.width = (pct || 4) + '%';
        if (!pct) a.querySelector('.arw-cw-bar').classList.add('is-unknown');
        a.querySelector('small').textContent = watchKind(it.kind) + (it.fed ? ' · ' + it.fed : '');
        a.querySelector('b').textContent = it.title || it.url;
        a.querySelector('em').textContent = watchedLine(it);
        a.querySelector('.arw-cw-x').addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          a.remove();
          watchCall('', { op: 'hide', url: it.url });
          var c = []; try { c = (JSON.parse(localStorage.getItem(CW_KEY) || '{}').items || []).filter(function (x) { return x.url !== it.url; }); localStorage.setItem(CW_KEY, JSON.stringify({ uid: s.member.username, at: Date.now(), items: c })); } catch (er) {}
          if (!row.children.length) draw([]);
        });
        row.appendChild(a);
      });
    }
    if (!s) { sec.hidden = true; try { localStorage.removeItem('arw-cw-n'); } catch (e) {} return; }
    var cache = null; try { cache = JSON.parse(localStorage.getItem(CW_KEY) || 'null'); } catch (e) {}
    if (cache && cache.uid === s.member.username) draw(cache.items || []);
    if (cache && cache.uid === s.member.username && Date.now() - (cache.at || 0) < 60000) return;
    watchCall('?continue=1').then(function (d) {
      if (!d || !d.ok) { if (d && d.signedOut) draw([]); return; }
      try { localStorage.setItem(CW_KEY, JSON.stringify({ uid: s.member.username, at: Date.now(), items: d.items })); } catch (e) {}
      draw(d.items || []);
    });
  }

  function initFeatures() {
    initInstantSearch();
    initBookmarksUI();
    initSavedSync();
    initWatchTrack();
    initContinue();
    initShare();
    initMobileChrome();
    initCommentReplies();
    initAccountButton();
    initFollow();
    initPremiumButton();
    initJoinNudge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeatures);
  } else {
    initFeatures();
  }
})();
