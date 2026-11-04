// =====================================================================
//  IELTS with KHMDV — main app
// =====================================================================
import { CONFIG } from './config.js';
import { createBackend } from './backend.js';
import { md, renderGroup, allNumbers, groupNumbers, GROUP_TYPES, esc, rangeLabel } from './render.js';
import { parseKey, keyToText, score } from './scoring.js';

const api = createBackend();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
let ME = null;
let CLEANUP = [];
let GUARD = null;          // function returning true if it's OK to leave the page
let SKIP_GUARD = false;
// started mocks (content from start-mock) — kept for this browser tab so a refresh doesn't ask for the password again
const SESSION = { mocks: new Proxy((() => { try { return JSON.parse(sessionStorage.getItem('khmdv-mocks') || '{}'); } catch { return {}; } })(), {
  set(o, k, v) { o[k] = v; try { sessionStorage.setItem('khmdv-mocks', JSON.stringify(o)); } catch {} return true; },
}) };
const persistMocks = () => { try { sessionStorage.setItem('khmdv-mocks', JSON.stringify(SESSION.mocks)); } catch {} };

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
const TG_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.6 8.9 19.4c.4 0 .58-.17.8-.38l1.92-1.84 3.98 2.92c.73.4 1.25.19 1.45-.67l2.62-12.3c.24-1.08-.38-1.5-1.1-1.24L3.2 9.9c-1.05.4-1.04 1-.18 1.27l3.94 1.23 9.15-5.77c.43-.28.82-.13.5.16"/></svg>`;
const tgPill = () => `<a class="tg-pill" href="${CONFIG.TELEGRAM_URL}" target="_blank" rel="noopener">${TG_SVG}<span>${esc(CONFIG.TELEGRAM_HANDLE)}</span></a>`;

function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } }

function toast(msg, type = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function modal({ title = '', body = '', actions = [], wide = false, dismissable = true }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3>${dismissable ? '<button class="btn ghost icon-btn" data-x aria-label="Close">✕</button>' : ''}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`).join('')}</div></div>`;
    const close = v => { back.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape' && dismissable) close(null); };
    back.addEventListener('click', e => {
      if (e.target === back && dismissable) return close(null);
      if (e.target.closest('[data-x]')) return close(null);
      const b = e.target.closest('[data-i]');
      if (b) { const a = actions[+b.dataset.i]; close(a.value !== undefined ? a.value : (a.get ? a.get(back) : true)); }
    });
    document.addEventListener('keydown', key);
    root.appendChild(back);
    const f = back.querySelector('input,textarea'); if (f) setTimeout(() => f.focus(), 30);
  });
}
const confirmBox = (title, text, ok = 'OK', cls = 'primary') =>
  modal({ title, body: `<p style="margin:0">${text}</p>`, actions: [{ label: 'Cancel', value: false }, { label: ok, cls, value: true }] });

const fmt = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { timeZone: CONFIG.TIMEZONE, ...opts }); } catch { return new Date(iso).toLocaleString(); }
};
const fmtDay = iso => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (d) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const band = b => (b === null || b === undefined || b === '') ? '—' : Number(b).toFixed(1);
const kindBadge = k => `<span class="badge ${k}">${k === 'listening' ? 'Listening' : k === 'mock' ? 'Full mock' : 'Reading'}</span>`;
function fmtAns(s) {
  s = String(s ?? '');
  if (/^(true|false|not given|yes|no|[a-h])$/i.test(s.trim())) return s.toUpperCase();
  return s;
}
function every(ms, fn) { const t = setInterval(fn, ms); CLEANUP.push(() => clearInterval(t)); return t; }
function mockState(m) {
  const now = Date.now();
  if (now < Date.parse(m.starts_at)) return 'upcoming';
  if (now > Date.parse(m.ends_at)) return 'closed';
  return 'live';
}
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store('khmdv-theme', root.dataset.theme);
  try { localStorage.setItem('khmdv-theme', root.dataset.theme); } catch {}
}
const themeBtn = () => `<button class="btn ghost icon-btn" data-theme-toggle title="Dark / light mode" aria-label="Toggle dark mode"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;
document.addEventListener('click', e => { if (e.target.closest('[data-theme-toggle]')) toggleTheme(); });

// ---------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------
function shell(inner, active = '') {
  const initials = ((ME?.full_name || ME?.email || '?').match(/\p{L}+/gu) || ['?']).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `${api.demo ? `<div class="demo-banner">Demo mode — data is saved only in this browser. Add your Supabase keys in <code>js/config.js</code> to go live.</div>` : ''}
  <header class="topbar"><div class="topbar-in">
    <a class="brand" href="#/"><span class="brand-logo">K</span><span>${esc(CONFIG.SITE_NAME)}<small>Reading · Listening · Mocks</small></span></a>
    <nav class="nav">
      <a href="#/" class="${active === 'home' ? 'active' : ''}">Dashboard</a>
      <a href="#/library" class="${active === 'library' ? 'active' : ''}">Library</a>
      <a href="#/results" class="${active === 'results' ? 'active' : ''}">My results</a>
      ${ME?.is_admin ? `<a href="#/admin" class="${active === 'admin' ? 'active' : ''}">Admin</a>` : ''}
    </nav>
    <div class="spacer"></div>
    ${tgPill()}
    ${themeBtn()}
    <a class="user-chip" href="#/account" title="Account"><span class="avatar">${esc(initials)}</span><span class="uname">${esc(ME?.full_name || ME?.email || '')}</span></a>
  </div></header>
  <main>${inner}</main>`;
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
const routes = [
  [/^#\/login$/, pageLogin, { public: true }],
  [/^#?\/?$/, pageDashboard],
  [/^#\/library$/, pageLibrary],
  [/^#\/open\/([^/]+)$/, pageOpen],
  [/^#\/practice\/([^/]+)$/, pagePractice],
  [/^#\/review\/([^/]+)$/, pageReview],
  [/^#\/mock\/([^/]+)$/, pageMockLobby],
  [/^#\/mock\/([^/]+)\/([^/]+)$/, pageMockSection],
  [/^#\/results$/, pageResults],
  [/^#\/account$/, pageAccount],
  [/^#\/admin\/?$/, adminTests, { admin: true }],
  [/^#\/admin\/test\/([^/?]+)(?:\?(.*))?$/, adminTestEditor, { admin: true }],
  [/^#\/admin\/preview$/, adminPreview, { admin: true }],
  [/^#\/admin\/mocks$/, adminMocks, { admin: true }],
  [/^#\/admin\/mock\/([^/]+)\/results$/, adminMockResults, { admin: true }],
  [/^#\/admin\/mock\/([^/]+)$/, adminMockEditor, { admin: true }],
  [/^#\/admin\/students$/, adminStudents, { admin: true }],
  [/^#\/admin\/library$/, adminLibrary, { admin: true }],
];

let lastHash = location.hash;
window.addEventListener('hashchange', async () => {
  if (SKIP_GUARD && location.hash === lastHash) { SKIP_GUARD = false; return; }   // our own revert
  const msg = !SKIP_GUARD && GUARD ? GUARD() : null;
  if (msg) {
    const target = location.hash;
    SKIP_GUARD = true; location.hash = lastHash;
    if (await confirmBox('Leave this page?', msg, 'Leave', 'danger')) { GUARD = null; go(target, true); }
    return;
  }
  SKIP_GUARD = false;
  route();
});
function go(hash, force = false) { if (force) SKIP_GUARD = true; if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  lastHash = location.hash; SKIP_GUARD = false;
  CLEANUP.forEach(f => { try { f(); } catch {} }); CLEANUP = [];
  GUARD = null; window.onbeforeunload = null;
  $('#modal-root').innerHTML = '';
  const hash = location.hash || '#/';
  try {
    ME = await api.profile();
  } catch (e) { ME = null; }
  for (const [re, fn, opt = {}] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    if (!opt.public && !ME) return go('#/login');
    if (opt.public && ME) return go('#/');
    if (opt.admin && !ME?.is_admin) return go('#/');
    try { await fn(...m.slice(1)); }
    catch (e) {
      console.error(e);
      app.innerHTML = shell(`<div class="page narrow"><div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message || e)}</p><a class="btn" href="#/">Back to dashboard</a></div></div>`);
    }
    window.scrollTo(0, 0);
    return;
  }
  go('#/');
}

// =====================================================================
//  AUTH
// =====================================================================
let LOGIN_STATS = [];
async function pageLogin() {
  let mode = 'in';
  if (!LOGIN_STATS.length) {
    const cat = await fetch('library/catalog.json').then(r => r.ok ? r.json() : []).catch(() => []);
    const c = f => cat.filter(f).length;
    LOGIN_STATS = [[c(i => i.kind === 'reading'), 'Reading passages and tests'], [c(i => i.kind === 'listening'), 'Listening tests'], [c(i => i.kind === 'mock'), 'Full mock exams'], ['52', 'Sunday mocks a year']].filter(x => x[0]);
  }
  const draw = () => {
    app.innerHTML = `<div class="auth-wrap">
      <aside class="auth-side">
        <div class="brand"><span class="brand-logo">K</span><span>${esc(CONFIG.SITE_NAME)}<small>Reading · Listening · Mocks</small></span></div>
        <div><div class="eyebrow" style="color:var(--saffron)">IELTS test centre</div><h1>Practise daily. <em>Prove it</em> on Sunday.</h1>
        <p>Real-format Reading and Listening tests with instant band scores, plus a full mock exam every Sunday.</p>
        <ul>${LOGIN_STATS.map(([v, l]) => `<li><b>${v}</b>${l}</li>`).join('')}</ul></div>
        <div>${tgPill()}</div>
      </aside>
      <section class="auth-main"><div class="auth-box">
        <h2>${mode === 'up' ? 'Create your account' : 'Welcome back'}</h2><p class="muted" style="margin:0">${mode === 'up' ? 'It takes less than a minute.' : 'Log in to continue practising.'}</p>
        <div class="tabs"><button class="${mode === 'in' ? 'on' : ''}" data-m="in">Log in</button><button class="${mode === 'up' ? 'on' : ''}" data-m="up">Create account</button></div>
        ${api.demo ? `<div class="demo-hint">Demo accounts — teacher: <code>teacher@demo.uz</code> · student: <code>student@demo.uz</code> · password <code>demo123</code></div>` : ''}
        <form id="authf">
          ${mode === 'up' ? `<label class="field"><span>Full name</span><input name="full_name" required autocomplete="name" placeholder="e.g. Aziza Karimova"></label>
          <label class="field"><span>Telegram username</span><input name="telegram" placeholder="@username" autocomplete="off"></label>` : ''}
          <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
          <label class="field"><span>Password</span><input name="password" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>
          <button class="btn primary lg block" type="submit">${mode === 'up' ? 'Create account' : 'Log in'}</button>
          ${mode === 'in' ? `<p class="small" style="text-align:center"><a href="#" id="forgot">Forgot password?</a></p>` : ''}
        </form>
      </div></section></div>`;
    $$('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    $('#forgot')?.addEventListener('click', async e => {
      e.preventDefault();
      const email = $('#authf [name=email]').value.trim();
      if (!email) return toast('Type your email first, then click “Forgot password”.', 'err');
      try { await api.resetPassword(email); toast('Check your email for a reset link.', 'ok', 5000); } catch (er) { toast(er.message, 'err'); }
    });
    $('#authf').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        if (mode === 'in') await api.signIn(f.email.trim(), f.password);
        else {
          const tg = (f.telegram || '').trim();
          const r = await api.signUp({ email: f.email.trim(), password: f.password, full_name: f.full_name.trim(), telegram: tg && !tg.startsWith('@') ? '@' + tg : tg });
          if (r.needsConfirm) { toast('Account created! Check your email to confirm, then log in.', 'ok', 7000); mode = 'in'; draw(); return; }
        }
        go('#/');
      } catch (er) { toast(er.message, 'err'); btn.disabled = false; }
    };
  };
  draw();
}

async function pageAccount() {
  app.innerHTML = shell(`<div class="page narrow">
    <div class="page-head"><div><h1>My account</h1><p>${esc(ME.email || '')}</p></div></div>
    <form class="card" id="accf">
      <label class="field"><span>Full name (shown to your teacher)</span><input name="full_name" value="${esc(ME.full_name)}" required></label>
      <label class="field"><span>Telegram username</span><input name="telegram" value="${esc(ME.telegram)}" placeholder="@username"></label>
      <div class="row between"><button class="btn primary">Save</button><button type="button" class="btn danger" id="logout">Log out</button></div>
    </form>
    ${api.demo ? `<div class="card"><h2>Demo data</h2><p class="muted">Reset the demo to its original sample tests and accounts.</p><button class="btn" id="resetdemo">Reset demo</button></div>` : ''}
  </div>`);
  $('#accf').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api.updateProfile({ full_name: f.full_name.trim(), telegram: f.telegram.trim() }); toast('Saved', 'ok'); route(); } catch (er) { toast(er.message, 'err'); }
  };
  $('#logout').onclick = async () => { await api.signOut(); go('#/login'); };
  $('#resetdemo')?.addEventListener('click', async () => {
    if (await confirmBox('Reset demo?', 'All demo tests, mocks and results will go back to the sample data.', 'Reset', 'danger')) { api.resetDemo(); go('#/login'); }
  });
}

// =====================================================================
//  LIBRARY (all tests: built-in HTML files + uploads + website-built)
// =====================================================================
const ICON = {
  reading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></svg>',
  listening: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  mock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const KIND_LABEL = { reading: 'Reading', listening: 'Listening', mock: 'Full mock' };
const LEVELS = {
  reading: ['Passage 1', 'Passage 2', 'Passage 3', 'Full test', 'Collection', 'Website test'],
  listening: ['Part 1', 'Part 2', 'Part 3', 'Part 4', 'Full test', 'Website test'],
  mock: ['Full mock'],
};
let CATALOG = null;
async function loadLibrary() {
  if (!CATALOG) CATALOG = await fetch('library/catalog.json').then(r => r.ok ? r.json() : []).catch(() => []);
  const [ups, native] = await Promise.all([api.listLibraryUploads().catch(() => []), api.listPracticeTests().catch(() => [])]);
  return [
    ...ups.map(u => ({ ...u, src: 'upload', added: (u.created_at || '').slice(0, 10) })),
    ...native.map(t => ({ id: t.id, title: t.title, kind: t.kind, level: 'Website test', added: (t.created_at || '').slice(0, 10), src: 'native', q: t.question_count, min: t.duration_min })),
    ...CATALOG.map(c => ({ ...c, src: 'static' })),
  ];
}
const itemHref = it => it.src === 'native' ? `#/practice/${it.id}` : `#/open/${encodeURIComponent(it.id)}`;
const seenMap = () => store('khmdv-seen') || {};
const isNew = it => it.added && (Date.now() - Date.parse(it.added)) < 14 * 864e5;
function testCard(it, seen = seenMap(), best = {}) {
  const lvl = it.level || KIND_LABEL[it.kind];
  return `<a class="test-card ${it.kind}" href="${itemHref(it)}">
    <div class="tc-top"><div class="tc-level"><small>${KIND_LABEL[it.kind] || ''}</small>${esc(lvl)}</div><span class="tc-icon">${ICON[it.kind] || ICON.reading}</span></div>
    <div class="tc-body"><h3>${esc(it.title)}</h3>
      <div class="tc-meta">${best[it.id] !== undefined ? `<span class="best">Best ${band(best[it.id])}</span>` : ''}${it.q ? `<span>${it.q} questions</span>` : ''}${seen[it.id] ? '<span class="seen">✓ Opened</span>' : isNew(it) ? '<span class="new">New</span>' : ''}</div></div></a>`;
}
let LIB_PRESET = null;

async function pageLibrary() {
  const [items, atts] = await Promise.all([loadLibrary(), api.myAttempts().catch(() => [])]);
  const best = {};
  atts.filter(a => !a.mock_id).forEach(a => { if (best[a.test_id] === undefined || a.band > best[a.test_id]) best[a.test_id] = a.band; });
  const saved = LIB_PRESET || store('khmdv-lib') || {};
  LIB_PRESET = null;
  let kind = saved.kind || 'all', level = saved.level || '', sort = saved.sort || 'new', q = '', limit = 48;
  const seen = seenMap();
  const count = k => items.filter(i => k === 'all' || i.kind === k).length;
  const draw = () => {
    store('khmdv-lib', { kind, level, sort });
    let list = items.filter(i => (kind === 'all' || i.kind === kind) && (!level || i.level === level) && (!q || i.title.toLowerCase().includes(q)));
    list.sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => (b.added || '').localeCompare(a.added || '') || a.title.localeCompare(b.title));
    const levels = kind === 'all' ? [] : LEVELS[kind].filter(l => items.some(i => i.kind === kind && i.level === l));
    app.innerHTML = shell(`<div class="page">
      <div class="page-head"><div><div class="eyebrow">@ieltswithkhmdv test library</div><h1>Every test, in one place</h1><p>${items.length} Reading and Listening tests. Open any of them as many times as you like.</p></div></div>
      <div class="filters">
        <div class="seg">${['all', 'reading', 'listening', 'mock'].map(k => `<button data-k="${k}" class="${kind === k ? 'on' : ''}">${k === 'all' ? 'All' : KIND_LABEL[k] + (k === 'mock' ? 's' : '')}<span class="n">${count(k)}</span></button>`).join('')}</div>
        <label class="search">${ICON.search}<input class="input" id="lsearch" placeholder="Search by title…" value="${esc(q)}" aria-label="Search tests"></label>
        <div class="seg"><button data-s="new" class="${sort === 'new' ? 'on' : ''}">Newest</button><button data-s="az" class="${sort === 'az' ? 'on' : ''}">A–Z</button></div>
      </div>
      ${levels.length > 1 ? `<div class="chips-row" style="margin-bottom:18px"><button class="fchip ${!level ? 'on' : ''}" data-l="">All levels</button>${levels.map(l => `<button class="fchip ${level === l ? 'on' : ''}" data-l="${l}">${l} · ${items.filter(i => i.kind === kind && i.level === l).length}</button>`).join('')}</div>` : ''}
      <p class="muted small" style="margin:0 0 12px">${list.length} test${list.length === 1 ? '' : 's'}</p>
      ${list.length ? `<div class="tests-grid">${list.slice(0, limit).map(i => testCard(i, seen, best)).join('')}</div>
        ${list.length > limit ? `<div class="more-row"><button class="btn lg" id="more">Show more (${list.length - limit} left)</button></div>` : ''}` : `<div class="empty">No tests match. Try another search.</div>`}
    </div>`, 'library');
    $$('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; level = ''; limit = 48; draw(); });
    $$('[data-l]').forEach(b => b.onclick = () => { level = b.dataset.l; limit = 48; draw(); });
    $$('[data-s]').forEach(b => b.onclick = () => { sort = b.dataset.s; draw(); });
    $('#more')?.addEventListener('click', () => { limit += 48; const y = scrollY; draw(); scrollTo(0, y); });
    const s = $('#lsearch'); s.oninput = () => { q = s.value.trim().toLowerCase(); limit = 48; const pos = s.selectionStart; draw(); const n = $('#lsearch'); n.focus(); n.setSelectionRange(pos, pos); };
  };
  draw();
}

async function pageOpen(id) {
  id = decodeURIComponent(id);
  const items = await loadLibrary();
  const it = items.find(i => i.id === id);
  if (!it) throw new Error('This test could not be found.');
  const seen = seenMap(); seen[id] = Date.now(); store('khmdv-seen', seen);
  app.innerHTML = `<div class="viewer">
    <header class="p-head">
      <a class="btn ghost sm" href="#/library" id="vback">← Library</a>
      <div class="p-title">${esc(it.title)}<small>${esc(it.level || KIND_LABEL[it.kind])}</small></div>
      ${it.src === 'static' ? `<a class="btn ghost sm" href="${esc(it.file)}" target="_blank" rel="noopener">Open full screen ↗</a>` : ''}
      ${themeBtn()}
    </header>
    <div id="vbody" class="loading">Opening test…</div></div>`;
  const body = $('#vbody');
  const frame = document.createElement('iframe');
  frame.title = it.title;
  frame.setAttribute('allow', 'autoplay; fullscreen');
  if (it.src === 'static') frame.src = it.file;
  else {
    try { frame.srcdoc = await api.libraryHtml(it); }
    catch (e) { body.textContent = 'Could not open this test: ' + e.message; return; }
  }
  body.className = ''; body.innerHTML = ''; body.appendChild(frame);
}

// =====================================================================
//  STUDENT DASHBOARD
// =====================================================================
async function pageDashboard() {
  const [mocks, items, atts] = await Promise.all([api.listMocks(), loadLibrary(), api.myAttempts().catch(() => [])]);
  const active = mocks.filter(m => mockState(m) !== 'closed').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const progress = {};
  await Promise.all(active.filter(m => mockState(m) === 'live').map(async m => { progress[m.id] = await api.myMockProgress(m.id).catch(() => []); }));
  const best = {};
  atts.filter(a => !a.mock_id).forEach(a => { if (best[a.test_id] === undefined || a.band > best[a.test_id]) best[a.test_id] = a.band; });
  const seen = seenMap();
  const n = f => items.filter(f).length;
  const stats = [
    ['r', n(i => i.kind === 'reading' && /^Passage/.test(i.level)), 'Reading passages', { kind: 'reading' }],
    ['p', n(i => i.kind === 'reading' && i.level === 'Full test'), 'Full Reading tests', { kind: 'reading', level: 'Full test' }],
    ['l', n(i => i.kind === 'listening'), 'Listening tests', { kind: 'listening' }],
    ['m', n(i => i.kind === 'mock'), 'Full mock exams', { kind: 'mock' }],
  ];
  const recentOpened = items.filter(i => seen[i.id]).sort((a, b) => seen[b.id] - seen[a.id]).slice(0, 4);
  const newest = items.slice().sort((a, b) => (b.added || '').localeCompare(a.added || '')).slice(0, 8);

  const mockCard = m => {
    const st = mockState(m);
    const prog = progress[m.id] || [];
    const doneAll = m.test_ids.length && m.test_ids.every(id => prog.find(p => p.test_id === id && p.status === 'submitted'));
    const started = prog.some(p => p.status === 'submitted');
    let right = '';
    if (st === 'upcoming') right = `<div><div class="kicker">Opens in</div><div class="count" data-count="${m.starts_at}">${dur((Date.parse(m.starts_at) - Date.now()) / 1000)}</div></div>`;
    else if (doneAll) right = `<div><div class="count">✓ Submitted</div><div class="meta">${m.results_released ? '<a href="#/results" style="color:#fff;text-decoration:underline">See your result</a>' : 'Your teacher will announce the results'}</div></div>`;
    else right = `<form class="pw-row" data-mock="${m.id}">
        <input class="input" name="pw" type="password" placeholder="Mock password" autocomplete="off" required aria-label="Mock password">
        <button class="btn gold lg">${started ? 'Continue' : 'Start mock'} →</button></form>`;
    return `<div class="mock-hero">
      <div><div class="kicker">${st === 'live' ? '<span class="badge live">● Live now</span>' : 'Next Sunday mock'}</div>
        <h2>${esc(m.title)}</h2>
        <div class="meta">${fmtDay(m.starts_at)} → ${new Date(m.ends_at) - new Date(m.starts_at) < 864e5 ? fmt(m.ends_at, { hour: '2-digit', minute: '2-digit' }) : fmtDay(m.ends_at)} · ${m.test_ids.length} section${m.test_ids.length === 1 ? '' : 's'}</div></div>
      ${right}</div>`;
  };
  const first = (ME.full_name || '').split(/\s+/)[0] || 'there';
  const recent = atts.slice(0, 5);
  app.innerHTML = shell(`
    <section class="welcome"><div class="welcome-in">
      <div><div class="eyebrow">Reading & Listening · @ieltswithkhmdv</div>
        <h1>Salom, <em>${esc(first)}</em>.</h1>
        <p>Practise a passage every day, then sit the full mock exam on Sunday under real exam conditions.</p></div>
      <div class="stats">${stats.map(([c, v, l, preset], i) => `<a class="stat-tile ${c}" href="#/library" data-preset="${i}"><b>${v}</b><span>${l}</span></a>`).join('')}</div>
    </div></section>
    <div class="page">
      ${active.length ? active.map(mockCard).join('') : `<div class="mock-hero closed"><div><div class="kicker">Sunday mock</div><h2>No mock scheduled yet</h2><div class="meta muted">The next mock test will be announced in the channel.</div></div><div>${tgPill()}</div></div>`}
      ${recentOpened.length ? `<div class="section-title"><h2>Continue practising</h2></div><div class="tests-grid">${recentOpened.map(i => testCard(i, seen, best)).join('')}</div>` : ''}
      <div class="section-title"><h2>Newest tests</h2><a href="#/library">Browse all ${items.length} →</a></div>
      <div class="tests-grid">${newest.map(i => testCard(i, seen, best)).join('')}</div>
      ${recent.length ? `<div class="section-title"><h2>Recent results</h2><a href="#/results">All results →</a></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="data"><tbody>
        ${recent.map(a => `<tr><td>${kindBadge(a.test_kind)}</td><td><b>${esc(a.test_title)}</b>${a.mock_id ? ' <span class="badge mock">Mock</span>' : ''}</td><td class="nums">${a.correct}/${a.total}</td><td class="band-big">${band(a.band)}</td><td class="muted small">${fmt(a.submitted_at)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    </div>`, 'home');

  $$('[data-preset]').forEach(a => a.onclick = () => { LIB_PRESET = { ...stats[+a.dataset.preset][3], sort: 'new' }; });
  $$('form[data-mock]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const data = await api.startMock(f.dataset.mock, f.pw.value);
      SESSION.mocks[f.dataset.mock] = { ...data, offset: Date.parse(data.server_now) - Date.now() };
      go('#/mock/' + f.dataset.mock);
    } catch (er) { toast(er.message, 'err'); btn.disabled = false; }
  });
  every(1000, () => {
    $$('[data-count]').forEach(el => {
      const left = (Date.parse(el.dataset.count) - Date.now()) / 1000;
      if (left <= 0) route(); else el.textContent = dur(left);
    });
  });
}

// =====================================================================
//  RESULTS
// =====================================================================
async function pageResults() {
  const atts = await api.myAttempts();
  const practice = atts.filter(a => !a.mock_id), mockAtts = atts.filter(a => a.mock_id);
  const avg = arr => arr.length ? (arr.reduce((s, a) => s + Number(a.band || 0), 0) / arr.length) : null;
  const r = practice.filter(a => a.test_kind === 'reading'), l = practice.filter(a => a.test_kind === 'listening');
  const byMock = {};
  mockAtts.forEach(a => (byMock[a.mock_id] ||= { title: a.mocks?.title || 'Mock', rows: [] }).rows.push(a));
  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><h1>My results</h1><p>Practice tests show your score straight away. Mock results appear here once your teacher releases them.</p></div></div>
    <div class="stat-row">
      <div class="stat"><b>${atts.length}</b><span>tests completed</span></div>
      <div class="stat"><b>${avg(r) === null ? '—' : avg(r).toFixed(1)}</b><span>average Reading band</span></div>
      <div class="stat"><b>${avg(l) === null ? '—' : avg(l).toFixed(1)}</b><span>average Listening band</span></div>
    </div>
    ${Object.keys(byMock).length ? `<div class="section-title">Mock exams</div>${Object.values(byMock).map(m => `<div class="card"><h2>${esc(m.title)}</h2>
      <div class="table-wrap"><table class="data"><tbody>${m.rows.map(a => `<tr><td>${kindBadge(a.test_kind)}</td><td><b>${esc(a.test_title)}</b></td><td class="nums">${a.correct}/${a.total}</td><td class="band-big">Band ${band(a.band)}</td><td><button class="btn sm" data-ans="${a.id}">Answers</button></td></tr>`).join('')}</tbody></table></div></div>`).join('')}` : ''}
    <div class="section-title">Practice history</div>
    ${practice.length ? `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>Test</th><th>Type</th><th>Score</th><th>Band</th><th></th></tr></thead><tbody>
      ${practice.map(a => `<tr><td class="muted small">${fmt(a.submitted_at)}</td><td><b>${esc(a.test_title)}</b></td><td>${kindBadge(a.test_kind)}</td><td class="nums">${a.correct}/${a.total}</td><td class="band-big">${band(a.band)}</td><td><a class="btn sm" href="#/review/${a.id}">Review</a></td></tr>`).join('')}
    </tbody></table></div></div>` : `<div class="empty">No practice tests yet — <a href="#/">start one</a>.</div>`}
  </div>`, 'results');
  $$('[data-ans]').forEach(b => b.onclick = () => {
    const a = mockAtts.find(x => x.id === b.dataset.ans);
    showResultModal({ correct: a.correct, total: a.total, band: a.band, detail: a.detail }, a.test_title);
  });
}

function showResultModal(res, title = '') {
  const det = res.detail || {};
  const nums = Object.keys(det).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  return modal({
    title: title ? `Result — ${esc(title)}` : 'Your result', wide: true,
    body: `<div class="score-ring"><div class="band" style="--p:${res.total ? Math.round(res.correct / res.total * 100) : 0}"><div>${band(res.band)}<small>BAND</small></div></div>
      <div><div class="big">${res.correct} / ${res.total}</div><div class="muted">correct answers</div></div></div>
      <div class="res-grid">${nums.map(n => {
        const d = det[n];
        return `<div class="res-item ${d.ok ? 'ok' : 'bad'}"><b>${n}</b><span>${d.ok ? '✓' : '✗'} ${esc(fmtAns(d.given) || '—')}${d.ok ? '' : ` <span class="exp">→ ${esc(fmtAns(d.expected))}</span>`}</span></div>`;
      }).join('')}</div>`,
    actions: [{ label: 'Close', cls: 'primary', value: true }],
  });
}

// =====================================================================
//  TEST PLAYER
// =====================================================================
async function pagePractice(id) {
  const test = await api.getTest(id);
  mountPlayer({ test, mode: 'practice', onExit: () => go('#/', true) });
}

async function pageReview(attId) {
  const atts = await api.myAttempts();
  const a = atts.find(x => x.id === attId);
  if (!a) throw new Error('Result not found.');
  const test = await api.getTest(a.test_id);
  mountPlayer({ test, mode: 'review', attempt: a, onExit: () => go('#/results', true) });
}

function mountPlayer(o) {
  const { test, mode } = o;
  const parts = test.content?.parts || [];
  const isReading = test.kind === 'reading';
  const all = allNumbers(test.content);
  const nums = all.map(x => x.n);
  const partOf = n => (all.find(x => x.n === n) || { part: 0 }).part;
  const draftKey = mode === 'practice' || mode === 'mock' ? `khmdv-draft:${ME?.id}:${o.mock?.id || 'p'}:${test.id}` : null;
  let answers = mode === 'review' ? { ...(o.attempt.answers || {}) } : (draftKey && store(draftKey)) || {};
  let submitted = false, lastResult = null, curPart = 0, cur = nums[0];
  let timerId = null, paused = false;
  let remaining = (+test.duration_min || 60) * 60;
  const timed = mode !== 'review';

  const partHtml = (p, i) => {
    const groups = (p.groups || []).map(renderGroup).join('');
    const nn = (p.groups || []).flatMap(groupNumbers);
    const qPane = `<div class="pane questions"><div class="questions-inner">
        <div class="part-title">${esc(p.title || (isReading ? `Passage ${i + 1}` : `Part ${i + 1}`))}</div>
        ${!isReading ? `<div class="part-intro">${rangeLabel(nn)}</div>` : ''}
        ${groups || '<div class="empty">No questions in this part yet.</div>'}</div></div>`;
    if (isReading) return `<div class="part" data-part="${i}" ${i ? 'hidden' : ''}><div class="split">
        <div class="pane passage">${p.title ? `<div class="part-title">${esc(p.title)}</div>` : ''}${md(p.passage)}</div>
        <div class="resizer" title="Drag to resize"></div>${qPane}</div></div>`;
    return `<div class="part" data-part="${i}" ${i ? 'hidden' : ''}><div class="split single">${qPane}
        <div class="resizer hidden"></div><div class="pane passage transcript-pane hidden"><div class="part-title">Audio script</div>${md(p.transcript || '_No script added for this part._')}</div></div></div>`;
  };

  const strict = !!test.strict_audio && mode !== 'review';
  const audioHtml = !isReading ? `<div class="audio-bar">${!test.audio_url
      ? '<span class="muted small">🔇 No audio attached to this test.</span>'
      : strict
        ? `<div class="audio-strict"><button class="btn primary" id="playOnce">▶ Play audio</button><div class="audio-track"><div id="aprog"></div></div><span class="small muted nums" id="atime">00:00</span><input class="vol" id="vol" type="range" min="0" max="1" step="0.05" value="1" title="Volume"></div><audio id="aud" src="${esc(test.audio_url)}" preload="auto"></audio>`
        : `<audio id="aud" controls preload="metadata" src="${esc(test.audio_url)}"></audio>`}</div>` : '';

  app.innerHTML = `<div class="player ${isReading ? 'is-reading' : 'is-listening'}">
    <header class="p-head">
      <a class="brand" href="#" id="exitBtn" title="Exit"><span class="brand-logo">K</span></a>
      <div class="p-title">${esc(test.title)}<small>${mode === 'mock' ? 'Mock exam' : mode === 'preview' ? 'Preview' : mode === 'review' ? 'Review' : 'Practice'}</small></div>
      ${tgPill()}
      ${timed ? `<div class="timer" id="timer"><span id="tval">${dur(remaining)}</span>${mode !== 'mock' ? '<button id="tpause" title="Pause / resume">⏸</button>' : ''}</div>` : ''}
      ${themeBtn()}
      <button class="btn ${mode === 'review' ? 'success' : 'primary'}" id="submitBtn">${mode === 'review' ? 'My result' : 'Submit'}</button>
    </header>
    ${audioHtml || '<div></div>'}
    <div class="p-body" id="pbody">${parts.map(partHtml).join('')}</div>
    <footer class="p-foot" id="pfoot"></footer>
    <div class="nav-arrows"><button id="prevQ" aria-label="Previous question">‹</button><button id="nextQ" aria-label="Next question">›</button></div>
    <div class="hl-tool hidden" id="hltool"><button data-hl="add"><span class="sw"></span>Highlight</button><button data-hl="clear">Clear</button></div>
  </div>`;

  const body = $('#pbody');

  // ---------- footer ----------
  function drawFoot() {
    $('#pfoot').innerHTML = parts.map((p, i) => {
      const nn = all.filter(x => x.part === i).map(x => x.n);
      const answered = nn.filter(n => String(answers[n] ?? '').trim()).length;
      return `<div class="foot-part ${i === curPart ? 'on' : ''}"><button class="part-btn" data-part-btn="${i}">${esc(p.title || (isReading ? `Passage ${i + 1}` : `Part ${i + 1}`))}</button>
        <span class="count">${answered} of ${nn.length}</span>
        <div class="chips">${nn.map(n => {
          let c = String(answers[n] ?? '').trim() ? 'done' : '';
          if (lastResult?.detail?.[n]) c = lastResult.detail[n].ok ? 'ok' : 'bad';
          return `<button class="chip ${c} ${n === cur ? 'cur' : ''}" data-chip="${n}">${n}</button>`;
        }).join('')}</div></div>`;
    }).join('');
  }
  $('#pfoot').addEventListener('click', e => {
    const c = e.target.closest('[data-chip]'); if (c) return goTo(+c.dataset.chip);
    const p = e.target.closest('[data-part-btn]'); if (p) { showPart(+p.dataset.partBtn); const first = all.find(x => x.part === +p.dataset.partBtn); if (first) setCur(first.n); }
  });

  function showPart(i) {
    curPart = i;
    $$('.part', body).forEach(el => el.hidden = +el.dataset.part !== i);
    drawFoot();
  }
  function setCur(n) {
    cur = n;
    $$('.q.current, .gap.current', body).forEach(el => el.classList.remove('current'));
    const el = $(`#q-${n}`, body);
    const box = el?.classList.contains('anchor') ? el.closest('.q') : el;
    box?.classList.add('current');
    drawFoot();
  }
  function goTo(n) {
    if (partOf(n) !== curPart) showPart(partOf(n));
    setCur(n);
    const el = $(`#q-${n}`, body);
    const target = el?.classList.contains('anchor') ? el.closest('.q') : el;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const inp = target?.querySelector('input.gap-input, select');
    if (inp && !submitted) setTimeout(() => inp.focus({ preventScroll: true }), 250);
  }
  $('#prevQ').onclick = () => { const i = nums.indexOf(cur); if (i > 0) goTo(nums[i - 1]); };
  $('#nextQ').onclick = () => { const i = nums.indexOf(cur); if (i < nums.length - 1) goTo(nums[i + 1]); };

  // ---------- answers ----------
  function restore() {
    for (const [n, v] of Object.entries(answers)) {
      if (!v) continue;
      $$(`input[type=radio][name="q${n}"]`, body).forEach(r => r.checked = r.value === v);
      $$(`select[data-q="${n}"]`, body).forEach(s => s.value = v);
      $$(`input.gap-input[data-q="${n}"]`, body).forEach(i => i.value = v);
    }
    $$('.q.multi', body).forEach(q => {
      const nn = q.dataset.multi.split(',');
      const chosen = nn.map(n => answers[n]).filter(Boolean);
      $$('input[type=checkbox]', q).forEach(c => c.checked = chosen.includes(c.value));
    });
  }
  const saveDraft = () => { if (draftKey && !submitted) store(draftKey, answers); };
  body.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('input.gap-input')) { answers[t.dataset.q] = t.value; saveDraft(); drawFoot(); }
  });
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('input[type=radio][data-q], select[data-q]')) { answers[t.dataset.q] = t.value; setCur(+t.dataset.q); }
    if (t.matches('input[type=checkbox][data-multi-input]')) {
      const q = t.closest('.q.multi'); const picks = +q.dataset.picks;
      const checked = $$('input[type=checkbox]:checked', q);
      if (checked.length > picks) { t.checked = false; toast(`Choose only ${picks} letters.`); return; }
      const letters = checked.map(c => c.value).sort();
      q.dataset.multi.split(',').forEach((n, i) => answers[n] = letters[i] || '');
      setCur(+q.dataset.multi.split(',')[0]);
    }
    saveDraft(); drawFoot();
  });
  body.addEventListener('focusin', e => {
    const t = e.target.closest('[data-q]');
    if (t) setCur(+t.dataset.q);
    const m = e.target.closest('.q.multi'); if (m) setCur(+m.dataset.multi.split(',')[0]);
  });
  // Enter in a gap moves to the next question
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input.gap-input')) { e.preventDefault(); $('#nextQ').click(); }
  });

  // ---------- resizer ----------
  $$('.resizer', body).forEach(rz => rz.addEventListener('pointerdown', e => {
    const split = rz.parentElement; const rect = split.getBoundingClientRect();
    const mobile = matchMedia('(max-width: 820px)').matches;
    rz.classList.add('drag'); rz.setPointerCapture(e.pointerId);
    const move = ev => {
      if (mobile) { const p = Math.min(80, Math.max(15, (ev.clientY - rect.top) / rect.height * 100)); split.style.gridTemplateRows = `${p}% 8px 1fr`; }
      else { const p = Math.min(78, Math.max(22, (ev.clientX - rect.left) / rect.width * 100)); $$('.split:not(.single)', body).forEach(s => s.style.setProperty('--left', p + '%')); }
    };
    const up = () => { rz.classList.remove('drag'); rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); };
    rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
  }));

  // ---------- highlighting ----------
  const tool = $('#hltool');
  let savedRange = null;
  document.addEventListener('selectionchange', onSel);
  CLEANUP.push(() => document.removeEventListener('selectionchange', onSel));
  function onSel() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { setTimeout(() => { if (getSelection().isCollapsed) tool.classList.add('hidden'); }, 150); return; }
    const r = sel.getRangeAt(0);
    if (!body.contains(r.commonAncestorContainer)) return;
    savedRange = r.cloneRange();
    const rect = r.getBoundingClientRect();
    tool.style.left = Math.max(8, Math.min(innerWidth - 200, rect.left + rect.width / 2 - 85)) + 'px';
    tool.style.top = Math.max(8, rect.top - 46) + 'px';
    tool.classList.remove('hidden');
  }
  tool.addEventListener('mousedown', e => e.preventDefault());
  tool.addEventListener('click', e => {
    const b = e.target.closest('[data-hl]'); if (!b || !savedRange) return;
    if (b.dataset.hl === 'add') highlight(savedRange);
    else $$('mark.hl', body).filter(m => savedRange.intersectsNode(m)).forEach(unwrap);
    getSelection().removeAllRanges(); tool.classList.add('hidden');
  });
  body.addEventListener('click', e => {
    const m = e.target.closest('mark.hl');
    if (m && getSelection().isCollapsed) unwrap(m);
  });
  function unwrap(m) { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); }
  function highlight(range) {
    const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) { const n = w.currentNode; if (range.intersectsNode(n) && n.nodeValue.trim()) nodes.push(n); }
    for (const n of nodes) {
      if (n.parentNode.closest('select, option, button, .q-num, .gap-num, .opt-letter, mark.hl')) continue;
      let s = 0, e = n.nodeValue.length;
      if (n === range.startContainer) s = range.startOffset;
      if (n === range.endContainer) e = range.endOffset;
      if (s >= e) continue;
      const mid = n.splitText(s); mid.splitText(e - s);
      const mark = document.createElement('mark'); mark.className = 'hl';
      mid.parentNode.insertBefore(mark, mid); mark.appendChild(mid);
    }
  }

  // ---------- audio ----------
  const aud = $('#aud');
  if (aud && strict) {
    let played = false;
    $('#playOnce').onclick = () => {
      if (played) return; played = true;
      aud.play().catch(() => { played = false; toast('Tap Play again to start the audio.', 'err'); });
      $('#playOnce').disabled = true; $('#playOnce').textContent = '♪ Playing…';
    };
    aud.addEventListener('timeupdate', () => {
      $('#aprog').style.width = (aud.currentTime / (aud.duration || 1) * 100) + '%';
      $('#atime').textContent = dur(aud.currentTime) + (aud.duration ? ' / ' + dur(aud.duration) : '');
    });
    aud.addEventListener('ended', () => { $('#playOnce').textContent = '✓ Audio finished'; });
    aud.addEventListener('pause', () => { if (!aud.ended && played && !submitted) aud.play().catch(() => {}); });
    $('#vol').oninput = e => aud.volume = +e.target.value;
  }
  CLEANUP.push(() => { try { aud?.pause(); } catch {} });

  // ---------- timer ----------
  function tick() {
    if (mode === 'mock') {
      const now = Date.now() + (o.mock.offset || 0);
      const deadline = Math.min(Date.parse(o.mock.openedAt) + test.duration_min * 60000, Date.parse(o.mock.endsAt));
      remaining = (deadline - now) / 1000;
    } else if (!paused) remaining -= 1;
    const tv = $('#tval'); if (tv) tv.textContent = dur(remaining);
    $('#timer')?.classList.toggle('low', remaining <= 300);
    if (remaining <= 0 && !submitted) { clearInterval(timerId); toast('Time is up — submitting your answers.', '', 4000); doSubmit(true); }
  }
  if (timed) {
    timerId = setInterval(tick, 1000); CLEANUP.push(() => clearInterval(timerId));
    if (mode === 'mock') tick();
    $('#tpause')?.addEventListener('click', () => { paused = !paused; $('#tpause').textContent = paused ? '▶' : '⏸'; });
  }

  // ---------- leaving ----------
  const leaveMsg = () => (submitted || mode === 'review' || mode === 'preview') ? null : (mode === 'mock'
    ? 'Leave the mock? Your answers are kept on this device and the timer keeps running.'
    : 'Leave this test? Your answers are kept on this device.');
  GUARD = leaveMsg;
  if (mode === 'practice' || mode === 'mock') window.onbeforeunload = () => submitted ? undefined : true;
  $('#exitBtn').onclick = async e => {
    e.preventDefault();
    const msg = leaveMsg();
    if (msg && !(await confirmBox('Leave this page?', msg, 'Leave', 'danger'))) return;
    GUARD = null; o.onExit();
  };

  // ---------- submit ----------
  const submitBtn = $('#submitBtn');
  submitBtn.onclick = async () => {
    if (submitted || mode === 'review') return lastResult && showResultModal(lastResult, test.title);
    const answered = nums.filter(n => String(answers[n] ?? '').trim()).length;
    const ok = await confirmBox('Submit your answers?', `You have answered <b>${answered} of ${nums.length}</b> questions.${mode === 'mock' ? '<br>You cannot change your answers after submitting.' : ''}`, 'Submit');
    if (ok) doSubmit(false);
  };

  async function doSubmit(auto) {
    if (submitted) return;
    submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
    try {
      let res;
      if (mode === 'preview') res = { released: true, ...score(test.content, o.key, answers, test.kind), transcripts: parts.map(p => p.transcript || '') };
      else res = await api.submit({ test_id: test.id, mock_id: o.mock?.id || null, answers, opened_at: o.openedAt || null });
      submitted = true; clearInterval(timerId); GUARD = null; window.onbeforeunload = null;
      if (draftKey) store(draftKey, null);
      if (aud && !strict) aud.pause();
      if (res.released) { applyResult(res); showResultModal(res, test.title); }
      else o.onDone?.(res);
    } catch (e) {
      submitBtn.disabled = false; submitBtn.textContent = 'Submit';
      const again = await modal({
        title: 'Could not submit', body: `<p>${esc(e.message)}</p><p class="muted small">Your answers are saved on this device. Check your internet connection and try again.</p>`,
        actions: [{ label: 'Try again', cls: 'primary', value: true }], dismissable: !auto,
      });
      if (again) doSubmit(auto);
    }
  }

  function applyResult(res) {
    lastResult = res; submitted = true;
    body.classList.add('locked');
    $$('input, select', body).forEach(el => el.disabled = true);
    const det = res.detail || {};
    for (const [n, d] of Object.entries(det)) {
      if (!/^\d+$/.test(n)) continue;
      const el = $(`#q-${n}`, body);
      if (!el) continue;
      if (el.classList.contains('gap')) {
        el.classList.add(d.ok ? 'is-ok' : 'is-bad');
        const fb = $('.gap-fb', el); fb.className = 'gap-fb ' + (d.ok ? 'ok' : 'bad');
        fb.textContent = d.ok ? '✓' : `✗ ${fmtAns(d.expected)}`;
      } else if (!el.classList.contains('anchor')) {
        el.classList.add(d.ok ? 'is-ok' : 'is-bad');
        $('.q-feedback', el).innerHTML = d.ok ? '<span class="ok">✓ Correct</span>' : `<span class="bad">✗ Correct answer: ${esc(fmtAns(d.expected))}</span>`;
      }
    }
    $$('.q.multi', body).forEach(q => {
      const nn = q.dataset.multi.split(',');
      const ds = nn.map(n => det[n]).filter(Boolean);
      if (!ds.length) return;
      const allOk = ds.every(d => d.ok);
      q.classList.add(allOk ? 'is-ok' : 'is-bad');
      $('.q-feedback', q).innerHTML = `<span class="${allOk ? 'ok' : 'bad'}">${nn.map(n => `${n} ${det[n]?.ok ? '✓' : '✗'}`).join(' · ')} — Correct: ${esc(ds[0].expected)}</span>`;
    });
    // listening: show the script beside the questions
    if (!isReading) {
      const scripts = res.transcripts || parts.map(p => p.transcript || '');
      $$('.part', body).forEach((pEl, i) => {
        if (!scripts[i]) return;
        const split = $('.split', pEl); split.classList.remove('single');
        $('.resizer', pEl).classList.remove('hidden'); $('.transcript-pane', pEl).classList.remove('hidden');
      });
    }
    submitBtn.disabled = false; submitBtn.className = 'btn success'; submitBtn.textContent = 'My result';
    const t = $('#timer'); if (t) { t.classList.remove('low'); t.innerHTML = `<span>Band ${band(res.band)}</span>`; }
    drawFoot();
  }

  restore();
  drawFoot();
  setCur(cur);
  if (mode === 'review') applyResult({ correct: o.attempt.correct, total: o.attempt.total, band: o.attempt.band, detail: o.attempt.detail, transcripts: parts.map(p => p.transcript || '') });
  return { applyResult };
}

// =====================================================================
//  SUNDAY MOCK
// =====================================================================
async function pageMockLobby(mockId) {
  const s = SESSION.mocks[mockId];
  if (!s) {
    const mocks = await api.listMocks();
    const m = mocks.find(x => x.id === mockId);
    if (!m) throw new Error('Mock not found.');
    app.innerHTML = shell(`<div class="page narrow"><div class="card">
      <h1 style="font-size:24px">${esc(m.title)}</h1><p class="muted">${fmtDay(m.starts_at)}</p>
      <form class="row" id="pwf"><input class="input" name="pw" type="password" placeholder="Mock password" required style="max-width:260px"><button class="btn primary">Enter</button></form>
    </div></div>`);
    $('#pwf').onsubmit = async e => {
      e.preventDefault();
      try { const d = await api.startMock(mockId, e.target.pw.value); SESSION.mocks[mockId] = { ...d, offset: Date.parse(d.server_now) - Date.now() }; route(); }
      catch (er) { toast(er.message, 'err'); }
    };
    return;
  }
  const { mock, tests, progress } = s;
  const stat = id => progress.find(p => p.test_id === id) || {};
  const nextIdx = tests.findIndex(t => stat(t.id).status !== 'submitted');
  const allDone = nextIdx === -1;
  app.innerHTML = shell(`<div class="page narrow">
    <div class="page-head"><div><span class="badge live">● Live</span><h1 style="margin-top:8px">${esc(mock.title)}</h1><p>Closes ${fmtDay(mock.ends_at)}</p></div></div>
    ${allDone ? `<div class="card done-screen"><div class="tick">✓</div><h2>All sections submitted</h2><p class="muted">Well done! Your teacher will announce the results.</p><a class="btn" href="#/">Back to dashboard</a></div>` : `
    <div class="section-list">${tests.map((t, i) => {
      const st = stat(t.id);
      const done = st.status === 'submitted';
      const inProg = !done && st.opened_at;
      return `<div class="section-item ${done ? 'done' : ''}"><div class="num">${done ? '✓' : i + 1}</div>
        <div class="info"><div class="row">${kindBadge(t.kind)}<b>${esc(t.title)}</b></div><div class="small muted">${t.question_count} questions · ${t.duration_min} minutes${inProg ? ' · <b style="color:var(--warn)">in progress</b>' : ''}</div></div>
        ${done ? '<span class="badge ok">Submitted</span>' : i === nextIdx ? `<button class="btn primary" data-start="${t.id}">${inProg ? 'Continue' : 'Start'}</button>` : '<span class="badge">Locked</span>'}</div>`;
    }).join('')}</div>
    <div class="rules"><b>Rules</b><ul>
      <li>Do the sections in order. Each section has its own timer, which starts when you press <b>Start</b> and keeps running even if you leave the page.</li>
      <li>When the time is up, your answers are submitted automatically.</li>
      <li>You can submit each section only once. Results are released by your teacher.</li>
      <li>Use headphones for Listening${tests.some(t => t.kind === 'listening' && t.strict_audio) ? ' — the audio plays only once and cannot be paused' : ''}.</li></ul></div>`}
  </div>`);
  $$('[data-start]').forEach(b => b.onclick = async () => {
    const t = tests.find(x => x.id === b.dataset.start);
    if (!stat(t.id).opened_at && !(await confirmBox(`Start ${esc(t.title)}?`, `Your <b>${t.duration_min}-minute</b> timer starts now and cannot be paused.`, 'Start now'))) return;
    b.disabled = true;
    try {
      const r = await api.openSection(mockId, t.id);
      const p = progress.find(x => x.test_id === t.id);
      if (p) p.opened_at = r.opened_at; else progress.push({ test_id: t.id, status: 'started', opened_at: r.opened_at });
      s.offset = Date.parse(r.server_now) - Date.now();
      persistMocks();
      go(`#/mock/${mockId}/${t.id}`);
    } catch (er) { toast(er.message, 'err'); b.disabled = false; }
  });
}

async function pageMockSection(mockId, testId) {
  const s = SESSION.mocks[mockId];
  if (!s) return go('#/mock/' + mockId);
  const test = s.tests.find(t => t.id === testId);
  const st = s.progress.find(p => p.test_id === testId);
  if (!test || !st?.opened_at || st.status === 'submitted') return go('#/mock/' + mockId);
  mountPlayer({
    test, mode: 'mock', openedAt: st.opened_at,
    mock: { id: mockId, openedAt: st.opened_at, endsAt: s.mock.ends_at, offset: s.offset },
    onExit: () => go('#/mock/' + mockId, true),
    onDone: res => {
      st.status = 'submitted'; persistMocks();
      const next = s.tests.find(t => s.progress.find(p => p.test_id === t.id)?.status !== 'submitted');
      app.innerHTML = shell(`<div class="page narrow"><div class="card done-screen"><div class="tick">✓</div>
        <h2>${esc(test.title)} submitted</h2>
        <p class="muted">${next ? `Next section: <b>${esc(next.title)}</b>` : 'You have finished the mock. Your teacher will announce the results.'}</p>
        <a class="btn primary" href="#/mock/${mockId}">${next ? 'Continue to next section' : 'Done'}</a></div></div>`);
    },
  });
}

// =====================================================================
//  ADMIN
// =====================================================================
const adminTabs = on => `<div class="admin-tabs">
  <a href="#/admin" class="${on === 'tests' ? 'on' : ''}">Tests</a>
  <a href="#/admin/mocks" class="${on === 'mocks' ? 'on' : ''}">Sunday mocks</a>
  <a href="#/admin/library" class="${on === 'library' ? 'on' : ''}">Library uploads</a>
  <a href="#/admin/students" class="${on === 'students' ? 'on' : ''}">Students</a></div>`;
const VIS = { draft: ['Draft', ''], practice: ['Practice', 'ok'], mock: ['Mock only', 'warn'] };

async function adminTests() {
  const tests = await api.adminListTests();
  let filter = 'all';
  const draw = () => {
    const list = tests.filter(t => filter === 'all' || t.kind === filter || t.visibility === filter);
    app.innerHTML = shell(`<div class="page">
      <div class="page-head"><div><h1>Admin</h1><p>Build tests by pasting the passage, questions and answer key.</p></div>
        <div class="row"><a class="btn" href="#/admin/test/new?kind=listening">+ Listening test</a><a class="btn primary" href="#/admin/test/new?kind=reading">+ Reading test</a></div></div>
      ${adminTabs('tests')}
      <div class="filters"><div class="seg">${[['all', 'All'], ['reading', 'Reading'], ['listening', 'Listening'], ['practice', 'Practice'], ['mock', 'Mock only'], ['draft', 'Drafts']].map(([k, l]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="muted small">${list.length} tests</span></div>
      ${list.length ? `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
        <thead><tr><th>Title</th><th>Type</th><th>Shown as</th><th>Questions</th><th>Time</th><th>Updated</th><th></th></tr></thead><tbody>
        ${list.map(t => `<tr><td><a href="#/admin/test/${t.id}"><b>${esc(t.title)}</b></a></td><td>${kindBadge(t.kind)}</td>
          <td><span class="badge ${VIS[t.visibility][1]}">${VIS[t.visibility][0]}</span></td><td class="nums">${t.question_count}</td><td class="nums">${t.duration_min} min</td>
          <td class="muted small">${fmt(t.updated_at, { dateStyle: 'medium' })}</td>
          <td><div class="row" style="justify-content:flex-end;gap:6px"><a class="btn sm" href="#/admin/test/${t.id}">Edit</a><button class="btn sm" data-dup="${t.id}">Duplicate</button><button class="btn sm danger" data-del="${t.id}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div></div>` : `<div class="empty">No tests yet. Create your first one with the buttons above.</div>`}
    </div>`, 'admin');
    $$('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      const t = tests.find(x => x.id === b.dataset.del);
      if (!(await confirmBox('Delete test?', `“${esc(t.title)}” and all its results will be deleted permanently.`, 'Delete', 'danger'))) return;
      try { await api.deleteTest(t.id); toast('Deleted', 'ok'); route(); } catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-dup]').forEach(b => b.onclick = async () => {
      try {
        const t = await api.getTest(b.dataset.dup); const k = await api.getKey(t.id);
        const copy = { ...t, id: undefined, title: t.title + ' (copy)', visibility: 'draft' };
        const id = await api.saveTest(copy, k); toast('Duplicated', 'ok'); go('#/admin/test/' + id);
      } catch (e) { toast(e.message, 'err'); }
    });
  };
  draw();
}

// ---------------- test editor ----------------
let ED = null;   // { test, keyText, dirty, fromPreview }
const DEFAULT_INSTR = {
  reading: {
    tfng: 'Do the following statements agree with the information given in the passage? Choose **TRUE**, **FALSE** or **NOT GIVEN**.',
    ynng: 'Do the following statements agree with the views of the writer? Choose **YES**, **NO** or **NOT GIVEN**.',
    mcq: 'Choose the correct letter, **A**, **B**, **C** or **D**.',
    multi: 'Choose **TWO** letters, **A–E**.',
    matching: 'Which paragraph contains the following information? Choose the correct letter.',
    gap: 'Complete the notes below. Choose **ONE WORD ONLY** from the passage for each answer.',
  },
  listening: {
    tfng: '', ynng: '',
    mcq: 'Choose the correct letter, **A**, **B** or **C**.',
    multi: 'Choose **TWO** letters, **A–E**.',
    matching: 'Choose the correct letter for each question.',
    gap: 'Complete the notes below. Write **ONE WORD AND/OR A NUMBER** for each answer.',
  },
};
const HINTS = {
  tfng: 'One statement per line:\nThe author visited Paris in 1990.\nMost visitors arrive by train.',
  ynng: 'One statement per line:\nThe writer believes the plan will fail.\nGovernments should fund more research.',
  mcq: 'First line = question, then options. Leave an EMPTY LINE between questions:\nWhat is the main purpose of the study?\nA to describe …\nB to compare …\nC to criticise …\nD to explain …',
  multi: 'Question line, then options. Set "Choose" to 2 or 3:\nWhich TWO benefits are mentioned?\nA cheaper travel\nB cleaner air\nC …',
  matching: 'Items to match, one per line (each is a question):\nan example of a failed experiment\na reference to future research\n\nPut the choices in the Options box: letters only (A, B, C…)\nor with text (A  Mary Smith / i  The importance of …)',
  gap: 'Write the notes / summary / table and put [[n]] where answer n goes:\n## The Festival\n- began in [[5]]\n- held every [[6]] years\nTable rows: | Name | Price |\n            | Hotel | £[[7]] |\nOptions box (optional) = word bank → students choose letters',
};
const blankGroup = (kind, type = 'tfng', from = 1) => ({ type, from, instructions: DEFAULT_INSTR[kind][type] || '', body: '', options: '', optionsTitle: '', picks: 2, image: '' });
const blankPart = (kind, n, from = 1) => kind === 'reading'
  ? { title: `Reading Passage ${n}`, passage: '', groups: [blankGroup(kind, 'tfng', from)] }
  : { title: `Part ${n}`, transcript: '', groups: [blankGroup(kind, 'gap', from)] };

async function adminTestEditor(id, query = '') {
  const params = new URLSearchParams(query);
  if (ED?.fromPreview && (ED.test.id || 'new') === id) { ED.fromPreview = false; }
  else if (id === 'new') {
    const kind = params.get('kind') === 'listening' ? 'listening' : 'reading';
    ED = { test: { title: '', kind, duration_min: kind === 'listening' ? 40 : 60, visibility: 'draft', audio_url: '', strict_audio: false, content: { parts: [blankPart(kind, 1)] } }, keyText: '', dirty: false };
  } else {
    const t = await api.getTest(id); const k = await api.getKey(id);
    ED = { test: JSON.parse(JSON.stringify(t)), keyText: keyToText(k), dirty: false };
    ED.test.content ||= { parts: [] };
  }
  drawEditor();
}

function drawEditor() {
  const t = ED.test, kind = t.kind, parts = t.content.parts;
  const groupCard = (g, pi, gi) => {
    const showFrom = g.type !== 'gap';
    const showOpts = g.type === 'matching' || g.type === 'gap';
    return `<div class="group-card" data-p="${pi}" data-g="${gi}">
      <div class="group-card-head">
        <select class="input" data-gf="type" style="max-width:300px">${Object.entries(GROUP_TYPES).filter(([k]) => kind === 'reading' || !['tfng', 'ynng'].includes(k)).map(([k, l]) => `<option value="${k}" ${g.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${showFrom ? `<label class="row small" style="gap:6px">First Q<input class="input" data-gf="from" type="number" min="1" value="${g.from}" style="width:76px"></label>` : ''}
        ${g.type === 'multi' ? `<label class="row small" style="gap:6px">Choose<input class="input" data-gf="picks" type="number" min="2" max="5" value="${g.picks || 2}" style="width:64px"></label>` : ''}
        <span class="nums" data-range>${rangeLabel(groupNumbers(g))}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-gact="up" title="Move up">↑</button><button class="btn sm ghost" data-gact="down" title="Move down">↓</button>
        <button class="btn sm danger" data-gact="del" title="Delete group">✕</button>
      </div>
      <label class="field"><span>Instructions</span><textarea data-gf="instructions" rows="2">${esc(g.instructions)}</textarea></label>
      <label class="field"><span>${g.type === 'gap' ? 'Notes / summary / table text' : g.type === 'matching' ? 'Items to match' : 'Questions'}</span><textarea class="mono" data-gf="body" rows="${g.type === 'gap' || g.type === 'mcq' ? 9 : 6}">${esc(g.body)}</textarea></label>
      <div class="hint">${esc(HINTS[g.type])}</div>
      ${showOpts ? `<div class="grid-2"><label class="field"><span>${g.type === 'gap' ? 'Word bank (optional)' : 'Options'}</span><textarea class="mono" data-gf="options" rows="4" placeholder="${g.type === 'gap' ? 'A  cheap\nB  heavy\nC  local' : 'A\nB\nC\nD'}">${esc(g.options)}</textarea></label>
        <label class="field"><span>Options box title (optional)</span><input data-gf="optionsTitle" value="${esc(g.optionsTitle || '')}" placeholder="e.g. List of Headings"></label></div>` : ''}
      <details><summary class="small muted" style="cursor:pointer">Picture (map / diagram)</summary>
        <label class="field" style="margin-top:8px"><span>Image URL (e.g. a GitHub raw link)</span><input data-gf="image" value="${esc(g.image || '')}" placeholder="https://…"></label></details>
    </div>`;
  };

  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><a href="#/admin" class="small">← All tests</a><h1>${t.id ? 'Edit' : 'New'} ${kind} test</h1></div>
      <div class="row"><button class="btn" id="edPreview">Preview as student</button><button class="btn primary" id="edSave">Save test</button></div></div>
    <div class="editor"><div>
      <div class="card">
        <label class="field"><span>Title</span><input data-tf="title" value="${esc(t.title)}" placeholder="${kind === 'reading' ? 'e.g. Cambridge 18 Test 2 — Reading' : 'e.g. Cambridge 18 Test 2 — Listening'}"></label>
        <div class="grid-3">
          <label class="field"><span>Time (minutes)</span><input data-tf="duration_min" type="number" min="1" value="${t.duration_min}"></label>
          <label class="field"><span>Shown to students as</span><select data-tf="visibility">
            <option value="draft" ${t.visibility === 'draft' ? 'selected' : ''}>Draft (hidden)</option>
            <option value="practice" ${t.visibility === 'practice' ? 'selected' : ''}>Practice test</option>
            <option value="mock" ${t.visibility === 'mock' ? 'selected' : ''}>Mock only (hidden until the mock)</option></select></label>
          <label class="field"><span>Type</span><input value="${kind === 'reading' ? 'Reading' : 'Listening'}" disabled></label>
        </div>
        ${kind === 'listening' ? `<label class="field"><span>Audio (one MP3 for the whole test)</span>
          <div class="row" style="flex-wrap:nowrap"><input class="input" data-tf="audio_url" value="${esc(t.audio_url)}" placeholder="https://raw.githubusercontent.com/…/test.mp3"><label class="btn" style="flex:none">Upload MP3<input type="file" accept="audio/*" id="audUp" hidden></label></div></label>
          ${t.audio_url ? `<audio controls src="${esc(t.audio_url)}" style="width:100%;margin-bottom:12px"></audio>` : ''}
          <label class="check"><input type="checkbox" data-tf="strict_audio" ${t.strict_audio ? 'checked' : ''}> Exam mode audio — plays once, no pause or rewind</label>` : ''}
      </div>

      ${parts.map((p, pi) => `<div class="part-card" data-p="${pi}">
        <div class="part-card-head"><input class="input" data-pf="title" value="${esc(p.title)}"><span class="muted small nums">${rangeLabel(p.groups.flatMap(groupNumbers))}</span><span style="flex:1"></span>
          <button class="btn sm danger" data-pact="del">Remove ${kind === 'reading' ? 'passage' : 'part'}</button></div>
        <div class="part-card-body">
          ${kind === 'reading'
            ? `<label class="field"><span>Passage</span><textarea class="mono" data-pf="passage" rows="14" placeholder="# Title of the passage\n\n[A] First paragraph…\n\n[B] Second paragraph…">${esc(p.passage)}</textarea></label>
               <div class="hint"># Title · ## Subheading · blank line = new paragraph · [A] at the start = lettered paragraph · **bold** · *italic*</div>`
            : `<details ${p.transcript ? '' : ''}><summary class="small muted" style="cursor:pointer;margin-bottom:8px">Audio script (shown to students after they submit)</summary>
               <label class="field"><textarea class="mono" data-pf="transcript" rows="10" placeholder="**MAN:** Good morning…">${esc(p.transcript || '')}</textarea></label></details>`}
          ${p.groups.map((g, gi) => groupCard(g, pi, gi)).join('')}
          <button class="btn sm" data-pact="addg">+ Add question group</button>
        </div></div>`).join('')}
      <button class="btn" id="addPart">+ Add ${kind === 'reading' ? 'passage' : 'part'}</button>
    </div>

    <aside class="editor-side">
      <div class="card"><h2 style="font-size:16px">Answer key</h2>
        <textarea class="mono" id="keyText" rows="16" placeholder="1 TRUE\n2 NOT GIVEN\n3 coffee / coffees\n4 (the) river\n5 B\n11-12 B, D">${esc(ED.keyText)}</textarea>
        <div class="hint" style="margin-top:8px">One per line: number + answer.\nAlternatives: a / b\nOptional words: (the) river\nChoose-two: 11-12 B, D\nT / F / NG / Y / N are understood.</div>
      </div>
      <div class="card"><h2 style="font-size:16px">Check</h2><div class="check-list" id="checkList"></div></div>
      <div class="card"><div class="row"><button class="btn sm" id="exportJson">Export backup</button><label class="btn sm">Import backup<input type="file" accept=".json" id="importJson" hidden></label></div></div>
    </aside></div></div>`, 'admin');

  const mark = () => { ED.dirty = true; scheduleCheck(); };
  // test fields
  $$('[data-tf]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    t[el.dataset.tf] = el.type === 'checkbox' ? el.checked : el.value; mark();
  }));
  // part fields
  $$('[data-pf]').forEach(el => el.addEventListener('input', () => { parts[+el.closest('[data-p]').dataset.p][el.dataset.pf] = el.value; mark(); }));
  // group fields
  $$('[data-gf]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const c = el.closest('.group-card'); const g = parts[+c.dataset.p].groups[+c.dataset.g];
    const f = el.dataset.gf;
    if (f === 'type') {
      const oldDefault = DEFAULT_INSTR[kind][g.type] || '';
      g.type = el.value;
      if (!g.instructions || g.instructions === oldDefault) g.instructions = DEFAULT_INSTR[kind][g.type] || '';
      ED.dirty = true; return drawEditor();
    }
    g[f] = (f === 'from' || f === 'picks') ? +el.value : el.value;
    const r = $('[data-range]', c); if (r) r.textContent = rangeLabel(groupNumbers(g));
    mark();
  }));
  // group actions
  $$('[data-gact]').forEach(b => b.onclick = async () => {
    const c = b.closest('.group-card'); const pi = +c.dataset.p, gi = +c.dataset.g; const gs = parts[pi].groups;
    if (b.dataset.gact === 'del') { if (gs[gi].body.trim() && !(await confirmBox('Delete this question group?', 'Its questions will be removed.', 'Delete', 'danger'))) return; gs.splice(gi, 1); }
    if (b.dataset.gact === 'up' && gi > 0) [gs[gi - 1], gs[gi]] = [gs[gi], gs[gi - 1]];
    if (b.dataset.gact === 'down' && gi < gs.length - 1) [gs[gi + 1], gs[gi]] = [gs[gi], gs[gi + 1]];
    ED.dirty = true; drawEditor();
  });
  const nextNum = () => Math.max(0, ...allNumbers(t.content).map(x => x.n)) + 1;
  $$('[data-pact]').forEach(b => b.onclick = async () => {
    const pi = +b.closest('[data-p]').dataset.p;
    if (b.dataset.pact === 'addg') parts[pi].groups.push(blankGroup(kind, kind === 'reading' ? 'tfng' : 'gap', nextNum()));
    if (b.dataset.pact === 'del') { if (!(await confirmBox('Remove this section?', 'The text and all its questions will be removed.', 'Remove', 'danger'))) return; parts.splice(pi, 1); }
    ED.dirty = true; drawEditor();
  });
  $('#addPart').onclick = () => { parts.push(blankPart(kind, parts.length + 1, nextNum())); ED.dirty = true; drawEditor(); };
  $('#keyText').addEventListener('input', e => { ED.keyText = e.target.value; mark(); });

  $('#audUp')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    toast('Uploading audio…', '', 2500);
    try { t.audio_url = await api.uploadAudio(f); ED.dirty = true; drawEditor(); toast('Audio uploaded', 'ok'); }
    catch (er) { toast(er.message, 'err', 6000); }
  });

  $('#exportJson').onclick = () => {
    const blob = new Blob([JSON.stringify({ test: { ...t, id: undefined }, key: parseKey(ED.keyText) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (t.title || 'test').replace(/[^\w\-]+/g, '_') + '.json'; a.click();
  };
  $('#importJson').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j.test?.content) throw new Error('Not a test backup file.');
      ED.test = { ...j.test, id: t.id }; ED.keyText = keyToText(j.key || {}); ED.dirty = true; drawEditor(); toast('Imported — check and save.', 'ok');
    } catch (er) { toast(er.message, 'err'); }
  };

  $('#edPreview').onclick = () => { ED.fromPreview = true; go('#/admin/preview', true); };
  $('#edSave').onclick = async () => {
    if (!t.title.trim()) return toast('Please add a title.', 'err');
    const btn = $('#edSave'); btn.disabled = true;
    try {
      const id = await api.saveTest(t, parseKey(ED.keyText));
      const wasNew = !t.id; t.id = id; ED.dirty = false;
      toast('Saved ✓', 'ok');
      if (wasNew) { ED.fromPreview = true; go('#/admin/test/' + id, true); } else btn.disabled = false;
    } catch (er) { toast(er.message, 'err'); btn.disabled = false; }
  };
  GUARD = () => (ED.dirty && !ED.fromPreview) ? 'You have unsaved changes. Leave without saving?' : null;
  window.onbeforeunload = () => ED.dirty ? true : undefined;
  runCheck();
}

let checkTimer = null;
function scheduleCheck() { clearTimeout(checkTimer); checkTimer = setTimeout(runCheck, 250); }
function runCheck() {
  const el = $('#checkList'); if (!el) return;
  const nums = allNumbers(ED.test.content).map(x => x.n);
  const key = parseKey(ED.keyText);
  const keyNums = Object.keys(key).map(Number);
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  const missing = nums.filter(n => !key[n]);
  const extra = keyNums.filter(n => !nums.includes(n));
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const gaps = sorted.length ? Array.from({ length: sorted[sorted.length - 1] - sorted[0] + 1 }, (_, i) => sorted[0] + i).filter(n => !sorted.includes(n)) : [];
  const items = [];
  items.push(`<div class="${nums.length ? 'ok' : 'warn'}">${nums.length ? `✓ ${nums.length} questions (${sorted[0]}–${sorted[sorted.length - 1]})` : '• No questions yet'}</div>`);
  if (dup.length) items.push(`<div class="bad">✗ Duplicate numbers: ${[...new Set(dup)].join(', ')}</div>`);
  if (gaps.length) items.push(`<div class="warn">• Skipped numbers: ${gaps.join(', ')}</div>`);
  items.push(missing.length ? `<div class="bad">✗ No answer for: ${missing.join(', ')}</div>` : nums.length ? `<div class="ok">✓ Every question has an answer</div>` : '');
  if (extra.length) items.push(`<div class="warn">• Key has answers with no question: ${extra.join(', ')}</div>`);
  if (ED.test.kind === 'listening' && !ED.test.audio_url) items.push(`<div class="warn">• No audio yet</div>`);
  if (ED.dirty) items.push(`<div class="muted">Unsaved changes</div>`);
  el.innerHTML = items.join('');
}

async function adminPreview() {
  if (!ED) return go('#/admin');
  ED.fromPreview = true;
  mountPlayer({ test: { ...ED.test, id: ED.test.id || 'preview' }, mode: 'preview', key: parseKey(ED.keyText), onExit: () => go('#/admin/test/' + (ED.test.id || 'new'), true) });
}

// ---------------- mocks ----------------
async function adminMocks() {
  const mocks = await api.listMocks();
  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><h1>Admin</h1><p>Schedule Sunday mocks and see who scored what.</p></div><a class="btn primary" href="#/admin/mock/new">+ New Sunday mock</a></div>
    ${adminTabs('mocks')}
    ${mocks.length ? `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Mock</th><th>Opens</th><th>Closes</th><th>Sections</th><th>Status</th><th>Results</th><th></th></tr></thead><tbody>
      ${mocks.map(m => { const st = mockState(m); return `<tr><td><b>${esc(m.title)}</b></td><td class="small">${fmt(m.starts_at)}</td><td class="small">${fmt(m.ends_at)}</td><td class="nums">${m.test_ids.length}</td>
        <td>${st === 'live' ? '<span class="badge live">● Live</span>' : st === 'upcoming' ? '<span class="badge">Upcoming</span>' : '<span class="badge">Closed</span>'}</td>
        <td>${m.results_released ? '<span class="badge ok">Released</span>' : '<span class="badge warn">Hidden</span>'}</td>
        <td><div class="row" style="justify-content:flex-end;gap:6px"><a class="btn sm primary" href="#/admin/mock/${m.id}/results">Results</a><a class="btn sm" href="#/admin/mock/${m.id}">Edit</a></div></td></tr>`; }).join('')}
    </tbody></table></div></div>` : `<div class="empty">No mocks yet. Create one for this Sunday.</div>`}
  </div>`, 'admin');
}

function toLocalInput(iso) {
  const d = new Date(iso); const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function nextSunday(h) {
  const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); d.setHours(h, 0, 0, 0); return d;
}

async function adminMockEditor(id) {
  const tests = await api.adminListTests();
  let m;
  if (id === 'new') {
    const s = nextSunday(10), e = nextSunday(13);
    m = { title: `Sunday Mock — ${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`, starts_at: s.toISOString(), ends_at: e.toISOString(), test_ids: [], password: Math.random().toString(36).slice(2, 8), results_released: false };
  } else m = await api.adminGetMock(id);
  const draw = () => {
    const chosen = m.test_ids.map(tid => tests.find(t => t.id === tid)).filter(Boolean);
    const warn = chosen.filter(t => t.visibility === 'practice');
    app.innerHTML = shell(`<div class="page narrow">
      <div class="page-head"><div><a href="#/admin/mocks" class="small">← All mocks</a><h1>${id === 'new' ? 'New Sunday mock' : 'Edit mock'}</h1></div></div>
      <form class="card" id="mf">
        <label class="field"><span>Title</span><input name="title" value="${esc(m.title)}" required></label>
        <div class="grid-2">
          <label class="field"><span>Opens (your local time)</span><input name="starts_at" type="datetime-local" value="${toLocalInput(m.starts_at)}" required></label>
          <label class="field"><span>Closes</span><input name="ends_at" type="datetime-local" value="${toLocalInput(m.ends_at)}" required></label>
        </div>
        <label class="field"><span>Password (share it in your Premium Channel when the mock starts)</span>
          <div class="row" style="flex-wrap:nowrap"><input class="input" name="password" value="${esc(m.password)}" placeholder="Leave empty for no password"><button type="button" class="btn" id="genpw">Generate</button></div></label>
        <div class="field"><span>Sections (students do them in this order)</span>
          ${chosen.map((t, i) => `<div class="sec-row"><span class="nums muted">${i + 1}</span>${kindBadge(t.kind)}<span class="t">${esc(t.title)}</span><span class="small muted">${t.duration_min} min · ${t.question_count} Q</span>
            <button type="button" class="btn sm ghost" data-mv="${i}:-1">↑</button><button type="button" class="btn sm ghost" data-mv="${i}:1">↓</button><button type="button" class="btn sm danger" data-rm="${i}">✕</button></div>`).join('') || '<div class="muted small">No sections yet.</div>'}
          <div class="row" style="flex-wrap:nowrap;margin-top:6px"><select class="input" id="addSec"><option value="">Add a test…</option>
            ${tests.filter(t => !m.test_ids.includes(t.id)).map(t => `<option value="${t.id}">${t.kind === 'listening' ? '🎧' : '📖'} ${esc(t.title)} — ${VIS[t.visibility][0]}</option>`).join('')}</select></div>
          ${warn.length ? `<div class="hint" style="margin-top:8px;color:var(--warn)">“${warn.map(t => esc(t.title)).join('”, “')}” is also a practice test, so students can see it before the mock. Set it to “Mock only” in the test editor.</div>` : ''}
        </div>
        <label class="check" style="margin-bottom:16px"><input type="checkbox" name="results_released" ${m.results_released ? 'checked' : ''}> Students can see their results</label>
        <div class="row between"><button class="btn primary">Save mock</button>${id !== 'new' ? '<button type="button" class="btn danger" id="delMock">Delete mock</button>' : ''}</div>
      </form></div>`, 'admin');
    const f = $('#mf');
    const sync = () => {
      m.title = f.title.value; m.password = f.password.value; m.results_released = f.results_released.checked;
      if (f.starts_at.value) m.starts_at = new Date(f.starts_at.value).toISOString();
      if (f.ends_at.value) m.ends_at = new Date(f.ends_at.value).toISOString();
    };
    $('#genpw').onclick = () => { f.password.value = Math.random().toString(36).slice(2, 8); };
    $('#addSec').onchange = e => { if (e.target.value) { sync(); m.test_ids.push(e.target.value); draw(); } };
    $$('[data-rm]').forEach(b => b.onclick = () => { sync(); m.test_ids.splice(+b.dataset.rm, 1); draw(); });
    $$('[data-mv]').forEach(b => b.onclick = () => {
      sync(); const [i, d] = b.dataset.mv.split(':').map(Number); const j = i + d;
      if (j < 0 || j >= m.test_ids.length) return; [m.test_ids[i], m.test_ids[j]] = [m.test_ids[j], m.test_ids[i]]; draw();
    });
    f.onsubmit = async e => {
      e.preventDefault(); sync();
      if (Date.parse(m.ends_at) <= Date.parse(m.starts_at)) return toast('Closing time must be after opening time.', 'err');
      if (!m.test_ids.length) return toast('Add at least one test.', 'err');
      try { await api.saveMock(m); toast('Mock saved ✓', 'ok'); go('#/admin/mocks'); } catch (er) { toast(er.message, 'err'); }
    };
    $('#delMock')?.addEventListener('click', async () => {
      if (!(await confirmBox('Delete mock?', 'The mock and all its submissions will be deleted.', 'Delete', 'danger'))) return;
      try { await api.deleteMock(id); go('#/admin/mocks'); } catch (er) { toast(er.message, 'err'); }
    });
  };
  draw();
}

async function adminMockResults(id) {
  const [m, tests, rows] = await Promise.all([api.adminGetMock(id), api.adminListTests(), api.mockResults(id)]);
  const secs = m.test_ids.map(tid => tests.find(t => t.id === tid) || { id: tid, title: '(deleted test)', kind: 'reading' });
  const byUser = {};
  rows.forEach(r => (byUser[r.user_id] ||= { name: r.profiles?.full_name || '—', tg: r.profiles?.telegram || '', rows: {} }).rows[r.test_id] = r);
  const students = Object.entries(byUser).map(([uid, u]) => {
    const done = secs.every(s => u.rows[s.id]?.status === 'submitted');
    const last = Object.values(u.rows).map(r => r.submitted_at).filter(Boolean).sort().pop();
    return { uid, ...u, done, last };
  }).sort((a, b) => (b.done - a.done) || a.name.localeCompare(b.name));
  const avgBand = sid => { const v = students.map(s => s.rows[sid]).filter(r => r?.status === 'submitted'); return v.length ? (v.reduce((a, r) => a + Number(r.band), 0) / v.length).toFixed(1) : '—'; };
  const wrong = r => Object.entries(r.detail || {}).filter(([n, d]) => /^\d+$/.test(n) && !d.ok).map(([n]) => n).join(', ');

  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><a href="#/admin/mocks" class="small">← All mocks</a><h1>${esc(m.title)}</h1><p>${fmtDay(m.starts_at)} → ${fmt(m.ends_at)} · password: <code>${esc(m.password || '—')}</code></p></div>
      <div class="row"><button class="btn" id="csv">Export CSV</button><button class="btn ${m.results_released ? '' : 'primary'}" id="rel">${m.results_released ? 'Hide results from students' : 'Release results to students'}</button></div></div>
    <div class="stat-row">
      <div class="stat"><b>${students.filter(s => s.done).length}</b><span>finished</span></div>
      <div class="stat"><b>${students.filter(s => !s.done).length}</b><span>started, not finished</span></div>
      ${secs.map(s => `<div class="stat"><b>${avgBand(s.id)}</b><span>average ${esc(s.title)}</span></div>`).join('')}
    </div>
    ${students.length ? `<div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Student</th>${secs.map(s => `<th>${esc(s.title)}</th>`).join('')}<th>Finished</th><th></th></tr></thead><tbody>
      ${students.map(s => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.tg)}</div></td>
        ${secs.map(sec => { const r = s.rows[sec.id]; if (!r) return '<td class="muted">—</td>';
          if (r.status !== 'submitted') return `<td><span class="badge warn">${r.opened_at ? 'In progress' : 'Not started'}</span></td>`;
          const w = wrong(r);
          return `<td><span class="band-big">${band(r.band)}</span> <span class="nums muted">${r.correct}/${r.total}</span>${r.detail?._late ? ' <span class="badge bad">late</span>' : ''}${w ? `<div class="wrong-list">✗ ${w}</div>` : ''}</td>`; }).join('')}
        <td class="small muted">${s.last ? fmt(s.last) : '—'}</td>
        <td><button class="btn sm danger" data-reset="${s.uid}" title="Delete this student's attempt so they can retake">Reset</button></td></tr>`).join('')}
    </tbody></table></div></div>` : `<div class="empty">No one has started this mock yet.</div>`}
  </div>`, 'admin');

  $('#rel').onclick = async () => { try { await api.setReleased(id, !m.results_released); toast(m.results_released ? 'Results hidden' : 'Results released ✓', 'ok'); route(); } catch (e) { toast(e.message, 'err'); } };
  $('#csv').onclick = () => {
    const head = ['Student', 'Telegram', ...secs.flatMap(s => [`${s.title} score`, `${s.title} band`]), 'Finished at'];
    const lines = students.map(s => [s.name, s.tg, ...secs.flatMap(sec => { const r = s.rows[sec.id]; return r?.status === 'submitted' ? [`${r.correct}/${r.total}`, band(r.band)] : ['', '']; }), s.last ? fmt(s.last) : '']);
    const csv = [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = m.title.replace(/[^\w\-]+/g, '_') + '.csv'; a.click();
  };
  $$('[data-reset]').forEach(b => b.onclick = async () => {
    const s = students.find(x => x.uid === b.dataset.reset);
    if (!(await confirmBox('Reset student?', `Delete ${esc(s.name)}'s answers for this mock so they can take it again?`, 'Reset', 'danger'))) return;
    try { for (const r of Object.values(s.rows)) await api.deleteAttempt(r.id); toast('Reset ✓', 'ok'); route(); } catch (e) { toast(e.message, 'err'); }
  });
}

async function adminLibrary() {
  const items = await loadLibrary();
  const ups = items.filter(i => i.src === 'upload');
  const builtIn = items.filter(i => i.src === 'static');
  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><h1>Admin</h1><p>Add the HTML tests you make, so students find them in the library.</p></div></div>
    ${adminTabs('library')}
    <div class="editor"><div>
      <div class="card"><h2>Uploaded tests</h2>
      ${ups.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Title</th><th>Type</th><th>Level</th><th>Added</th><th></th></tr></thead><tbody>
        ${ups.map(u => `<tr><td><a href="#/open/${encodeURIComponent(u.id)}"><b>${esc(u.title)}</b></a></td><td>${kindBadge(u.kind)}</td><td>${esc(u.level)}</td><td class="small muted">${esc(u.added)}</td><td><button class="btn sm danger" data-delu="${u.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nothing uploaded yet. New tests you upload appear here and at the top of the library.</p>'}</div>
      <div class="card"><h2>Built-in library</h2><p class="muted">${builtIn.length} tests ship with the website in the <code>library</code> folder: ${['reading', 'listening', 'mock'].map(k => `${builtIn.filter(i => i.kind === k).length} ${KIND_LABEL[k].toLowerCase()}`).join(', ')}. They are listed in <code>library/catalog.json</code>.</p></div>
    </div>
    <aside class="editor-side"><form class="card" id="upf"><h2 style="font-size:18px">Add an HTML test</h2>
      <label class="field"><span>HTML file</span><input type="file" name="file" accept=".html,.htm,text/html" required></label>
      <label class="field"><span>Title</span><input name="title" required placeholder="e.g. The History of Glass"></label>
      <label class="field"><span>Type</span><select name="kind" id="upk"><option value="reading">Reading</option><option value="listening">Listening</option><option value="mock">Full mock</option></select></label>
      <label class="field"><span>Level</span><select name="level" id="upl"></select></label>
      <button class="btn primary block">Upload test</button>
      <p class="small muted" style="margin-bottom:0">Up to 50 MB per file on the free plan.</p>
    </form></aside></div></div>`, 'admin');
  const f = $('#upf');
  const fillLevels = () => { $('#upl').innerHTML = LEVELS[f.kind.value].filter(l => l !== 'Website test').map(l => `<option>${l}</option>`).join(''); };
  f.kind.onchange = fillLevels; fillLevels();
  f.file.onchange = async () => {
    const file = f.file.files[0]; if (!file) return;
    const txt = await file.slice(0, 200000).text();
    const t = (txt.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    if (t && !f.title.value) f.title.value = t.replace(/\s*\|\s*@?ieltswithkhmdv.*$/i, '').replace(/^IELTS (Reading|Listening)( Test| Practice)?\s*[–—-]\s*/i, '').trim();
    if (/listening/i.test(t || '')) { f.kind.value = 'listening'; fillLevels(); }
    if (file.size > 3e6) { f.kind.value = 'mock'; fillLevels(); }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      await api.addLibraryItem({ title: f.title.value.trim(), kind: f.kind.value, level: f.level.value, file: f.file.files[0] });
      toast('Added to the library ✓', 'ok'); route();
    } catch (er) { toast(er.message, 'err', 6000); btn.disabled = false; btn.textContent = 'Upload test'; }
  };
  $$('[data-delu]').forEach(b => b.onclick = async () => {
    const u = ups.find(x => x.id === b.dataset.delu);
    if (!(await confirmBox('Delete this test?', `“${esc(u.title)}” will be removed from the library.`, 'Delete', 'danger'))) return;
    try { await api.deleteLibraryItem(u); toast('Deleted', 'ok'); route(); } catch (er) { toast(er.message, 'err'); }
  });
}

async function adminStudents() {
  const list = await api.listStudents();
  app.innerHTML = shell(`<div class="page">
    <div class="page-head"><div><h1>Admin</h1><p>${list.length} accounts</p></div></div>
    ${adminTabs('students')}
    <div class="card" style="padding:0"><div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Telegram</th><th>Joined</th><th>Role</th></tr></thead><tbody>
      ${list.map(p => `<tr><td><b>${esc(p.full_name || '—')}</b>${p.email ? `<div class="small muted">${esc(p.email)}</div>` : ''}</td><td>${esc(p.telegram || '')}</td><td class="small muted">${fmt(p.created_at, { dateStyle: 'medium' })}</td>
        <td>${p.id === ME.id ? '<span class="badge ok">You (admin)</span>' : `<label class="check small"><input type="checkbox" data-adm="${p.id}" ${p.is_admin ? 'checked' : ''}> Admin</label>`}</td></tr>`).join('')}
    </tbody></table></div></div></div>`, 'admin');
  $$('[data-adm]').forEach(c => c.onchange = async () => {
    try { await api.setAdmin(c.dataset.adm, c.checked); toast('Updated', 'ok'); } catch (e) { toast(e.message, 'err'); c.checked = !c.checked; }
  });
}

// ---------------------------------------------------------------------
if (api.demo) api.onTelegram = msg => toast('📨 Sent to your Telegram results channel:\n\n' + msg, 'tg', 9000);
api.recovery = async () => {
  const pw = await modal({ title: 'Set a new password', dismissable: false,
    body: '<label class="field"><span>New password (at least 6 characters)</span><input id="newpw" type="password" minlength="6"></label>',
    actions: [{ label: 'Save password', cls: 'primary', get: b => b.querySelector('#newpw').value }] });
  try { await api.setPassword(pw); toast('Password updated ✓', 'ok'); go('#/'); } catch (e) { toast(e.message, 'err'); api.recovery(); }
};
route();
