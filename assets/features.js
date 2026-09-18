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

      function performSearch(query) {
        var trimmed = query.trim();
        if (!trimmed) {
          dropdown.classList.remove('open');
          dropdown.innerHTML = '';
          return;
        }

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
      if (textEl) textEl.textContent = 'حفظ للمشاهدة';
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
        '<p>قائمة المشاهدة لاحقاً فارغة حالياً.<br>اضغط على زر <strong>«حفظ للمشاهدة»</strong> في أي عرض أو خبر للرجوع إليه هنا في أي وقت!</p>' +
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
     3. Interactive Spoiler Blocker (حماية الحرق)
     ========================================================================== */
  function initSpoilerBlocker() {
    var spoilers = document.querySelectorAll('.spoiler-result');
    if (!spoilers.length) return;

    var postBody = document.querySelector('.post-body');
    if (!postBody) return;

    // Check if control banner already exists
    if (!document.getElementById('arwSpoilerBanner')) {
      var banner = document.createElement('div');
      banner.className = 'spoiler-control-banner';
      banner.id = 'arwSpoilerBanner';
      banner.innerHTML = '<div class="spoiler-banner-info">' +
        '<span>🛡️</span>' +
        '<span>حماية حرق النتائج مفعلة (' + spoilers.length + ' نزال)</span>' +
      '</div>' +
      '<button class="spoiler-banner-btn" id="arwSpoilerToggleAll" type="button">' +
        '<span>كشف جميع النتائج</span>' +
      '</button>';

      postBody.insertBefore(banner, postBody.firstChild);

      var allRevealed = false;
      var toggleBtn = document.getElementById('arwSpoilerToggleAll');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
          allRevealed = !allRevealed;
          spoilers.forEach(function(sp) {
            if (allRevealed) {
              sp.classList.add('revealed');
            } else {
              sp.classList.remove('revealed');
            }
          });
          toggleBtn.querySelector('span').textContent = allRevealed ? 'إخفاء جميع النتائج' : 'كشف جميع النتائج';
        });
      }
    }

    // Individual click to toggle reveal
    spoilers.forEach(function(spoiler) {
      spoiler.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.toggle('revealed');
      });
    });
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
    initSpoilerBlocker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeatures);
  } else {
    initFeatures();
  }
})();
