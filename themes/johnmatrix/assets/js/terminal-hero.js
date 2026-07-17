// Terminal hero typewriter - only loaded on home page
(function () {
  'use strict';
  var el = document.getElementById('terminal-text');
  if (!el) return;

  var commands = [
    'phantom detect bac --dir engagements/target',
    'nmap -sC -sV 10.10.10.x',
    'burp-go send POST /api/auth',
    'sqlmap --batch --dbs'
  ];

  var cmdIdx = 0;
  var charIdx = 0;
  var deleting = false;
  var timer = null;

  function tick() {
    var current = commands[cmdIdx];
    if (!deleting) {
      el.textContent = current.substring(0, charIdx + 1);
      charIdx++;
      if (charIdx >= current.length) {
        deleting = true;
        timer = setTimeout(tick, 2500);
        return;
      }
      timer = setTimeout(tick, 55 + Math.random() * 35);
    } else {
      el.textContent = current.substring(0, charIdx);
      charIdx--;
      if (charIdx < 0) {
        deleting = false;
        charIdx = 0;
        cmdIdx = (cmdIdx + 1) % commands.length;
        timer = setTimeout(tick, 500);
        return;
      }
      timer = setTimeout(tick, 25);
    }
  }

  // Respect reduced motion - show static first command
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = commands[0];
    return;
  }

  tick();
})();
