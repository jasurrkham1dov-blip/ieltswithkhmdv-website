// =====================================================================
//  Shared scoring logic — used by the website (demo/preview) AND by the
//  server functions (a copy lives in supabase/functions/_shared/).
//  If you edit one copy, copy it over the other.
// =====================================================================

// lowercase, trim, collapse spaces, strip trailing punctuation & quotes
export function nm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

const SHORT = { t: 'true', f: 'false', ng: 'not given', y: 'yes', n: 'no' };

// "(the) coffee" → ["the coffee", "coffee"]
export function expandOptional(ans) {
  let out = [ans];
  const re = /\(([^()]+)\)/;
  while (out.some(a => re.test(a))) {
    const next = [];
    for (const a of out) {
      const m = a.match(re);
      if (!m) { next.push(a); continue; }
      next.push(a.replace(m[0], m[1]));
      next.push(a.replace(m[0], ''));
    }
    out = next;
  }
  return [...new Set(out.map(nm).filter(Boolean))];
}

// Normalise one accepted answer from the key
export function keyAnswer(a) {
  const x = nm(a);
  return SHORT[x] || x;
}

// Parse the admin's answer-key text:
//   1 TRUE
//   2. coffee / coffees
//   3) (the) river
//   21-22 B, D        ← choose-two: letters shared by both numbers
export function parseKey(text) {
  const key = {};
  const lines = String(text || '').split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?\s*[.):\-–]?\s+(.+)$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    const rest = m[3].trim();
    if (b > a) {
      const letters = rest.split(/[\s,/&]+|and/i).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]$/.test(s));
      for (let n = a; n <= b; n++) key[n] = letters.map(l => l.toLowerCase());
    } else {
      const alts = rest.split(/\s*(?:\/|\||\bOR\b)\s*/).filter(Boolean);
      const all = [];
      for (const alt of alts) for (const e of expandOptional(alt)) all.push(SHORT[e] || e);
      key[a] = [...new Set(all)];
    }
  }
  return key;
}

// Turn a stored key object back into editable text
export function keyToText(key) {
  return Object.keys(key || {}).map(Number).sort((a, b) => a - b)
    .map(n => `${n} ${(key[n] || []).map(a => /^(true|false|not given|yes|no|[a-h])$/.test(a) ? a.toUpperCase() : a).join(' / ')}`).join('\n');
}

// Which question numbers belong to "choose TWO/THREE" groups
export function multiGroups(content) {
  const out = [];
  for (const p of content?.parts || []) for (const g of p.groups || []) {
    if (g.type === 'multi') {
      const picks = Math.max(1, +g.picks || 2);
      const from = +g.from || 1;
      out.push(Array.from({ length: picks }, (_, i) => from + i));
    }
  }
  return out;
}

// Official-style conversion tables (40 questions). Shorter tests are scaled.
const LISTENING = [[39,9],[37,8.5],[35,8],[32,7.5],[30,7],[26,6.5],[23,6],[18,5.5],[16,5],[13,4.5],[10,4],[8,3.5],[6,3],[4,2.5],[2,2],[1,1],[0,0]];
const READING   = [[39,9],[37,8.5],[35,8],[33,7.5],[30,7],[27,6.5],[23,6],[19,5.5],[15,5],[13,4.5],[10,4],[8,3.5],[6,3],[4,2.5],[2,2],[1,1],[0,0]];
export function bandFor(kind, correct, total) {
  if (!total) return 0;
  const scaled = Math.round((correct / total) * 40);
  const table = kind === 'listening' ? LISTENING : READING;
  for (const [min, band] of table) if (scaled >= min) return band;
  return 0;
}

// answers: {"1":"TRUE","2":"coffee","21":"B","22":"D"}
// key:     {"1":["true"],"2":["coffee"],"21":["b","d"],"22":["b","d"]}
export function score(content, key, answers, kind) {
  const detail = {};
  let correct = 0;
  const nums = Object.keys(key || {}).map(Number).sort((a, b) => a - b);
  const done = new Set();

  // choose-two/three groups: any order, one mark per correct letter
  for (const grp of multiGroups(content)) {
    if (!grp.some(n => key[n])) continue;
    const pool = new Set(grp.flatMap(n => (key[n] || []).map(nm)));
    const given = grp.map(n => nm(answers?.[n])).filter(Boolean);
    const used = new Set();
    const expected = [...pool].map(s => s.toUpperCase()).join(', ');
    grp.forEach((n, i) => {
      const g = given[i];
      const ok = !!g && pool.has(g) && !used.has(g);
      if (ok) { used.add(g); correct++; }
      detail[n] = { given: g ? g.toUpperCase() : '', ok, expected };
      done.add(n);
    });
  }

  for (const n of nums) {
    if (done.has(n)) continue;
    const accepted = (key[n] || []).map(nm);
    const raw = answers?.[n];
    const g = nm(raw);
    const gNorm = SHORT[g] && accepted.includes(SHORT[g]) ? SHORT[g] : g;
    const ok = !!g && accepted.includes(gNorm);   // empty answer is never correct
    if (ok) correct++;
    detail[n] = { given: String(raw ?? '').trim(), ok, expected: (key[n] || []).join(' / ') };
  }
  const total = nums.length;
  return { correct, total, band: bandFor(kind, correct, total), detail };
}
