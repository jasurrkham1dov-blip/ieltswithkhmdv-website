// =====================================================================
//  Data layer. Two interchangeable backends with the same methods:
//   • SupabaseBackend — the real site (accounts, database, Telegram)
//   • DemoBackend     — everything stored in this browser, for trying it out
// =====================================================================
import { CONFIG } from './config.js';
import { score } from './scoring.js';
import { allNumbers } from './render.js';
import { DEMO_SEED } from './demo-data.js';

const qCount = content => allNumbers(content).length;

// ---------------------------------------------------------------------
class SupabaseBackend {
  constructor() {
    this.demo = false;
    this.sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    this.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') setTimeout(() => this.recovery?.(), 300); });
  }
  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }
  async _fn(name, body) {
    const { data, error } = await this.sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  _chk({ data, error }) { if (error) throw new Error(error.message); return data; }

  // ---- auth ----
  async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user || null;
  }
  onAuth(cb) { this.sb.auth.onAuthStateChange((_e, s) => cb(s?.user || null)); }
  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }
  async signUp({ email, password, full_name, telegram }) {
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { full_name, telegram } },
    });
    if (error) throw new Error(error.message);
    return { needsConfirm: !data.session };
  }
  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw new Error(error.message);
  }
  async signOut() { await this.sb.auth.signOut(); }
  async profile() {
    const u = await this.session(); if (!u) return null;
    const p = this._chk(await this.sb.from('profiles').select('*').eq('id', u.id).maybeSingle());
    return p ? { ...p, email: u.email } : { id: u.id, email: u.email, full_name: '', telegram: '', is_admin: false };
  }
  async updateProfile(fields) {
    const u = await this.session();
    this._chk(await this.sb.from('profiles').update(fields).eq('id', u.id));
  }

  // ---- tests ----
  async listPracticeTests() {
    return this._chk(await this.sb.from('tests').select('id,title,kind,duration_min,question_count,created_at')
      .eq('visibility', 'practice').order('created_at', { ascending: false }));
  }
  async adminListTests() {
    return this._chk(await this.sb.from('tests').select('id,title,kind,duration_min,visibility,question_count,updated_at')
      .order('updated_at', { ascending: false }));
  }
  async getTest(id) { return this._chk(await this.sb.from('tests').select('*').eq('id', id).single()); }
  async getKey(id) {
    const r = this._chk(await this.sb.from('test_keys').select('answers').eq('test_id', id).maybeSingle());
    return r?.answers || {};
  }
  async saveTest(t, key) {
    const row = {
      title: t.title, kind: t.kind, duration_min: +t.duration_min || 60, visibility: t.visibility,
      audio_url: t.audio_url || '', strict_audio: !!t.strict_audio, content: t.content,
      question_count: qCount(t.content), updated_at: new Date().toISOString(),
    };
    let id = t.id;
    if (id) this._chk(await this.sb.from('tests').update(row).eq('id', id));
    else id = this._chk(await this.sb.from('tests').insert(row).select('id').single()).id;
    this._chk(await this.sb.from('test_keys').upsert({ test_id: id, answers: key }));
    return id;
  }
  async deleteTest(id) { this._chk(await this.sb.from('tests').delete().eq('id', id)); }
  async uploadAudio(file) {
    const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await this.sb.storage.from('audio').upload(path, file, { upsert: false, contentType: file.type || 'audio/mpeg' });
    if (error) throw new Error(error.message);
    return this.sb.storage.from('audio').getPublicUrl(path).data.publicUrl;
  }

  // ---- mocks ----
  async listMocks() {
    return this._chk(await this.sb.from('mocks').select('*').order('starts_at', { ascending: false }));
  }
  async adminGetMock(id) {
    const m = this._chk(await this.sb.from('mocks').select('*').eq('id', id).single());
    const s = this._chk(await this.sb.from('mock_secrets').select('password').eq('mock_id', id).maybeSingle());
    return { ...m, password: s?.password || '' };
  }
  async saveMock(m) {
    const row = { title: m.title, starts_at: m.starts_at, ends_at: m.ends_at, test_ids: m.test_ids, results_released: !!m.results_released };
    let id = m.id;
    if (id) this._chk(await this.sb.from('mocks').update(row).eq('id', id));
    else id = this._chk(await this.sb.from('mocks').insert(row).select('id').single()).id;
    this._chk(await this.sb.from('mock_secrets').upsert({ mock_id: id, password: m.password || '' }));
    return id;
  }
  async deleteMock(id) { this._chk(await this.sb.from('mocks').delete().eq('id', id)); }
  async setReleased(id, v) { this._chk(await this.sb.from('mocks').update({ results_released: v }).eq('id', id)); }
  async startMock(mock_id, password) { return this._fn('start-mock', { mock_id, password }); }
  async openSection(mock_id, test_id) { return this._fn('submit-attempt', { action: 'open', mock_id, test_id }); }
  async myMockProgress(mock_id) {
    return this._chk(await this.sb.rpc('my_mock_progress', { p_mock: mock_id })) || [];
  }

  // ---- attempts ----
  async submit({ test_id, mock_id, answers, opened_at }) {
    return this._fn('submit-attempt', { action: 'submit', test_id, mock_id: mock_id || null, answers, opened_at });
  }
  async myAttempts() {
    const u = await this.session();
    return this._chk(await this.sb.from('attempts')
      .select('id,test_id,mock_id,correct,total,band,submitted_at,detail,answers,test_title,test_kind,mocks(title)')
      .eq('user_id', u.id).eq('status', 'submitted').order('submitted_at', { ascending: false }));
  }
  async mockResults(mock_id) {
    const rows = this._chk(await this.sb.from('attempts')
      .select('id,user_id,test_id,status,correct,total,band,opened_at,submitted_at,detail,profiles(full_name,telegram)')
      .eq('mock_id', mock_id));
    return rows;
  }
  async deleteAttempt(id) { this._chk(await this.sb.from('attempts').delete().eq('id', id)); }
  // ---- library uploads ----
  async listLibraryUploads() {
    return this._chk(await this.sb.from('library_items').select('*').order('created_at', { ascending: false }));
  }
  async addLibraryItem({ title, kind, level, file }) {
    const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await this.sb.storage.from('library').upload(path, file, { contentType: 'text/plain', upsert: false });
    if (error) throw new Error(error.message);
    this._chk(await this.sb.from('library_items').insert({ title, kind, level, path, size: file.size }));
  }
  async deleteLibraryItem(it) {
    await this.sb.storage.from('library').remove([it.path]);
    this._chk(await this.sb.from('library_items').delete().eq('id', it.id));
  }
  async libraryHtml(it) {
    const { data, error } = await this.sb.storage.from('library').download(it.path);
    if (error) throw new Error(error.message);
    return await data.text();
  }
  async listStudents() {
    return this._chk(await this.sb.from('profiles').select('*').order('created_at', { ascending: false }));
  }
  async setAdmin(id, v) { this._chk(await this.sb.from('profiles').update({ is_admin: v }).eq('id', id)); }
}

// ---------------------------------------------------------------------
//  DEMO: same behaviour, stored in localStorage (falls back to memory)
// ---------------------------------------------------------------------
const LS_KEY = 'khmdv-demo-db-v1';
let memoryStore = null;
function load() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch {}
  if (memoryStore) return memoryStore;
  return JSON.parse(JSON.stringify(DEMO_SEED()));
}
function save(db) {
  memoryStore = db;
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {}
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class DemoBackend {
  constructor() { this.demo = true; this.listeners = []; this.onTelegram = null; }
  db() { return load(); }
  _me(db = load()) { return db.profiles.find(p => p.id === db.session) || null; }
  _need(admin) {
    const db = load(); const me = this._me(db);
    if (!me) throw new Error('Please log in again.');
    if (admin && !me.is_admin) throw new Error('Admins only.');
    return { db, me };
  }
  resetDemo() { try { localStorage.removeItem(LS_KEY); } catch {} memoryStore = null; }

  async session() { const me = this._me(); return me ? { id: me.id, email: me.email } : null; }
  onAuth(cb) { this.listeners.push(cb); }
  _emit() { this.session().then(u => this.listeners.forEach(cb => cb(u))); }
  async signIn(email, password) {
    await sleep(150);
    const db = load();
    const u = db.users.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase() && x.password === password);
    if (!u) throw new Error('Invalid login credentials');
    db.session = u.id; save(db); this._emit();
  }
  async signUp({ email, password, full_name, telegram }) {
    const db = load();
    if (db.users.some(x => x.email.toLowerCase() === email.toLowerCase())) throw new Error('User already registered');
    if (String(password).length < 6) throw new Error('Password should be at least 6 characters.');
    const id = uid();
    db.users.push({ id, email, password });
    db.profiles.push({ id, email, full_name, telegram, phone: '', is_admin: false, created_at: new Date().toISOString() });
    db.session = id; save(db); this._emit();
    return { needsConfirm: false };
  }
  async resetPassword() { throw new Error('In demo mode passwords can’t be reset — use the demo accounts.'); }
  async signOut() { const db = load(); db.session = null; save(db); this._emit(); }
  async profile() { return this._me(); }
  async updateProfile(f) { const { db, me } = this._need(); Object.assign(me, { full_name: f.full_name ?? me.full_name, telegram: f.telegram ?? me.telegram }); save(db); }

  async listPracticeTests() { this._need(); return load().tests.filter(t => t.visibility === 'practice').map(t => ({ ...t, content: undefined })); }
  async adminListTests() { this._need(true); return load().tests.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); }
  async getTest(id) {
    const { db, me } = this._need();
    const t = db.tests.find(x => x.id === id);
    if (!t || (t.visibility !== 'practice' && !me.is_admin)) throw new Error('Test not found.');
    return t;
  }
  async getKey(id) { const { db } = this._need(true); return db.keys[id] || {}; }
  async saveTest(t, key) {
    const { db } = this._need(true);
    const row = { ...t, duration_min: +t.duration_min || 60, question_count: qCount(t.content), updated_at: new Date().toISOString() };
    if (!row.id) { row.id = uid(); row.created_at = row.updated_at; db.tests.push(row); }
    else db.tests[db.tests.findIndex(x => x.id === row.id)] = row;
    db.keys[row.id] = key; save(db); return row.id;
  }
  async deleteTest(id) {
    const { db } = this._need(true);
    db.tests = db.tests.filter(t => t.id !== id); delete db.keys[id];
    db.attempts = db.attempts.filter(a => a.test_id !== id);
    db.mocks.forEach(m => m.test_ids = m.test_ids.filter(x => x !== id)); save(db);
  }
  async uploadAudio(file) { return URL.createObjectURL(file); }

  async listMocks() { this._need(); return load().mocks.slice().sort((a, b) => b.starts_at.localeCompare(a.starts_at)); }
  async adminGetMock(id) { const { db } = this._need(true); const m = db.mocks.find(x => x.id === id); return { ...m, password: db.secrets[id] || '' }; }
  async saveMock(m) {
    const { db } = this._need(true);
    const row = { id: m.id, title: m.title, starts_at: m.starts_at, ends_at: m.ends_at, test_ids: m.test_ids, results_released: !!m.results_released };
    if (!row.id) { row.id = uid(); row.created_at = new Date().toISOString(); db.mocks.push(row); }
    else db.mocks[db.mocks.findIndex(x => x.id === row.id)] = { ...db.mocks.find(x => x.id === row.id), ...row };
    db.secrets[row.id] = m.password || ''; save(db); return row.id;
  }
  async deleteMock(id) { const { db } = this._need(true); db.mocks = db.mocks.filter(m => m.id !== id); db.attempts = db.attempts.filter(a => a.mock_id !== id); save(db); }
  async setReleased(id, v) { const { db } = this._need(true); db.mocks.find(m => m.id === id).results_released = v; save(db); }

  async startMock(mock_id, password) {
    await sleep(200);
    const { db, me } = this._need();
    const mock = db.mocks.find(m => m.id === mock_id);
    if (!mock) throw new Error('Mock test not found.');
    const now = Date.now();
    if (now < Date.parse(mock.starts_at)) throw new Error("This mock test hasn't opened yet.");
    if (now > Date.parse(mock.ends_at)) throw new Error('This mock test is closed.');
    const pw = (db.secrets[mock_id] || '').trim();
    if (pw && String(password || '').trim() !== pw) throw new Error('Wrong password.');
    for (const tid of mock.test_ids) {
      if (!db.attempts.find(a => a.mock_id === mock_id && a.user_id === me.id && a.test_id === tid))
        db.attempts.push({ id: uid(), user_id: me.id, test_id: tid, mock_id, status: 'started', answers: {}, started_at: new Date().toISOString(), opened_at: null });
    }
    save(db);
    const tests = mock.test_ids.map(id => db.tests.find(t => t.id === id)).filter(Boolean);
    const progress = db.attempts.filter(a => a.mock_id === mock_id && a.user_id === me.id).map(a => ({ test_id: a.test_id, status: a.status, opened_at: a.opened_at, submitted_at: a.submitted_at }));
    return { server_now: new Date().toISOString(), mock: { id: mock.id, title: mock.title, ends_at: mock.ends_at }, tests, progress };
  }
  async openSection(mock_id, test_id) {
    const { db, me } = this._need();
    const a = db.attempts.find(x => x.mock_id === mock_id && x.user_id === me.id && x.test_id === test_id);
    if (!a) throw new Error('Enter the mock password first.');
    if (a.status === 'submitted') throw new Error('This section was already submitted.');
    if (!a.opened_at) { a.opened_at = new Date().toISOString(); save(db); }
    return { ok: true, opened_at: a.opened_at, server_now: new Date().toISOString() };
  }
  async myMockProgress(mock_id) {
    const { db, me } = this._need();
    return db.attempts.filter(a => a.mock_id === mock_id && a.user_id === me.id).map(a => ({ test_id: a.test_id, status: a.status, submitted_at: a.submitted_at }));
  }
  async submit({ test_id, mock_id, answers, opened_at }) {
    await sleep(250);
    const { db, me } = this._need();
    const test = db.tests.find(t => t.id === test_id);
    const r = score(test.content, db.keys[test_id] || {}, answers, test.kind);
    const now = new Date().toISOString();
    if (!mock_id) {
      db.attempts.push({ id: uid(), user_id: me.id, test_id, mock_id: null, status: 'submitted', answers, ...r, opened_at, submitted_at: now });
      save(db);
      return { ok: true, released: true, ...r, transcripts: (test.content.parts || []).map(p => p.transcript || '') };
    }
    const mock = db.mocks.find(m => m.id === mock_id);
    const a = db.attempts.find(x => x.mock_id === mock_id && x.user_id === me.id && x.test_id === test_id);
    if (!a) throw new Error('Enter the mock password first.');
    if (a.status === 'submitted') throw new Error('This section was already submitted.');
    Object.assign(a, { status: 'submitted', answers, correct: r.correct, total: r.total, band: r.band, detail: r.detail, submitted_at: now });
    save(db);
    const mine = db.attempts.filter(x => x.mock_id === mock_id && x.user_id === me.id);
    const finished = mock.test_ids.every(id => mine.find(x => x.test_id === id && x.status === 'submitted'));
    if (finished && this.onTelegram) {
      const lines = mock.test_ids.map(id => {
        const t = db.tests.find(x => x.id === id); const at = mine.find(x => x.test_id === id);
        return `${t.kind === 'listening' ? '🎧' : '📖'} ${t.title}: ${at.correct}/${at.total} — Band ${Number(at.band).toFixed(1)}`;
      });
      this.onTelegram([`🧾 ${mock.title}`, `👤 ${me.full_name}${me.telegram ? ' (' + me.telegram + ')' : ''}`, ...lines].join('\n'));
    }
    if (mock.results_released) return { ok: true, released: true, ...r };
    return { ok: true, released: false, finished };
  }
  async myAttempts() {
    const { db, me } = this._need();
    return db.attempts.filter(a => a.user_id === me.id && a.status === 'submitted')
      .filter(a => !a.mock_id || db.mocks.find(m => m.id === a.mock_id)?.results_released)
      .map(a => ({ ...a, test_title: db.tests.find(t => t.id === a.test_id)?.title || '', test_kind: db.tests.find(t => t.id === a.test_id)?.kind || '', mocks: a.mock_id ? db.mocks.find(m => m.id === a.mock_id) : null }))
      .sort((x, y) => (y.submitted_at || '').localeCompare(x.submitted_at || ''));
  }
  async mockResults(mock_id) {
    const { db } = this._need(true);
    return db.attempts.filter(a => a.mock_id === mock_id).map(a => ({ ...a, profiles: db.profiles.find(p => p.id === a.user_id) || {} }));
  }
  async deleteAttempt(id) { const { db } = this._need(true); db.attempts = db.attempts.filter(a => a.id !== id); save(db); }
  async listLibraryUploads() { return (this.uploads || []).slice(); }
  async addLibraryItem({ title, kind, level, file }) {
    this._need(true);
    (this.uploads ||= []).unshift({ id: uid(), title, kind, level, html: await file.text(), created_at: new Date().toISOString() });
  }
  async deleteLibraryItem(it) { this.uploads = (this.uploads || []).filter(u => u.id !== it.id); }
  async libraryHtml(it) { return (this.uploads || []).find(u => u.id === it.id)?.html || ''; }
  async listStudents() { this._need(true); return load().profiles.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); }
  async setAdmin(id, v) { const { db } = this._need(true); db.profiles.find(p => p.id === id).is_admin = v; save(db); }
}

export function createBackend() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) return new SupabaseBackend();
  return new DemoBackend();
}
