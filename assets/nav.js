(function(){
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');
  if(!toggle || !menu) return;

  var homeParent = toggle.parentElement; // the .nav div the menu originally lives in

  function isMobile(){ return window.innerWidth <= 860; }

  function closeMenu(){
    menu.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-locked');
    if(homeParent && menu.parentNode !== homeParent){
      homeParent.appendChild(menu);
      menu.style.top = '';
    }
  }
  function openMenu(){
    if(isMobile()){
      // Move the menu out to <body> so its position:fixed is relative to the
      // viewport, not the header (backdrop-filter on <header> would otherwise
      // make the header the containing block for fixed descendants).
      document.body.appendChild(menu);
      var header = document.querySelector('header');
      if(header){ menu.style.top = header.getBoundingClientRect().bottom + 'px'; }
    }
    menu.classList.add('nav-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-locked');
  }

  toggle.addEventListener('click', function(e){
    e.stopPropagation();
    if(menu.classList.contains('nav-open')){ closeMenu(); } else { openMenu(); }
  });

  // Close when a plain nav link (not the federations parent link) is tapped
  menu.querySelectorAll('a.navlink, a.drop-item').forEach(function(a){
    a.addEventListener('click', function(){ closeMenu(); });
  });

  // Close on outside click
  document.addEventListener('click', function(e){
    if(!menu.classList.contains('nav-open')) return;
    if(menu.contains(e.target) || toggle.contains(e.target)) return;
    closeMenu();
  });

  // Close on Escape
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeMenu();
  });

  // Reposition or close on resize
  window.addEventListener('resize', function(){
    if(!isMobile()){ closeMenu(); return; }
    if(menu.classList.contains('nav-open')){
      var header = document.querySelector('header');
      if(header){ menu.style.top = header.getBoundingClientRect().bottom + 'px'; }
    }
  });
})();
