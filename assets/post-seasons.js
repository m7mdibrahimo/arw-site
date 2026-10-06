// Moved out of _includes/post-layout.njk so the ~2,900 article pages share one cached copy (INCIDENTS #311).
        (function(){
          var root = document.currentScript.previousElementSibling;
          if (!root) return;
          var tabs = root.querySelectorAll('.season-tab');
          var panels = root.querySelectorAll('[data-season-panel]');
          var pills = root.querySelectorAll('.ep-pill');
          var searchInput = root.querySelector('.episodes-search-input');
          var clearBtn = root.querySelector('.episodes-search-clear');
          var searchBox = root.querySelector('.episodes-search');
          var noResults = root.querySelector('.episodes-no-results');

          function activeSeasonKey(){
            var activeTab = root.querySelector('.season-tab.active');
            if (activeTab) return activeTab.getAttribute('data-season');
            // مفيش تابات مواسم أصلاً (زي العروض السنوية) - نرجع الباناڤيل الوحيد الموجود
            var firstPanel = root.querySelector('[data-season-panel]');
            return firstPanel ? firstPanel.getAttribute('data-season-panel') : null;
          }

          function showSeasonOnly(seasonKey){
            panels.forEach(function(p){
              p.style.display = (p.getAttribute('data-season-panel') === seasonKey) ? 'flex' : 'none';
            });
          }

          tabs.forEach(function(tab){
            tab.addEventListener('click', function(){
              tabs.forEach(function(t){ t.classList.remove('active'); });
              tab.classList.add('active');
              if (searchInput) { searchInput.value = ''; }
              if (clearBtn) { clearBtn.classList.remove('show'); }
              if (noResults) { noResults.style.display = 'none'; }
              pills.forEach(function(pill){ pill.style.display = ''; });
              showSeasonOnly(tab.getAttribute('data-season'));
            });
          });

          // بحث بيوم/شهر/سنة/رقم عرض عبر كل المواسم مرة واحدة
          // بيحوّل الأرقام العربية/الهندية (٠١٢٣...) لأرقام إنجليزية عادية، وبيشيل حروف تحكم خفية
          // ممكن بعض الكيبوردات العربية تحطها تلقائي، عشان البحث يشتغل صح مهما كانت طريقة الكتابة
          function normalizeQuery(str){
            var eastern = '٠١٢٣٤٥٦٧٨٩';
            var extended = '۰۱۲۳۴۵۶۷۸۹';
            var out = str.normalize ? str.normalize('NFC') : str;
            out = out.replace(/[٠-٩۰-۹]/g, function(ch){
              var i = eastern.indexOf(ch);
              if (i > -1) return String(i);
              i = extended.indexOf(ch);
              if (i > -1) return String(i);
              return ch;
            });
            // بعض الكيبوردات (فارسي/أوردو) بتكتب حروف عربية شكلها زي بعض بس Unicode مختلف (زي الياء الفارسية)
            out = out.replace(/[\u06CC\u0649]/g, '\u064A'); // ی / ى → ي
            out = out.replace(/[\u06A9]/g, '\u0643'); // ک → ك
            out = out.replace(/[\u0640]/g, ''); // تطويل ـ
            out = out.replace(/[\u064B-\u0652]/g, ''); // شكل/تشكيل
            return out.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
          }

          function parseQuery(q){
            var monthMatch = q.match(/شهر[^\d]*(\d{1,2})/);
            var dayMatch = q.match(/يوم[^\d]*(\d{1,2})/);
            var yearMatch = q.match(/سنة[^\d]*(\d{4})/) || q.match(/^(20\d{2})$/);
            var trimmed = q.trim();
            var keywords = ['يوم', 'شهر', 'سنة'];
            // لسه بيكتب بداية كلمة "يوم"/"شهر"/"سنة" (حتى لو حرف واحد بس) وماوصلش لرقم بعدها لسه -
            // منورّيش "مفيش نتائج" وهو لسه مخلصش يكتب، نسيب النتائج زي ما هي لحد ما يكمل
            var isKeywordPrefix = trimmed.length > 0 && keywords.some(function(kw){ return kw.indexOf(trimmed) === 0; });
            var pending = isKeywordPrefix && !monthMatch && !dayMatch && !yearMatch;
            return {
              month: monthMatch ? monthMatch[1] : null,
              day: dayMatch ? dayMatch[1] : null,
              year: yearMatch ? (yearMatch[1] || yearMatch[0]) : null,
              pending: pending,
              raw: q
            };
          }

          function pillMatches(pill, parsed){
            if (parsed.month === null && parsed.day === null && parsed.year === null) {
              var episodeVal = (pill.getAttribute('data-episode') || '').trim();
              // لو اللي مكتوب في البحث رقم صريح والعرض عنده رقم مكتوب، لازم يتطابقوا بالظبط
              // (عشان البحث بـ "8" ميطلعش عرض "18" أو "28" غلط)
              if (/^\d+$/.test(parsed.raw) && episodeVal !== '') {
                return episodeVal === parsed.raw;
              }
              var hay = ((pill.getAttribute('data-search') || '') + ' ' + episodeVal).trim();
              return hay.indexOf(parsed.raw) !== -1;
            }
            if (parsed.month !== null && pill.getAttribute('data-month') !== String(parseInt(parsed.month, 10))) return false;
            if (parsed.day !== null && pill.getAttribute('data-day') !== String(parseInt(parsed.day, 10))) return false;
            if (parsed.year !== null && pill.getAttribute('data-year') !== String(parseInt(parsed.year, 10))) return false;
            return true;
          }

          function runSearch(rawQ){
            var q = normalizeQuery(rawQ || '');
            if (!q) {
              if (clearBtn) clearBtn.classList.remove('show');
              if (noResults) noResults.style.display = 'none';
              pills.forEach(function(pill){ pill.style.display = ''; });
              showSeasonOnly(activeSeasonKey());
              return;
            }
            if (clearBtn) clearBtn.classList.add('show');
            panels.forEach(function(p){ p.style.display = 'flex'; });
            var parsed = parseQuery(q);
            if (parsed.pending) {
              // لسه بيكمل يكتب الرقم بعد "يوم"/"شهر"/"سنة" - نوريله كل العروض لحد ما يخلص
              pills.forEach(function(pill){ pill.style.display = ''; });
              if (noResults) noResults.style.display = 'none';
              return;
            }
            var visibleCount = 0;
            pills.forEach(function(pill){
              var match = pillMatches(pill, parsed);
              pill.style.display = match ? '' : 'none';
              if (match) visibleCount++;
            });
            panels.forEach(function(p){
              var anyVisible = Array.prototype.some.call(p.querySelectorAll('.ep-pill'), function(pl){ return pl.style.display !== 'none'; });
              if (!anyVisible) p.style.display = 'none';
            });
            if (noResults) noResults.style.display = visibleCount === 0 ? 'block' : 'none';
          }

          if (searchInput) {
            searchInput.addEventListener('input', function(){ runSearch(searchInput.value); });
          }
          if (clearBtn) {
            clearBtn.addEventListener('click', function(){
              searchInput.value = '';
              runSearch('');
              searchInput.focus();
            });
          }
        })();
        
