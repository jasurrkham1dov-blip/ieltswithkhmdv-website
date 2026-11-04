// =====================================================================
//  Turns the admin's plain-text test content into interactive HTML.
//  Formats (shown as hints in the admin builder):
//
//  PASSAGE / NOTES text
//    # Title            ## Subheading        blank line = new paragraph
//    [A] text           → lettered paragraph A
//    - item             → bullet list
//    | a | b |          → table row
//    **bold**  *italic*  ![](image-url)
//    [[5]]              → answer gap for question 5 (notes/summary/table/flow-chart)
//
//  QUESTION GROUP TYPES
//    tfng / ynng : one statement per line
//    mcq         : blocks separated by a blank line; first line = question,
//                  then "A ...", "B ..." options
//    multi       : question line + options; "picks" = how many to choose
//    matching    : one item per line; options box: "A text" per line (or i, ii, iii…)
//    gap         : notes/summary text with [[n]] gaps; options box = optional word bank
// =====================================================================

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GROUP_TYPES = {
  tfng:     'TRUE / FALSE / NOT GIVEN',
  ynng:     'YES / NO / NOT GIVEN',
  mcq:      'Multiple choice (one answer)',
  multi:    'Choose TWO / THREE letters',
  matching: 'Matching (headings, paragraphs, people, map…)',
  gap:      'Completion (notes, summary, table, sentence, flow-chart)',
};

function inline(s, gap) {
  let h = esc(s);
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img class="inline-img" src="${url}" alt="${alt}">`);
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
  if (gap) h = h.replace(/\[\[\s*(\d+)\s*\]\]/g, (_, n) => gap(+n));
  return h;
}

// Light markdown → HTML. `gap(n)` renders a [[n]] placeholder.
export function md(text, gap) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    const first = lines[0].trim();
    if (lines.every(l => /^\s*\|/.test(l))) {
      const rows = lines.filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
      out.push('<div class="table-wrap"><table class="q-table">' + rows.map((r, i) => {
        const cells = r.trim().replace(/^\||\|$/g, '').split('|');
        const tag = i === 0 ? 'th' : 'td';
        return '<tr>' + cells.map(c => `<${tag}>${inline(c.trim(), gap)}</${tag}>`).join('') + '</tr>';
      }).join('') + '</table></div>');
      continue;
    }
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
      out.push('<ul class="md-list">' + lines.map(l => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''), gap)}</li>`).join('') + '</ul>');
      continue;
    }
    // headings may be followed by more lines in the same block
    const rest = [];
    let i = 0;
    while (i < lines.length && /^#{1,3}\s/.test(lines[i].trim())) {
      const l = lines[i].trim();
      const lvl = l.match(/^#+/)[0].length;
      out.push(`<h${lvl + 1} class="md-h${lvl}">${inline(l.replace(/^#+\s*/, ''), gap)}</h${lvl + 1}>`);
      i++;
    }
    for (; i < lines.length; i++) rest.push(lines[i]);
    if (!rest.length) continue;
    // mixed block: bullets after a heading line
    if (rest.every(l => /^\s*[-•]\s+/.test(l))) {
      out.push('<ul class="md-list">' + rest.map(l => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''), gap)}</li>`).join('') + '</ul>');
      continue;
    }
    const para = rest.join('\n');
    const m = para.trim().match(/^\[([A-Z])\]\s*([\s\S]*)$/);
    if (m) {
      out.push(`<p class="para lettered" data-para="${m[1]}"><span class="para-letter">${m[1]}</span><span>${inline(m[2], gap).replace(/\n/g, '<br>')}</span></p>`);
    } else {
      out.push(`<p class="para">${rest.map(l => /^\s*[-•]\s+/.test(l) ? '• ' + inline(l.replace(/^\s*[-•]\s+/, ''), gap) : inline(l, gap)).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

function stripNum(s) { return s.replace(/^\s*\d+\s*[.)]?\s+/, '').trim(); }
const OPT_RE = /^\s*([A-Z]|[ivx]{1,5})\s*[.)\-:]?\s+(.*)$/;
const OPT_ONLY_RE = /^\s*([A-Z]|[ivx]{1,5})\s*[.)]?\s*$/;

export function parseOptions(text) {
  const opts = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    let m = l.match(OPT_RE);
    if (m) { opts.push({ v: m[1], t: m[2].trim() }); continue; }
    m = l.match(OPT_ONLY_RE);
    if (m) { opts.push({ v: m[1], t: '' }); continue; }
    // a bare word (word bank without letters) → letter it automatically
    opts.push({ v: String.fromCharCode(65 + opts.length), t: l });
  }
  return opts;
}

// Parse one group into a list of questions: [{n, text, options?}]
export function parseGroup(g) {
  const from = +g.from || 1;
  const body = String(g.body || '').replace(/\r/g, '');
  switch (g.type) {
    case 'tfng':
    case 'ynng':
    case 'matching':
      return body.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => ({ n: from + i, text: stripNum(l) }));
    case 'mcq': {
      const qs = [];
      body.split(/\n\s*\n/).forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const stem = [], options = [];
        for (const l of lines) {
          const m = l.match(/^([A-H])\s*[.)]?\s+(.*)$/);
          if (m && (options.length || stem.length)) options.push({ v: m[1], t: m[2] });
          else stem.push(stripNum(l));
        }
        qs.push({ n: from + qs.length, text: stem.join(' '), options });
      });
      return qs;
    }
    case 'multi': {
      const picks = Math.max(1, +g.picks || 2);
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      const stem = [], options = [];
      for (const l of lines) {
        const m = l.match(/^([A-H])\s*[.)]?\s+(.*)$/);
        if (m && stem.length) options.push({ v: m[1], t: m[2] }); else stem.push(stripNum(l));
      }
      return Array.from({ length: picks }, (_, i) => ({ n: from + i, text: stem.join(' '), options, picks }));
    }
    case 'gap': {
      const nums = [...body.matchAll(/\[\[\s*(\d+)\s*\]\]/g)].map(m => +m[1]);
      return nums.map(n => ({ n }));
    }
  }
  return [];
}

export function groupNumbers(g) { return parseGroup(g).map(q => q.n); }

export function allNumbers(content) {
  const out = [];
  (content?.parts || []).forEach((p, pi) => (p.groups || []).forEach(g => {
    for (const n of groupNumbers(g)) out.push({ n, part: pi });
  }));
  return out;
}

export function rangeLabel(nums) {
  if (!nums.length) return '';
  const a = Math.min(...nums), b = Math.max(...nums);
  return a === b ? `Question ${a}` : `Questions ${a}–${b}`;
}

// ---------------------------------------------------------------------
// Render a group of questions (inputs carry data-q="n")
// ---------------------------------------------------------------------
export function renderGroup(g) {
  const qs = parseGroup(g);
  const nums = qs.map(q => q.n);
  const head = `<div class="group-head"><div class="group-range">${rangeLabel(nums)}</div>
    ${g.instructions ? `<div class="group-instr">${md(g.instructions)}</div>` : ''}</div>`;
  const img = g.image ? `<div class="group-img"><img src="${esc(g.image)}" alt=""></div>` : '';
  let inner = '';

  if (g.type === 'tfng' || g.type === 'ynng') {
    const choices = g.type === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
    inner = qs.map(q => `<div class="q" id="q-${q.n}" data-qbox="${q.n}">
      <div class="q-line"><span class="q-num">${q.n}</span><span class="q-text">${inline(q.text)}</span></div>
      <div class="pills">${choices.map(c => `<label class="pill"><input type="radio" name="q${q.n}" value="${c}" data-q="${q.n}"><span>${c}</span></label>`).join('')}</div>
      <div class="q-feedback"></div></div>`).join('');
  }

  if (g.type === 'mcq') {
    inner = qs.map(q => `<div class="q" id="q-${q.n}" data-qbox="${q.n}">
      <div class="q-line"><span class="q-num">${q.n}</span><span class="q-text">${inline(q.text)}</span></div>
      <div class="mcq">${q.options.map(o => `<label class="mcq-opt"><input type="radio" name="q${q.n}" value="${o.v}" data-q="${q.n}"><span class="opt-letter">${o.v}</span><span>${inline(o.t)}</span></label>`).join('')}</div>
      <div class="q-feedback"></div></div>`).join('');
  }

  if (g.type === 'multi' && qs.length) {
    const q = qs[0];
    inner = `<div class="q multi" id="q-${q.n}" data-multi="${nums.join(',')}" data-picks="${q.picks}">
      ${nums.map(n => `<span id="q-${n}" class="anchor" data-qbox="${n}"></span>`).join('')}
      <div class="q-line"><span class="q-num">${nums[0]}–${nums[nums.length - 1]}</span><span class="q-text">${inline(q.text)}</span></div>
      <div class="mcq">${q.options.map(o => `<label class="mcq-opt"><input type="checkbox" value="${o.v}" data-multi-input="${nums.join(',')}"><span class="opt-letter">${o.v}</span><span>${inline(o.t)}</span></label>`).join('')}</div>
      <div class="q-feedback"></div></div>`;
  }

  if (g.type === 'matching') {
    const opts = parseOptions(g.options);
    const hasText = opts.some(o => o.t);
    const box = hasText ? `<div class="opt-box">${g.optionsTitle ? `<div class="opt-box-title">${esc(g.optionsTitle)}</div>` : ''}
      ${opts.map(o => `<div class="opt-row"><span class="opt-letter">${o.v}</span><span>${inline(o.t)}</span></div>`).join('')}</div>` : '';
    inner = box + qs.map(q => `<div class="q match-row" id="q-${q.n}" data-qbox="${q.n}">
      <div class="q-line"><span class="q-num">${q.n}</span><span class="q-text">${inline(q.text)}</span>
      <select class="match-select" data-q="${q.n}"><option value=""></option>${opts.map(o => `<option value="${o.v}">${o.v}</option>`).join('')}</select></div>
      <div class="q-feedback"></div></div>`).join('');
  }

  if (g.type === 'gap') {
    const bank = parseOptions(g.options);
    const box = bank.length ? `<div class="opt-box">${g.optionsTitle ? `<div class="opt-box-title">${esc(g.optionsTitle)}</div>` : ''}
      ${bank.map(o => `<div class="opt-row"><span class="opt-letter">${o.v}</span><span>${inline(o.t)}</span></div>`).join('')}</div>` : '';
    const gap = n => bank.length
      ? `<span class="gap" id="q-${n}" data-qbox="${n}"><span class="gap-num">${n}</span><select class="gap-select" data-q="${n}"><option value=""></option>${bank.map(o => `<option value="${o.v}">${o.v}</option>`).join('')}</select><span class="gap-fb"></span></span>`
      : `<span class="gap" id="q-${n}" data-qbox="${n}"><span class="gap-num">${n}</span><input class="gap-input" type="text" autocomplete="off" spellcheck="false" data-q="${n}"><span class="gap-fb"></span></span>`;
    inner = box + `<div class="notes-box">${md(g.body, gap)}</div>`;
  }

  return `<section class="group" data-type="${g.type}">${head}${img}${inner}</section>`;
}
