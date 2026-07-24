// Hidden CLI easter egg - type "johnmatrix" anywhere to open a root shell
(function () {
  'use strict';

  var TRIGGER = 'johnmatrix';
  var buffer = '';

  var RESPONSES = {
    help: 'available: whoami · certs · ls · hack · sudo · clear · exit',
    whoami: 'johnmatrix - purple teamer. 9x GIAC. SANS BACS 2026. breaking things, sharing everything.',
    certs: 'GFACT GISF GSEC GCIH GPYC GPEN GCIA GCFE GCFA  [9/9 complete]',
    ls: 'bugforge/  ai-research/  brain-sharing/  about/',
    sudo: 'johnmatrix is not in the sudoers file. This incident will be reported. ...just kidding.'
  };

  var overlay, termBody, termInput;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'cli-overlay';
    overlay.setAttribute('hidden', 'hidden');
    overlay.innerHTML =
      '<div id="cli-window">' +
        '<div id="cli-bar">' +
          '<span class="cli-dot" style="background:#e74c3c"></span>' +
          '<span class="cli-dot" style="background:#f4d03f"></span>' +
          '<span class="cli-dot" style="background:#2ecc71"></span>' +
          '<span class="cli-title">root@johnmatrix: ~</span>' +
        '</div>' +
        '<div id="cli-body"></div>' +
        '<div id="cli-input-row">' +
          '<span class="cli-prompt">#</span>' +
          '<input id="cli-input" type="text" autocomplete="off" spellcheck="false" aria-label="Terminal input">' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    termBody = overlay.querySelector('#cli-body');
    termInput = overlay.querySelector('#cli-input');

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeCli();
    });
    termInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runCommand(termInput.value);
      if (e.key === 'Escape') closeCli();
    });
    print('johnmatrix shell v2.6 - type "help"');
  }

  function print(text, cls) {
    var div = document.createElement('div');
    div.textContent = text;
    if (cls) div.className = cls;
    termBody.appendChild(div);
    termBody.scrollTop = termBody.scrollHeight;
  }

  function runCommand(raw) {
    var cmd = raw.trim().toLowerCase();
    print('# ' + raw, 'cli-echo');
    termInput.value = '';
    if (!cmd) return;
    if (cmd === 'exit' || cmd === 'quit' || cmd === 'logout') { closeCli(); return; }
    if (cmd === 'clear') { termBody.innerHTML = ''; return; }
    if (cmd === 'hack') {
      var steps = ['scanning target...', 'enumerating endpoints...', 'testing access controls...', 'flag.txt captured. nicely done.'];
      steps.forEach(function (s, i) {
        setTimeout(function () { print(s, 'cli-ok'); }, 350 * (i + 1));
      });
      return;
    }
    if (RESPONSES[cmd]) { print(RESPONSES[cmd]); return; }
    print('bash: ' + cmd + ': command not found', 'cli-err');
  }

  function openCli() {
    if (!overlay) buildOverlay();
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    termInput.focus();
  }

  function closeCli() {
    if (!overlay) return;
    overlay.setAttribute('hidden', 'hidden');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && !overlay.hasAttribute('hidden')) { closeCli(); return; }
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key && e.key.length === 1) {
      buffer = (buffer + e.key.toLowerCase()).slice(-TRIGGER.length);
      if (buffer === TRIGGER) { buffer = ''; openCli(); }
    }
  });
})();
