/* ieltswithkhmdv.com – practice tracker. Records time spent and scores in this browser only. */
(function () {
  if (window.__khTrack) return; window.__khTrack = 1;
  var id = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
  if (!id) return;
  var kind = id.charAt(0) === 'l' ? 'l' : 'r';
  function get(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ---- time: counted only while the page is visible and the student is active (or audio is playing) ---- */
  var TICK = 5, lastAct = Date.now();
  ['mousemove', 'keydown', 'scroll', 'click', 'touchstart', 'input'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastAct = Date.now(); }, { capture: true, passive: true });
  });
  function audioPlaying() {
    var a = document.querySelectorAll('audio,video');
    for (var i = 0; i < a.length; i++) if (!a[i].paused && !a[i].ended) return true;
    return false;
  }
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastAct > 180000 && !audioPlaying()) return;
    var t = get('kh-time', { total: 0, tests: {}, days: {} });
    t.total = (t.total || 0) + TICK;
    t.tests = t.tests || {}; t.days = t.days || {};
    t.tests[id] = (t.tests[id] || 0) + TICK;
    var k = dayKey(); t.days[k] = (t.days[k] || 0) + TICK;
    set('kh-time', t);
  }, TICK * 1000);

  /* ---- score: read the result the test shows after the student submits ---- */
  var armed = false, pending = '', saved = '';
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button,a,[role=button],input[type=button],input[type=submit]') : null;
    if (!b) return;
    var tx = (b.innerText || b.value || '') + ' ' + (b.id || '') + ' ' + (b.className || '');
    if (/submit|check|finish|deliver|result|score/i.test(tx)) armed = true;
  }, true);
  function vis(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function ok(c, t) { return !isNaN(c) && !isNaN(t) && t >= 5 && t <= 40 && c >= 0 && c <= t; }
  function detect() {
    var rs = document.getElementById('results-score');
    if (rs && vis(rs)) {
      var c = parseInt(rs.textContent, 10), m = (rs.parentNode.textContent || '').match(/\/\s*(\d{1,2})/);
      if (m && ok(c, +m[1])) return [c, +m[1]];
    }
    var els = document.querySelectorAll('[id*="core"],[class*="core"],[id*="esult"],[class*="esult"],[id*="odal"],[class*="odal"]');
    var re = /(\d{1,2})\s*(?:\/|out of|of)\s*(\d{1,2})(?!\s*answered)/i;
    for (var i = 0; i < els.length; i++) {
      if (!vis(els[i])) continue;
      var mm = (els[i].innerText || '').slice(0, 600).match(re);
      if (mm && ok(+mm[1], +mm[2])) return [+mm[1], +mm[2]];
    }
    return null;
  }
  setInterval(function () {
    if (!armed) {
      var rm = document.getElementById('results-modal');
      if (rm && vis(rm) && !rm.classList.contains('hidden')) armed = true; else return;
    }
    var r = detect(); if (!r) return;
    var sig = r[0] + '/' + r[1];
    if (sig !== pending) { pending = sig; return; }   /* must be stable for two checks */
    if (sig === saved) return; saved = sig;
    var now = Date.now();
    var res = get('kh-results', {}), cur = res[id] || { k: kind, n: 0 };
    cur.k = kind; cur.n = (cur.n || 0) + 1; cur.last = { c: r[0], t: r[1], at: now };
    if (!cur.best || r[0] / r[1] > cur.best.c / cur.best.t) cur.best = { c: r[0], t: r[1], at: now };
    res[id] = cur; set('kh-results', res);
    var hist = get('kh-history', []); hist.push({ id: id, k: kind, c: r[0], t: r[1], at: now });
    if (hist.length > 300) hist = hist.slice(-300);
    set('kh-history', hist);
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ kh: 'result', id: id, c: r[0], t: r[1] }, '*'); } catch (e) {}
  }, 1500);
})();
