'use strict';

// ── SCALES ───────────────────────────────────────────────────────────────────
const SCALES = {
  C_major:  ['C','D','E','F','G','A','B'],
  G_major:  ['G','A','B','C','D','E','F#'],
  D_major:  ['D','E','F#','G','A','B','C#'],
  F_major:  ['F','G','A','Bb','C','D','E'],
  Bb_major: ['Bb','C','D','Eb','F','G','A'],
  A_minor:  ['A','B','C','D','E','F','G'],
  E_minor:  ['E','F#','G','A','B','C','D'],
  D_minor:  ['D','E','F','G','A','Bb','C'],
};

const NOTE_SEMITONES = {
  'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,
  'E':4,'E#':5,'Fb':4,'F':5,'F#':6,'Gb':6,
  'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,
  'B':11,'B#':12,'Cb':-1,
};

const DUR_NAMES = {
  1:'whole', 2:'half', 4:'quarter', 8:'eighth', 16:'sixteenth', 32:'thirty-second'
};

// Returns the raw semitone value (0-11) of a note name, ignoring accidentals shift
function noteSemi(name) {
  return ((NOTE_SEMITONES[name] ?? 0) + 12) % 12;
}

// Given a scale and a 1-based degree, return the note name at that scale degree.
function resolveScaleDegree(scale, deg) {
  return scale[deg - 1];
}

// Octaves are anchored to the key's tonic.
// In D_minor, octave 1 spans D4 up to C5, and octave 0 spans D3 up to C4.
// The octave bucket follows the scale degree slot in the key, even if the
// final note is altered with + or -.
function noteToFreq(noteName, keyRoot, tonicOctave, octaveAnchorName = noteName) {
  const semi = NOTE_SEMITONES[noteName];
  if (semi === undefined) return null;
  const sciOctave = resolveScientificOctave(keyRoot, tonicOctave, octaveAnchorName);
  const semiFromA4 = (sciOctave - 4) * 12 + semi - 9;
  return 440 * Math.pow(2, semiFromA4 / 12);
}

function resolveScientificOctave(keyRoot, tonicOctave, octaveAnchorName) {
  const rootSemi = noteSemi(keyRoot);
  const anchorSemi = noteSemi(octaveAnchorName);
  return tonicOctave + 3 + (anchorSemi < rootSemi ? 1 : 0);
}

function calcBeats(denom, suffix) {
  const base = 4 / denom;
  if (suffix === 't')  return base * (2/3);
  if (suffix === '.')  return base * 1.5;
  if (suffix === '..') return base * 1.75;
  return base;
}

// Parse time signature string like "4-4", "3-4", "6-8"
// Returns { beats, denom } or null
function parseTimeSig(str) {
  const m = str.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { beats: parseInt(m[1]), denom: parseInt(m[2]) };
}

// Beats per measure from time sig (e.g. 4/4 = 4 quarter-note beats)
function beatsPerMeasure(timeSig) {
  // beats is the numerator, denom is the note value (4 = quarter, 8 = eighth...)
  // One beat = 1 quarter note = 1.0 in our beat unit
  // A quarter note in denom=4 is 1 beat; in denom=8 each beat is 0.5 quarter notes
  return timeSig.beats * (4 / timeSig.denom);
}

const EXAMPLE = `key: D_minor
time: 3-4

R.2
0.7.4

1.3.2
1.5.8
1.3.8 

1.5.2 
1.4.4 

1.3.2 
1.1.4 

0.7.2 
R.4
`;

// ── DOM REFS ─────────────────────────────────────────────────────────────────
const editorEl       = document.getElementById('code-editor');
const syntaxLayer    = document.getElementById('syntax-layer');
const lineNumbers    = document.getElementById('line-numbers');
const editorHud      = document.getElementById('editor-hud');
const noteTooltip    = document.getElementById('note-tooltip');
const outputLines    = document.getElementById('output-lines');
const outputEmpty    = document.getElementById('output-empty');
const btnRun         = document.getElementById('btn-run');
const btnClearEd     = document.getElementById('btn-clear-editor');
const btnClearOut    = document.getElementById('btn-clear-output');
const btnExample     = document.getElementById('btn-example');
const pills          = document.querySelectorAll('.pill');
const btnPlay        = document.getElementById('btn-play');
const btnStop        = document.getElementById('btn-stop');
const bpmInput       = document.getElementById('bpm-input');
const waveSelect     = document.getElementById('wave-select');
const volSlider      = document.getElementById('vol-slider');
const progressFill   = document.getElementById('progress-fill');
const progressCursor = document.getElementById('progress-cursor');
const pbNoteLabel    = document.getElementById('pb-note-label');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const themeToggle    = document.getElementById('theme-toggle');
const toggleIcon     = document.getElementById('toggle-icon');
const toggleLabel    = document.getElementById('toggle-label');

// ── THEME TOGGLE ─────────────────────────────────────────────────────────────
let isDayTheme = false;

function applyTheme(day) {
  isDayTheme = day;
  document.documentElement.classList.toggle('day', day);
  toggleIcon.textContent  = day ? '☽' : '☀︎';
  toggleLabel.textContent = day ? 'night' : 'day';
  try { localStorage.setItem('mml-theme', day ? 'day' : 'night'); } catch(e) {}
}

themeToggle.addEventListener('click', () => applyTheme(!isDayTheme));
try { if (localStorage.getItem('mml-theme') === 'day') applyTheme(true); } catch(e) {}

// ── TAB SWITCHING ─────────────────────────────────────────────────────────────
pills.forEach(pill => {
  pill.addEventListener('click', () => {
    pills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + pill.dataset.tab).classList.add('active');
  });
});

// ── SYNTAX HIGHLIGHTING ───────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const NOTE_RE = /(-?\d+)\.((\d+)([+\-]?))\.((\d+)(\.\.|\.|t)?)/g;
const NOTE_TOKEN_RE = /^(-?\d+)\.((\d+)([+\-]?))\.((\d+)(\.\.|\.|t)?)$/;
const REST_RE = /\bR\.((\d+)(\.\.|\.|t)?)/g;
const REP_RE  = /\bRep(\d+)\b/g;

function tokenizeLine(line) {
  const ci = line.indexOf('//');
  let code = line, comment = '';
  if (ci !== -1) { code = line.slice(0, ci); comment = line.slice(ci); }

  let out = '';

  // key directive
  const km = code.match(/^(\s*)(key)(\s*:\s*)(\S+)(\s*)$/);
  if (km) {
    return esc(km[1]) +
      `<span class="t-keyword">${esc(km[2])}</span>` +
      `<span class="t-sep">${esc(km[3])}</span>` +
      `<span class="t-keyval">${esc(km[4])}</span>` +
      esc(km[5]) +
      (comment ? `<span class="t-comment">${esc(comment)}</span>` : '');
  }

  // time directive
  const tm = code.match(/^(\s*)(time)(\s*:\s*)(\S+)(\s*)$/);
  if (tm) {
    return esc(tm[1]) +
      `<span class="t-keyword">${esc(tm[2])}</span>` +
      `<span class="t-sep">${esc(tm[3])}</span>` +
      `<span class="t-keyval">${esc(tm[4])}</span>` +
      esc(tm[5]) +
      (comment ? `<span class="t-comment">${esc(comment)}</span>` : '');
  }

  if (/^\s*Rep\d+\s*\{?\s*$/.test(code) || /^\s*\}\s*$/.test(code)) {
    const highlighted = code
      .replace(REP_RE, (_, n) => `<span class="t-rep">Rep${esc(n)}</span>`)
      .replace(/\{/, '<span class="t-brace">{</span>')
      .replace(/\}/, '<span class="t-brace">}</span>');
    return highlighted + (comment ? `<span class="t-comment">${esc(comment)}</span>` : '');
  }

  const tokens = [];
  let r;

  REST_RE.lastIndex = 0;
  while ((r = REST_RE.exec(code)) !== null) {
    const suffix = r[2] || '';
    tokens.push([r.index, r.index + r[0].length,
      `<span class="t-rest">R</span><span class="t-sep">.</span>` +
      `<span class="t-dur">${esc(r[1].replace(suffix,''))}</span>` +
      (suffix ? `<span class="t-durmod">${esc(suffix)}</span>` : '')
    ]);
  }

  NOTE_RE.lastIndex = 0;
  while ((r = NOTE_RE.exec(code)) !== null) {
    const suffix = r[7] || '';
    const denom  = r[6];
    tokens.push([r.index, r.index + r[0].length,
      `<span class="t-oct">${esc(r[1])}</span><span class="t-sep">.</span>` +
      `<span class="t-deg">${esc(r[3])}</span>` +
      (r[4] ? `<span class="t-mod">${esc(r[4])}</span>` : '') +
      `<span class="t-sep">.</span>` +
      `<span class="t-dur">${esc(denom)}</span>` +
      (suffix ? `<span class="t-durmod">${esc(suffix)}</span>` : '')
    ]);
  }

  tokens.sort((a,b) => a[0]-b[0]);
  let last = 0;
  for (const [start, end, html] of tokens) {
    if (start < last) continue;
    out += esc(code.slice(last, start));
    out += html;
    last = end;
  }
  out += esc(code.slice(last));
  if (comment) out += `<span class="t-comment">${esc(comment)}</span>`;
  return out;
}

function updateHighlight() {
  const lines = editorEl.value.split('\n');
  syntaxLayer.innerHTML = lines.map(tokenizeLine).join('\n');
  updateLineNumbers(lines.length);
  lineNumbers.scrollTop = editorEl.scrollTop;
  updateEditorHud();
}

function updateLineNumbers(count) {
  const active = getActiveLine();
  lineNumbers.innerHTML = Array.from({length: count}, (_,i) =>
    `<span class="ln${i+1===active?' active':''}">${i+1}</span>`
  ).join('');
}

function getActiveLine() {
  return editorEl.value.slice(0, editorEl.selectionStart).split('\n').length;
}

function syncScroll() {
  syntaxLayer.scrollTop = editorEl.scrollTop;
  lineNumbers.scrollTop = editorEl.scrollTop;
  hideNoteTooltip();
}

editorEl.addEventListener('input', updateHighlight);
editorEl.addEventListener('scroll', syncScroll);
editorEl.addEventListener('click', updateHighlight);
editorEl.addEventListener('keyup', updateHighlight);
editorEl.addEventListener('mousemove', handleEditorHover);
editorEl.addEventListener('mouseleave', hideNoteTooltip);
editorEl.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editorEl.selectionStart, end = editorEl.selectionEnd;
    editorEl.value = editorEl.value.slice(0,s) + '  ' + editorEl.value.slice(end);
    editorEl.selectionStart = editorEl.selectionEnd = s + 2;
    updateHighlight();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCode(); }
});

// ── PARSER ────────────────────────────────────────────────────────────────────
function parseLines(lines, scale, key, timeSig, startLine = 0) {
  const events = [];
  let i = 0;
  while (i < lines.length) {
    const lineNum = startLine + i + 1;
    let raw = lines[i];
    const ci = raw.indexOf('//');
    if (ci !== -1) raw = raw.slice(0, ci);
    raw = raw.trim();

    if (!raw) { i++; continue; }

    // key directive
    const km = raw.match(/^key\s*:\s*(\S+)$/);
    if (km) {
      key = km[1];
      scale = SCALES[key];
      if (!scale) {
        events.push({ type:'err', line:lineNum, text:`Unknown key "${key}".` });
      } else {
        events.push({ type:'info', line:lineNum, text:`key set → ${key}  [${scale.join(' ')}]` });
      }
      i++; continue;
    }

    // time directive
    const timeM = raw.match(/^time\s*:\s*(\S+)$/);
    if (timeM) {
      const parsed = parseTimeSig(timeM[1]);
      if (!parsed) {
        events.push({ type:'err', line:lineNum, text:`Invalid time signature "${timeM[1]}". Use format like 4-4 or 3-4.` });
      } else {
        timeSig = parsed;
        events.push({ type:'info', line:lineNum, text:`time set → ${parsed.beats}/${parsed.denom}  (${beatsPerMeasure(parsed).toFixed(3).replace(/\.?0+$/,'')} beats/measure)` });
      }
      i++; continue;
    }

    // Rep block opener
    const repM = raw.match(/^Rep(\d+)\s*\{?\s*$/);
    if (repM) {
      const times = parseInt(repM[1]);
      const blockLines = [];
      let depth = raw.includes('{') ? 1 : 0;
      i++;
      while (i < lines.length) {
        let bl = lines[i];
        const bci = bl.indexOf('//');
        if (bci !== -1) bl = bl.slice(0, bci);
        bl = bl.trim();
        if (bl === '{') { depth++; i++; continue; }
        if (bl === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        if (depth === 0 && !bl.startsWith('{')) {
          blockLines.push(lines[i]);
          i++;
          break;
        }
        blockLines.push(lines[i]);
        i++;
      }
      events.push({ type:'rep', line:lineNum, text:`Rep×${times}  (${blockLines.length} line${blockLines.length!==1?'s':''})` });
      for (let rep = 0; rep < times; rep++) {
        const inner = parseLines(blockLines, scale, key, timeSig, lineNum);
        inner.forEach(ev => {
          if (ev._newKey) { key = ev._newKey; scale = SCALES[key] || scale; }
          if (ev._newTimeSig) { timeSig = ev._newTimeSig; }
        });
        events.push(...inner);
      }
      continue;
    }

    if (raw === '{' || raw === '}') { i++; continue; }

    // rest
    const rm = raw.match(/^R\.((\d+)(\.\.|\.|t)?)$/);
    if (rm) {
      const denom  = parseInt(rm[2]);
      const suffix = rm[3] || '';
      const beats  = calcBeats(denom, suffix);
      const label  = (DUR_NAMES[denom] || `1/${denom}`) + (suffix ? ' (' + (suffix==='t' ? 'triplet' : suffix==='..' ? 'double-dotted' : 'dotted') + ')' : '');
      events.push({ type:'rest', line:lineNum, beats, text:`rest  ·  ${label}` });
      i++; continue;
    }

    // note: oct.deg[+/-].denom[suffix]
    const nm = raw.match(/^(-?\d+)\.((\d+)([+\-]?))\.((\d+)(\.\.|\.|t)?)$/);
    if (nm) {
      if (!scale) {
        events.push({ type:'err', line:lineNum, text:'No key signature declared before this note.' });
        i++; continue;
      }
      let oct    = parseInt(nm[1]);
      const deg    = parseInt(nm[3]);
      const mod    = nm[4];
      const denom  = parseInt(nm[6]);
      const suffix = nm[7] || '';
      const beats  = calcBeats(denom, suffix);

      if (deg < 1 || deg > scale.length) {
        events.push({ type:'err', line:lineNum, text:`Degree ${deg} out of range for ${key} (1–${scale.length}).` });
        i++; continue;
      }

      const baseNoteName = resolveScaleDegree(scale, deg);
      let noteName = baseNoteName;
      if (mod === '+') noteName = noteName.replace('b','') + '#';
      else if (mod === '-') noteName = noteName.replace('#','') + 'b';

      const freq = noteToFreq(noteName, scale[0], oct, baseNoteName);
      const durLabel = (DUR_NAMES[denom] || `1/${denom}`) +
        (suffix === 't' ? ' triplet' : suffix === '..' ? ' double-dotted' : suffix === '.' ? ' dotted' : '');
      const octLabel = oct >= 1 ? `oct +${oct}` : `oct ${oct}`;

      events.push({ type:'note', line:lineNum, noteName, freq, beats, text:`${octLabel}  ·  ${durLabel}` });
      i++; continue;
    }

    events.push({ type:'err', line:lineNum, text:`Syntax error: "${raw}"` });
    i++;
  }
  return events;
}

function parseCode(src) {
  return parseLines(src.split('\n'), null, null, null, 0);
}

// ── MEASURE GROUPING ──────────────────────────────────────────────────────────
// Given a flat event list and a timeSig, returns a structured list of
// "output items" which are either events or measure-boundary markers.
//
// Each item: { kind: 'event', ev } | { kind: 'bar' }
//
// Logic:
//  - Walk events in order, accumulating beat counts
//  - When beats in current measure reach beatsPerMeasure, insert a 'bar'
function groupIntoMeasures(events, timeSig) {
  if (!timeSig) {
    // No time sig: just wrap each event
    return events.map(ev => ({ kind: 'event', ev }));
  }

  const bpm = beatsPerMeasure(timeSig);
  const items = [];
  let beatsInMeasure = 0;
  let measureIndex   = 0;

  // Opening bar line
  items.push({ kind: 'bar', measureIndex: 0 });

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    items.push({ kind: 'event', ev });

    if (ev.type === 'note' || ev.type === 'rest') {
      beatsInMeasure += ev.beats;

      // Round to avoid floating point drift
      const rounded = Math.round(beatsInMeasure * 1000) / 1000;
      const bpmRounded = Math.round(bpm * 1000) / 1000;

      if (rounded >= bpmRounded) {
        // Measure complete — close it
        measureIndex++;
        beatsInMeasure = rounded - bpmRounded;
        items.push({ kind: 'bar', measureIndex, complete: true });
      }
    }
  }

  return items;
}

// Format a beat count nicely: whole numbers as integers, fractions as decimals
function fmtBeats(b) {
  if (Number.isInteger(b)) return String(b);
  // Show up to 2 decimal places, strip trailing zeros
  return b.toFixed(2).replace(/\.?0+$/, '');
}

// ── RUN ───────────────────────────────────────────────────────────────────────
let outputRowEls = [];

function runCode() {
  stopPlayback();
  outputLines.innerHTML = '';
  outputRowEls = [];
  outputEmpty.style.display = 'none';
  btnRun.classList.add('running');
  const events = parseCode(editorEl.value);
  btnRun.classList.remove('running');

  if (!events.length) {
    outputEmpty.style.display = 'flex';
    return;
  }

  const lastTimeSig = extractTimeSig(editorEl.value);
  const items = groupIntoMeasures(events, lastTimeSig);
  const frag = document.createDocumentFragment();

  let evIdx = 0;
  items.forEach(item => {
    if (item.kind === 'bar') {
      const bar = document.createElement('div');
      bar.className = 'out-barline' + (item.measureIndex > 0 ? ' out-barline-thick' : '');
      if (item.measureIndex === 0) {
        bar.setAttribute('data-measure', '1');
      } else {
        bar.setAttribute('data-measure', String(item.measureIndex + 1));
      }
      frag.appendChild(bar);
      return;
    }

    const ev = item.ev;
    const row = document.createElement('div');
    row.className = `out-line ${ev.type}`;

    const lnum = document.createElement('span');
    lnum.className = 'out-lnum';
    lnum.textContent = ev.line;

    const text = document.createElement('span');
    text.className = 'out-text';

    if (ev.type === 'note' && ev.noteName) {
      const badge = document.createElement('span');
      badge.className = 'out-note-name';
      badge.textContent = ev.noteName;
      text.appendChild(badge);
      text.appendChild(document.createTextNode(ev.text));
    } else {
      text.textContent = ev.text;
    }

    row.appendChild(lnum);
    row.appendChild(text);
    frag.appendChild(row);

    outputRowEls.push({ el: row, ev, evIdx });
    evIdx++;
  });

  outputLines.appendChild(frag);
}

// Extract the first time signature from source code
function extractTimeSig(src) {
  for (const line of src.split('\n')) {
    const m = line.replace(/\/\/.*$/, '').trim().match(/^time\s*:\s*(\S+)$/);
    if (m) return parseTimeSig(m[1]);
  }
  return null;
}

function describeDuration(denom, suffix = '') {
  const durLabel = DUR_NAMES[denom] || `1/${denom}`;
  if (suffix === 't') return `${durLabel} triplet`;
  if (suffix === '..') return `${durLabel} double-dotted`;
  if (suffix === '.') return `${durLabel} dotted`;
  return durLabel;
}

function getStateBeforeLine(lines, targetLineIndex) {
  let key = null;
  let scale = null;
  let timeSig = null;

  for (let i = 0; i <= targetLineIndex; i++) {
    let raw = lines[i] || '';
    const ci = raw.indexOf('//');
    if (ci !== -1) raw = raw.slice(0, ci);
    raw = raw.trim();
    if (!raw) continue;

    const km = raw.match(/^key\s*:\s*(\S+)$/);
    if (km && SCALES[km[1]]) {
      key = km[1];
      scale = SCALES[key];
      continue;
    }

    const tm = raw.match(/^time\s*:\s*(\S+)$/);
    if (tm) {
      const parsed = parseTimeSig(tm[1]);
      if (parsed) timeSig = parsed;
    }
  }

  return { key, scale, timeSig };
}

function getNoteDetails(noteToken, state) {
  const nm = noteToken.match(NOTE_TOKEN_RE);
  if (!nm || !state.scale) return null;

  const tonicOctave = parseInt(nm[1]);
  const deg = parseInt(nm[3]);
  const mod = nm[4];
  const denom = parseInt(nm[6]);
  const suffix = nm[7] || '';
  if (deg < 1 || deg > state.scale.length) return null;

  const anchorName = resolveScaleDegree(state.scale, deg);
  let noteName = anchorName;
  if (mod === '+') noteName = noteName.replace('b', '') + '#';
  else if (mod === '-') noteName = noteName.replace('#', '') + 'b';

  const beats = calcBeats(denom, suffix);
  const sciOctave = resolveScientificOctave(state.scale[0], tonicOctave, anchorName);
  return {
    noteName,
    fullNote: `${noteName}${sciOctave}`,
    octaveText: `octave ${tonicOctave}`,
    durationText: describeDuration(denom, suffix),
    beatsText: `${fmtBeats(beats)} beat${beats === 1 ? '' : 's'}`
  };
}

function computeMeasureProgress(src, cursorPos) {
  const lines = src.split('\n');
  const beforeCursor = src.slice(0, cursorPos);
  const activeLineIndex = beforeCursor.split('\n').length - 1;
  const activeLineStart = beforeCursor.lastIndexOf('\n') + 1;
  const activeColumn = cursorPos - activeLineStart;
  let timeSig = null;
  let beatsInMeasure = 0;
  let measureIndex = 1;

  for (let i = 0; i <= activeLineIndex; i++) {
    let raw = lines[i] || '';
    const ci = raw.indexOf('//');
    if (ci !== -1) raw = raw.slice(0, ci);
    if (i === activeLineIndex) raw = raw.slice(0, activeColumn);
    raw = raw.trim();
    if (!raw) continue;

    const tm = raw.match(/^time\s*:\s*(\S+)$/);
    if (tm) {
      const parsed = parseTimeSig(tm[1]);
      if (parsed) {
        timeSig = parsed;
        beatsInMeasure = 0;
        measureIndex = 1;
      }
      continue;
    }

    if (!timeSig) continue;

    const noteMatch = raw.match(NOTE_TOKEN_RE);
    const restMatch = raw.match(/^R\.((\d+)(\.\.|\.|t)?)$/);
    if (!noteMatch && !restMatch) continue;

    const denom = parseInt(noteMatch ? noteMatch[6] : restMatch[2]);
    const suffix = noteMatch ? (noteMatch[7] || '') : (restMatch[3] || '');
    beatsInMeasure += calcBeats(denom, suffix);

    const bpm = Math.round(beatsPerMeasure(timeSig) * 1000) / 1000;
    beatsInMeasure = Math.round(beatsInMeasure * 1000) / 1000;
    while (beatsInMeasure >= bpm && bpm > 0) {
      beatsInMeasure = Math.round((beatsInMeasure - bpm) * 1000) / 1000;
      measureIndex++;
    }
  }

  if (!timeSig) return null;

  const bpm = Math.round(beatsPerMeasure(timeSig) * 1000) / 1000;
  const remaining = Math.round((bpm - beatsInMeasure) * 1000) / 1000;
  return { measureIndex, remaining: remaining === 0 ? bpm : remaining };
}

function updateEditorHud() {
  const progress = computeMeasureProgress(editorEl.value, editorEl.selectionStart);
  if (!progress) {
    editorHud.hidden = true;
    editorHud.textContent = '';
    return;
  }

  editorHud.hidden = false;
  editorHud.textContent = `m${progress.measureIndex} · ${fmtBeats(progress.remaining)} left`;
}

function getEditorMetrics() {
  const style = window.getComputedStyle(editorEl);
  const lineHeight = parseFloat(style.lineHeight) || 22;
  const paddingLeft = parseFloat(style.paddingLeft) || 14;
  const paddingTop = parseFloat(style.paddingTop) || 14;

  if (!getEditorMetrics.charWidth || getEditorMetrics.font !== style.font) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = style.font;
    getEditorMetrics.charWidth = ctx.measureText('0').width;
    getEditorMetrics.font = style.font;
  }

  return { lineHeight, paddingLeft, paddingTop, charWidth: getEditorMetrics.charWidth || 8 };
}

function handleEditorHover(e) {
  const metrics = getEditorMetrics();
  const rect = editorEl.getBoundingClientRect();
  const x = e.clientX - rect.left + editorEl.scrollLeft - metrics.paddingLeft;
  const y = e.clientY - rect.top + editorEl.scrollTop - metrics.paddingTop;
  const lineIndex = Math.floor(y / metrics.lineHeight);
  const column = Math.floor(x / metrics.charWidth);
  const lines = editorEl.value.split('\n');
  const line = lines[lineIndex];

  if (!line || column < 0) {
    hideNoteTooltip();
    return;
  }

  const commentIndex = line.indexOf('//');
  const code = commentIndex === -1 ? line : line.slice(0, commentIndex);
  let match;
  NOTE_RE.lastIndex = 0;
  while ((match = NOTE_RE.exec(code)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (column < start || column >= end) continue;

    const state = getStateBeforeLine(lines, lineIndex);
    const details = getNoteDetails(match[0], state);
    if (!details) {
      hideNoteTooltip();
      return;
    }

    noteTooltip.innerHTML =
      `<div class="note-tooltip-title">${esc(details.fullNote)}</div>` +
      `<div>${esc(details.durationText)} · ${esc(details.beatsText)}</div>` +
      `<div class="note-tooltip-meta">${esc(details.octaveText)} · ${esc(details.noteName)}</div>`;
    noteTooltip.hidden = false;
    noteTooltip.style.left = `${Math.min(e.clientX - rect.left + 14, rect.width - 150)}px`;
    noteTooltip.style.top = `${Math.min(e.clientY - rect.top + 18, rect.height - 76)}px`;
    return;
  }

  hideNoteTooltip();
}

function hideNoteTooltip() {
  noteTooltip.hidden = true;
}

// ── WEB AUDIO ENGINE ─────────────────────────────────────────────────────────
let audioCtx   = null;
let masterGain = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  masterGain.gain.value = parseFloat(volSlider.value);
  return audioCtx;
}

let isPlaying      = false;
let isPaused       = false;
let scheduledNodes = [];
let rafId          = null;
let playbackTimer  = null;
let playStartTime  = 0;
let totalDuration  = 0;
let noteTimings    = [];
let activeTimingIdx = -1;

function buildTimings(events, bpm) {
  const beatSec = 60 / bpm;
  const timings = [];
  let t = 0;
  events.forEach((ev, evIdx) => {
    if (ev.type === 'note' || ev.type === 'rest') {
      const sec = ev.beats * beatSec;
      if (ev.type === 'note') {
        timings.push({ start: t, end: t + sec, noteName: ev.noteName, freq: ev.freq, evIdx });
      }
      t += sec;
    }
  });
  return { timings, total: t };
}

function scheduleNote(ctx, freq, startTime, durSec, waveType) {
  const gain = ctx.createGain();
  gain.connect(masterGain);
  const osc = ctx.createOscillator();
  osc.type = waveType;
  osc.frequency.value = freq;
  osc.connect(gain);

  const atk = 0.008;
  const rel = Math.min(0.07, durSec * 0.18);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(1, startTime + atk);
  gain.gain.setValueAtTime(1, startTime + durSec - rel);
  gain.gain.linearRampToValueAtTime(0, startTime + durSec);

  osc.start(startTime);
  osc.stop(startTime + durSec + 0.01);
  scheduledNodes.push(osc, gain);
}

function startPlayback() {
  const events = parseCode(editorEl.value);
  const playable = events.filter(ev => ev.type === 'note' && ev.freq);
  if (!playable.length) { setStatus('no notes', false); return; }

  const ctx  = getAudioCtx();
  const bpm  = Math.max(20, Math.min(400, parseInt(bpmInput.value) || 120));
  const wave = waveSelect.value;

  const { timings, total } = buildTimings(events, bpm);
  noteTimings   = timings;
  totalDuration = total;
  activeTimingIdx = -1;

  const offset = 0.05;
  playStartTime = ctx.currentTime + offset;

  timings.forEach(n => {
    scheduleNote(ctx, n.freq, playStartTime + n.start, n.end - n.start, wave);
  });

  setTimeout(() => { if (isPlaying) stopPlayback(true); }, (total + offset + 0.2) * 1000);

  isPlaying = true;
  isPaused  = false;
  btnPlay.textContent = '⏸';
  btnPlay.classList.add('playing');
  progressCursor.classList.add('visible');
  setStatus('playing', true);
  startPlaybackUI();
}

function pausePlayback() {
  audioCtx && audioCtx.suspend();
  isPlaying = false;
  isPaused  = true;
  btnPlay.textContent = '▶';
  btnPlay.classList.remove('playing');
  setStatus('paused', false);
  cancelAnimationFrame(rafId);
  clearInterval(playbackTimer);
  playbackTimer = null;
  clearPlayingNow();
}

function resumePlayback() {
  audioCtx && audioCtx.resume();
  isPlaying = true;
  isPaused  = false;
  btnPlay.textContent = '⏸';
  btnPlay.classList.add('playing');
  setStatus('playing', true);
  startPlaybackUI();
}

function stopPlayback(ended = false) {
  scheduledNodes.forEach(n => { try { n.disconnect(); } catch(e){} });
  scheduledNodes = [];
  isPlaying = false;
  isPaused  = false;
  if (audioCtx && !ended) audioCtx.suspend().then(() => audioCtx && audioCtx.resume());
  btnPlay.textContent = '▶';
  btnPlay.classList.remove('playing');
  progressFill.style.width = '0%';
  progressCursor.style.left = '0%';
  progressCursor.classList.remove('visible');
  pbNoteLabel.textContent = '—';
  setStatus('ready', false);
  cancelAnimationFrame(rafId);
  clearInterval(playbackTimer);
  playbackTimer = null;
  activeTimingIdx = -1;
  clearPlayingNow();
}

// ── OUTPUT HIGHLIGHT ─────────────────────────────────────────────────────────
let currentHighlightedRow = null;

function clearPlayingNow() {
  if (currentHighlightedRow) {
    currentHighlightedRow.classList.remove('playing-now');
    currentHighlightedRow = null;
  }
}

function highlightRowByEvIdx(evIdx) {
  const entry = outputRowEls.find(r => r.evIdx === evIdx);
  if (!entry || entry.el === currentHighlightedRow) return;
  clearPlayingNow();
  currentHighlightedRow = entry.el;
  entry.el.classList.add('playing-now');

  const wrap = document.getElementById('output-wrap');
  const elTop    = entry.el.offsetTop;
  const elBottom = elTop + entry.el.offsetHeight;
  const wrapTop    = wrap.scrollTop;
  const wrapBottom = wrapTop + wrap.clientHeight;
  if (elTop < wrapTop + 40 || elBottom > wrapBottom - 40) {
    wrap.scrollTop = Math.max(0, elTop - (wrap.clientHeight / 2) + (entry.el.offsetHeight / 2));
  }
}

function animateProgress() {
  if (!isPlaying || !audioCtx) return;
  const elapsed = audioCtx.currentTime - playStartTime;
  const pct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)).toFixed(2);
  progressFill.style.width = pct + '%';
  progressCursor.style.left = pct + '%';

  while (activeTimingIdx + 1 < noteTimings.length && elapsed >= noteTimings[activeTimingIdx + 1].start) {
    activeTimingIdx++;
  }

  let cur = null;
  if (activeTimingIdx >= 0) {
    const candidate = noteTimings[activeTimingIdx];
    if (elapsed < candidate.end) cur = candidate;
  }

  pbNoteLabel.textContent = cur ? cur.noteName : '—';
}

function startPlaybackUI() {
  clearInterval(playbackTimer);
  animateProgress();
  playbackTimer = setInterval(() => {
    if (!isPlaying) return;
    animateProgress();
  }, 50);
}

function setStatus(msg, active) {
  statusText.textContent = msg;
  const col = active ? 'var(--accent3)' : 'var(--accent)';
  statusDot.style.background = col;
  statusDot.style.boxShadow = `0 0 6px ${col}`;
}

// ── PLAYBACK CONTROLS ────────────────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (!isPlaying && !isPaused) startPlayback();
  else if (isPlaying)          pausePlayback();
  else if (isPaused)           resumePlayback();
});
btnStop.addEventListener('click', () => stopPlayback());
volSlider.addEventListener('input', () => {
  if (masterGain) masterGain.gain.value = parseFloat(volSlider.value);
});
document.addEventListener('keydown', e => {
  if (e.target === editorEl) return;
  if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
});

// ── ACTION BUTTONS ────────────────────────────────────────────────────────────
btnRun.addEventListener('click', runCode);
btnClearEd.addEventListener('click', () => {
  stopPlayback();
  editorEl.value = '';
  updateHighlight();
});
btnClearOut.addEventListener('click', () => {
  outputLines.innerHTML = '';
  outputRowEls = [];
  outputEmpty.style.display = 'flex';
});
btnExample.addEventListener('click', () => {
  stopPlayback();
  editorEl.value = EXAMPLE;
  updateHighlight();
});

// ── INIT ──────────────────────────────────────────────────────────────────────
editorEl.value = EXAMPLE;
updateHighlight();
