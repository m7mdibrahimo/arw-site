/**
 * Arab Wrestling - Client Enhancements
 * 1. Instant Live Search Dropdown
 * 2. Watch Later / Bookmarks (المفضلة وقائمة المشاهدة لاحقاً)
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
            var span = brand.querySelector('span');
            var spanRect = span ? span.getBoundingClientRect() : null;
            var homeLink = document.querySelector('#navMenu a.navlink') || document.querySelector('.nav a.navlink');
            var homeRect = homeLink ? homeLink.getBoundingClientRect() : null;

            // Right edge: start of 'راسلنج' (leaving 'عرب' visible on the right)
            var targetRight = spanRect ? spanRect.right : (brandRect.right - 50);
            targetRight = Math.min(targetRight, (window.innerWidth || document.documentElement.clientWidth) - 12);

            // Left edge: middle of 'الرئيسية' link
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
     2. Watch Later / Bookmarks (المفضلة وقائمة المشاهدة لاحقاً)
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
      btn.setAttribute('title', 'إزالة من المفضلة والمشاهدة لاحقاً');
      if (textEl) textEl.textContent = 'محفوظ في المفضلة';
    } else {
      btn.classList.remove('bookmarked');
      btn.setAttribute('title', 'حفظ للمشاهدة لاحقاً في المفضلة');
      if (textEl) textEl.textContent = 'حفظ للمشاهدة لاحقاً';
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
        '<p>قائمة المشاهدة لاحقاً فارغة حالياً.<br>اضغط على زر <strong>«حفظ للمشاهدة لاحقاً»</strong> في أي عرض أو خبر للرجوع إليه هنا في أي وقت!</p>' +
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
      bmBtn.setAttribute('aria-label', 'المفضلة وقائمة المشاهدة لاحقاً');
      bmBtn.setAttribute('title', 'المفضلة والمشاهدة لاحقاً');
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
      drawer.setAttribute('aria-label', 'المفضلة وقائمة المشاهدة لاحقاً');

      drawer.innerHTML = '<div class="bookmarks-drawer-head">' +
        '<div class="bookmarks-drawer-title">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
          '<span>المفضلة والمشاهدة لاحقاً</span>' +
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
  function initFeatures() {
    initInstantSearch();
    initBookmarksUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeatures);
  } else {
    initFeatures();
  }
})();
