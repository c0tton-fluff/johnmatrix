// Pagefind search - lazy-loaded only when search is opened
(function () {
  'use strict';

  var searchBtn = document.getElementById('top-nav-search-btn');
  var searchContainer = document.getElementById('search-container');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');
  var searchClose = document.getElementById('search-close');

  if (!searchBtn || !searchContainer) return;

  var pagefindLoaded = false;
  var pagefindUI = null;
  var searchInstance = null;

  function openSearch() {
    searchContainer.removeAttribute('hidden');
    searchContainer.setAttribute('aria-hidden', 'false');
    searchContainer.classList.add('active');
    if (searchInput) searchInput.focus();
    document.body.style.overflow = 'hidden';
    if (!pagefindLoaded) loadPagefind();
  }

  function closeSearch() {
    searchContainer.classList.remove('active');
    searchContainer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(function () { searchContainer.setAttribute('hidden', 'hidden'); }, 200);
  }

  function loadPagefind() {
    pagefindLoaded = true;
    import('/pagefind/pagefind-ui.js').then(function (mod) {
      pagefindUI = mod.PagefindUI;
      searchInstance = new pagefindUI({
        element: '#search-results',
        showImages: false,
        showSubResults: true,
        resetStyles: false,
        excerptLength: 14
      });
    }).catch(function (err) {
      if (searchResults) searchResults.innerHTML = '<div style="color:rgba(232,230,227,0.5);padding:1rem;font-family:JetBrains Mono,monospace;font-size:0.8rem">Search index not available (built at deploy time).</div>';
      console.warn('Pagefind load failed:', err);
    });
  }

  searchBtn.addEventListener('click', openSearch);
  if (searchClose) searchClose.addEventListener('click', closeSearch);
  searchContainer.addEventListener('click', function (e) {
    if (e.target === searchContainer) closeSearch();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSearch();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      openSearch();
    }
  });
})();
