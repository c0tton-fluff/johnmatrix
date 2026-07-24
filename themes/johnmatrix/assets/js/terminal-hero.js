// Terminal hero - systemd-style boot sequence, plays once per session
(function () {
  'use strict';
  var textEl = document.getElementById('terminal-text');
  var logEl = document.getElementById('boot-log');
  if (!textEl) return;

  var BOOT_LINES = [
    '[  OK  ] Reached target Network.',
    '[  OK  ] Mounted /dev/brain.',
    '[  OK  ] Loaded 40 writeups from /var/bugforge.',
    '[  OK  ] Started phantom.service - offensive tooling daemon.',
    '[  OK  ] Reached target Multi-User System.'
  ];

  var COMMAND = 'phantom detect bac --dir engagements/target';
  var SKIP_KEY = 'jm-booted';
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function typeCommand(done) {
    var i = 0;
    (function tick() {
      textEl.textContent = COMMAND.substring(0, i + 1);
      i++;
      if (i < COMMAND.length) {
        setTimeout(tick, 55 + Math.random() * 35);
      } else if (done) {
        done();
      }
    })();
  }

  function showBootLog(lines, instant, done) {
    if (!logEl) { done(); return; }
    if (instant) {
      lines.forEach(function (line) {
        var div = document.createElement('div');
        div.textContent = line;
        logEl.appendChild(div);
      });
      done();
      return;
    }
    var i = 0;
    (function next() {
      if (i >= lines.length) { done(); return; }
      var div = document.createElement('div');
      div.textContent = lines[i];
      logEl.appendChild(div);
      i++;
      setTimeout(next, 180 + Math.random() * 160);
    })();
  }

  function finish() {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) { /* private mode */ }
  }

  // Instant path: reduced motion, or already played this session
  var played = false;
  try { played = sessionStorage.getItem(SKIP_KEY) === '1'; } catch (e) { /* ignore */ }

  if (reducedMotion) {
    // Final state, no log noise
    textEl.textContent = COMMAND;
    return;
  }

  if (played) {
    textEl.textContent = COMMAND;
    return;
  }

  showBootLog(BOOT_LINES, false, function () {
    typeCommand(finish);
  });
})();
