// johnmatrix main JS - nav, scroll-aware header, reading progress, back-to-top,
// staggered reveal, tag filter, copy buttons, command-palette search trigger
(function () {
  'use strict';

  // ---- Scroll-aware header ----
  var topNav = document.querySelector('.top-nav');
  if (topNav) {
    var lastScroll = 0;
    function onScrollHeader() {
      var s = window.scrollY;
      if (s > 8) topNav.classList.add('scrolled');
      else topNav.classList.remove('scrolled');
      lastScroll = s;
    }
    window.addEventListener('scroll', onScrollHeader, { passive: true });
    onScrollHeader();
  }

  // ---- Hamburger / mobile menu ----
  var hamburger = document.getElementById('top-nav-hamburger');
  var mobileMenu = document.getElementById('mobile-menu');
  if (hamburger && mobileMenu) {
    function closeMobileMenu(refocus) {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      if (refocus) hamburger.focus();
    }
    hamburger.addEventListener('click', function () {
      var open = hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { closeMobileMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && hamburger.classList.contains('open')) closeMobileMenu(true);
    });
  }

  // ---- Platform-aware keyboard hints (Cmd on Apple, Ctrl elsewhere) ----
  var isApple = /Mac|iPhone|iPad|iPod/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
  if (!isApple) {
    document.querySelectorAll('.search-kbd, .t404-kbd').forEach(function (el) {
      el.textContent = el.textContent.replace('Cmd', 'Ctrl');
    });
  }

  // ---- Reading progress bar ----
  var progressBar = document.getElementById('reading-progress');
  if (progressBar) {
    var ticking = false;
    function updateProgress() {
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var scrolled = window.scrollY;
      var progress = docHeight > 0 ? (scrolled / docHeight) * 100 : 0;
      progressBar.style.width = Math.min(100, Math.max(0, progress)) + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(updateProgress); ticking = true; }
    }, { passive: true });
    updateProgress();
  }

  // ---- Back to top ----
  var backBtn = document.getElementById('back-to-top');
  if (backBtn) {
    var btTicking = false;
    function updateVisibility() {
      if (window.scrollY > 500) backBtn.classList.add('visible');
      else backBtn.classList.remove('visible');
      btTicking = false;
    }
    window.addEventListener('scroll', function () {
      if (!btTicking) { requestAnimationFrame(updateVisibility); btTicking = true; }
    }, { passive: true });
    backBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    updateVisibility();
  }

  // ---- Staggered scroll reveal ----
  var revealSel = '.cert-card, .section-li, .recent-card, .bugforge-card, .machine-card, h2, pre, .stats-header, .featured-card, .progress-item';
  var revealEls = document.querySelectorAll(revealSel);
  if (revealEls.length && 'IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) {
      if (!el.classList.contains('reveal')) el.classList.add('reveal');
      obs.observe(el);
    });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  // HR reveal
  var hrs = document.querySelectorAll('hr');
  if (hrs.length && 'IntersectionObserver' in window) {
    var hrObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); hrObs.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    hrs.forEach(function (hr) { hrObs.observe(hr); });
  }

  // ---- Progress bar fill animation ----
  var fills = document.querySelectorAll('.progress-fill');
  if (fills.length && 'IntersectionObserver' in window) {
    var fillObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var target = e.target.getAttribute('data-width');
          if (target) e.target.style.width = target;
          fillObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });
    fills.forEach(function (f) { fillObs.observe(f); });
  }

  // ---- Stat value count-up ----
  var statVals = document.querySelectorAll('.stat-value');
  if (statVals.length && 'IntersectionObserver' in window) {
    var statObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var target = parseInt(el.textContent, 10);
        if (isNaN(target)) return;
        statObs.unobserve(el);
        var current = 0;
        var step = Math.max(1, Math.ceil(target / 22));
        var interval = setInterval(function () {
          current = Math.min(current + step, target);
          el.textContent = String(current);
          if (current >= target) clearInterval(interval);
        }, 28);
      });
    }, { threshold: 0.5 });
    statVals.forEach(function (el) { statObs.observe(el); });
  }

  // ---- Tag filter ----
  var filterBtns = document.querySelectorAll('.tag-filter-btn');
  if (filterBtns.length) {
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tag = btn.getAttribute('data-tag');
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var items = document.querySelectorAll('.section-li, .writeup-card, .bugforge-card');
        items.forEach(function (item) {
          if (tag === 'all') { item.classList.remove('tag-hidden'); return; }
          var itemTags = (item.getAttribute('data-tags') || '').toLowerCase();
          // Whole-tag, -suffix, or plural match (no raw substring: 'source-maps' must not match 'rce')
          var tagHit = itemTags.split(',').some(function (t) {
            return t === tag || t.slice(-(tag.length + 1)) === '-' + tag || t === tag + 's';
          });
          var linkText = (item.querySelector('a') || {}).textContent || '';
          linkText = linkText.toLowerCase();
          if (tagHit || linkText.indexOf(tag) !== -1) {
            item.classList.remove('tag-hidden');
          } else {
            item.classList.add('tag-hidden');
          }
        });
        bfRefreshCount();
      });
    });
  }

  // ---- Code copy buttons (refined) ----
  document.querySelectorAll('pre > code').forEach(function (code) {
    var pre = code.closest('pre');
    if (!pre || pre.querySelector('.clipboard-button')) return;
    var btn = document.createElement('button');
    btn.className = 'clipboard-button';
    btn.textContent = 'Copy';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Copy code');
    pre.appendChild(btn);
    btn.addEventListener('click', function () {
      var text = code.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          btn.classList.add('copied');
          btn.textContent = 'Copied';
          setTimeout(function () {
            btn.classList.remove('copied');
            btn.textContent = 'Copy';
          }, 1400);
        });
      }
    });
  });

  // ---- Command palette: Cmd+K / Ctrl+K to open search ----
  var searchBtn = document.getElementById('top-nav-search-btn');
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchBtn) searchBtn.click();
    }
  });

  // ---- Scrollspy TOC (sticky right-rail) ----
  var tocRail = document.querySelector('.toc-rail');
  if (tocRail && 'IntersectionObserver' in window) {
    var tocLinks = tocRail.querySelectorAll('a[href^="#"]');
    if (tocLinks.length) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            var id = e.target.getAttribute('id');
            tocLinks.forEach(function (l) { l.classList.remove('active'); });
            var activeLink = tocRail.querySelector('a[href="#' + id + '"]');
            if (activeLink) activeLink.classList.add('active');
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      tocLinks.forEach(function (link) {
        var targetId = link.getAttribute('href').slice(1);
        var target = document.getElementById(targetId);
        if (target) spy.observe(target);
      });
    }
  }

  // ---- BugForge search filter ----
  // Count reflects BOTH the search box (.bugforge-hidden) and tag pills (.tag-hidden)
  var bfSearch = document.getElementById('bugforge-search');
  var bfGrid = document.getElementById('bugforge-grid');
  var bfCount = document.getElementById('bugforge-count');
  var bfNoResults = document.getElementById('bugforge-no-results');

  function bfRefreshCount() {
    if (!bfGrid) return;
    var visible = bfGrid.querySelectorAll('.bugforge-card:not(.bugforge-hidden):not(.tag-hidden)').length;
    if (bfCount) bfCount.textContent = visible + (visible === 1 ? ' writeup' : ' writeups');
    if (bfNoResults) bfNoResults.hidden = visible > 0;
  }

  if (bfSearch && bfGrid) {
    var bfCards = bfGrid.querySelectorAll('.bugforge-card');
    bfSearch.addEventListener('input', function () {
      var q = bfSearch.value.trim().toLowerCase();
      bfCards.forEach(function (card) {
        var title = card.getAttribute('data-title') || '';
        var tags = card.getAttribute('data-tags') || '';
        var match = !q || title.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
        card.classList.toggle('bugforge-hidden', !match);
      });
      bfRefreshCount();
    });
  }
})();
