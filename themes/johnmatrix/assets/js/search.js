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
    searchInput.value = '';
    commandResults.hidden = true;
    searchResults.style.display = '';
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

  // ---- Command palette mode: input starting with ">" ----
  var commandResults = document.getElementById('command-results');
  if (!commandResults || !searchInput) return;

  var COMMANDS = [
    { name: 'cd ~',            desc: 'go home',              url: '/' },
    { name: 'cd bugforge',     desc: '40 challenge writeups', url: '/bugforge/' },
    { name: 'cd ai-research',  desc: 'offensive AI research', url: '/ai-research/' },
    { name: 'cd brain-sharing',desc: 'guides and tooling',    url: '/brain-sharing/' },
    { name: 'whoami',          desc: 'about johnmatrix',      url: '/about/' },
    { name: 'ls',              desc: 'list all sections',     url: null },
    { name: 'help',            desc: 'show commands',         url: null }
  ];

  var cmdSelected = 0;

  function renderCommands(query) {
    var q = query.slice(1).trim().toLowerCase();
    var matches = COMMANDS.filter(function (c) {
      return !q || c.name.toLowerCase().indexOf(q) !== -1;
    });

    if (q === 'ls') {
      commandResults.innerHTML = COMMANDS.filter(function (c) {
        return c.name.indexOf('cd ') === 0 || c.name === 'whoami';
      }).map(function (c) {
        return '<a class="cmd-row" href="' + c.url + '">' +
          '<span class="cmd-name">' + c.url + '</span>' +
          '<span class="cmd-desc">' + c.desc + '</span></a>';
      }).join('');
      return;
    }
    if (q === 'help') {
      commandResults.innerHTML = COMMANDS.map(function (c) {
        return '<div class="cmd-row cmd-row-static">' +
          '<span class="cmd-name">&gt;' + c.name + '</span>' +
          '<span class="cmd-desc">' + c.desc + '</span></div>';
      }).join('');
      return;
    }

    cmdSelected = 0;
    commandResults.innerHTML = matches.map(function (c, i) {
      var inner = '<span class="cmd-name">&gt;' + c.name + '</span>' +
                  '<span class="cmd-desc">' + c.desc + '</span>';
      return c.url
        ? '<a class="cmd-row' + (i === 0 ? ' active' : '') + '" href="' + c.url + '" data-cmd-idx="' + i + '">' + inner + '</a>'
        : '<div class="cmd-row cmd-row-static">' + inner + '</div>';
    }).join('') || '<div class="cmd-row cmd-row-static"><span class="cmd-desc">command not found — try &gt;help</span></div>';
    commandResults.setAttribute('data-matches', matches.filter(function (c) { return c.url; }).map(function (c) { return c.url; }).join('|'));
  }

  searchInput.addEventListener('input', function () {
    var v = searchInput.value;
    var cmdMode = v.charAt(0) === '>';
    commandResults.hidden = !cmdMode;
    searchResults.style.display = cmdMode ? 'none' : '';
    if (cmdMode) renderCommands(v);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (commandResults.hidden) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      var urls = (commandResults.getAttribute('data-matches') || '').split('|').filter(Boolean);
      var target = urls[cmdSelected];
      if (target) window.location.href = target;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var rows = commandResults.querySelectorAll('a.cmd-row');
      if (!rows.length) return;
      cmdSelected = e.key === 'ArrowDown'
        ? Math.min(cmdSelected + 1, rows.length - 1)
        : Math.max(cmdSelected - 1, 0);
      rows.forEach(function (r, i) { r.classList.toggle('active', i === cmdSelected); });
    }
  });
})();
