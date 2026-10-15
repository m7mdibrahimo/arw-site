/**
 * Arab Wrestling - Client Enhancements
 * 1. Instant Live Search Dropdown
 * 2. Watch Later / Bookmarks (المفضلة وقائمة المشاهدة لاحقا)
 * 3. Interactive Spoiler Blocker (كشف/إخفاء الفائزين)
 */
(function() {
  'use strict';

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
              '<div class="instant-search-footer"><a class="instant-search-all-btn" href="/search/?q=' + encodeURIComponent(trimmed) + '">البحث الشامل في الموقع &larr;</a></div>';
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
          html += '<div class="instant-search-footer"><a class="instant-search-all-btn" href="/search/?q=' + encodeURIComponent(trimmed) + '">عرض جميع النتائج (' + matches.length + ') &larr;</a></div>';
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
      list.unshift({
        url: item.url,
        title: item.title,
        image: item.image,
        kind: item.kind,
        kindLabel: item.kindLabel || (item.kind === 'show' ? 'عرض' : (item.kind === 'recap' ? 'ملخص' : 'خبر')),
        fed: item.fed || '',
        addedAt: Date.now()
      });
    }
    saveBookmarks(list);
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
      '<a href="/library/">' + ICONS.library + 'مكتبة العروض</a>' +
      '<a href="/federations/">' + ICONS.feds + 'الاتحادات</a>' +
      '<a href="/recaps/">' + ICONS.recaps + 'ملخصات العروض</a>' +
      '<a href="/apps/">' + ICONS.apps + 'تطبيقات الموقع</a>' +
      // «العضوية المميزة» (pages/premium.njk) took «ادعم الموقع»'s place; hidden for a member who has it
      '<a class="more-support premium-btn" href="/premium/" style="grid-column:1/-1; justify-content:center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>العضوية المميزة</a>' +
      '</div>';
    sheet.querySelector('.arw-more-acct > span:not(.arw-more-acct-av) b').textContent = mem ? (mem.display || mem.username) : 'حسابك في عرب راسلنج';
    sheet.querySelector('.arw-more-acct > span:not(.arw-more-acct-av) small').textContent = mem ? (mem.official ? 'الحساب الرسمي' : Number(mem.premium) > Date.now() ? 'عضو مميز' : 'حسابي') : 'ادخل أو أنشئ حساب مجاني';
    crowned(sheet.querySelector('.arw-more-acct-av'), mem);
    if (mem) {
      // the member's own links, under their name: settings and signing out (the menu of the computers' header)
      var links = document.createElement('div');
      links.className = 'arw-more-acct-links';
      var H = document.documentElement.lang === 'en' ? '/en' : '';
      links.innerHTML = (mem.official ? '' : '<a href="' + H + '/account/#subscription">اشتراكي</a>') + '<a href="' + H + '/account/#settings">الإعدادات</a><button type="button">تسجيل الخروج</button>';
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
    var src = pic === 'official' ? (document.documentElement.lang === 'en' ? '/assets/brand-logo-en.png' : '/assets/brand-logo.png') : /^w:[a-z0-9-]+$/.test(pic) ? '/avatars/' + pic.slice(2) + '.webp' : /^https:\/\/arw-site-bot\.m7mdibrahimpc\.workers\.dev\/comments\/pic\/\d+\.webp$/.test(pic) ? pic : '';
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
          '<a class="arw-am-up" href="/premium/" role="menuitem"><span class="arw-am-up-ic">' + CROWN_IC + '</span><span><b>اشترك في العضوية المميزة</b><small>العروض قبل الجميع، بدون إعلانات، وتوثيق حسابك</small></span></a>') +
        '<nav class="arw-am-list">' +
          '<a href="' + HOME + '/account/" role="menuitem">' + MENU_IC.me + '<span>حسابي</span></a>' +
          '<a href="' + HOME + '/account/#settings" role="menuitem">' + MENU_IC.settings + '<span>الإعدادات</span></a>' +
          (m.official ? '' : '<a href="' + HOME + '/account/#subscription" role="menuitem">' + CROWN_IC + '<span>اشتراكي</span></a>') +
          '<a href="/community/" role="menuitem">' + MENU_IC.chat + '<span>مجتمع المصارعة</span></a>' +
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
    var offers = m ? [
      ['العروض الجديدة قبل الجميع', 'مع العضوية المميزة تشاهد العرض قبل نشره للكل بساعات.', 'اعرف أكثر', '/premium/'],
      ['شاهد بدون إعلانات', 'سيرفرات خاصة للأعضاء المميزين: أسرع وبدون نوافذ مزعجة.', 'اعرف أكثر', '/premium/'],
      ['وثق حسابك', 'علامة التوثيق بجانب اسمك، واسمك باللون الذهبي في التعليقات والمجتمع.', 'اشترك الآن', '/premium/'],
      ['اطلب أي عرض ونترجمه لك', 'الأعضاء المميزون يطلبون العروض القديمة والسلاسل، ونحن نترجمها.', 'اعرف أكثر', '/premium/']
    ] : [
      ['انضم إلى عرب راسلنج مجانا', 'علق باسمك، ودردش مع محبي المصارعة في مجتمع المصارعة.', 'أنشئ حسابك', HOME + '/account/?new'],
      ['مجتمع المصارعة في انتظارك', 'غرف دردشة مباشرة لكل اتحاد. أنشئ حسابك المجاني وادخل الآن.', 'أنشئ حسابك', HOME + '/account/?new']
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

  function initFeatures() {
    initInstantSearch();
    initBookmarksUI();
    initShare();
    initMobileChrome();
    initCommentReplies();
    initAccountButton();
    initPremiumButton();
    initJoinNudge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeatures);
  } else {
    initFeatures();
  }
})();
