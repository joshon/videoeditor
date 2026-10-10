// Cutroom client engine. Imported only in the browser (see app/Editor.jsx). State lives on the server's disk; this file only renders it and
// sends every change back (autosave). Scrubbing never uses a <video> player UI:
// frames come from a per-clip JPEG frame cache drawn to canvas, refined by
// exact seeks on a short-GOP proxy, with audio "grains" while you drag.

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EPS = 1e-6;
const enc = encodeURIComponent;
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));

async function api(method, url, body) {
  const res = await fetch(url, {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const el = $('toast'); el.textContent = msg; el.classList.toggle('error', !!isError); el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), isError ? 6000 : 2200);
}

// Markup for design-system components the engine creates itself (bin items,
// track heads, dialog lists). It matches what the React components render:
// design-system/components/Button and Icon.
function dsButton(variant, label, cls = '', title = '') {
  return `<button type="button" class="btn btn-medium btn-${variant} ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="btn-label">${label}</span></button>`;
}
function dsIconButton(variant, icon, cls = '', title = '') {
  return `<button type="button" class="btn btn-medium btn-${variant} btn-icon-only ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="btn-icon btn-icon-left"><span class="ds-icon" aria-hidden="true">${icon}</span></span></button>`;
}
function dsToggle(label, checked, title = '') {
  return `<label class="toggle toggle-medium"${title ? ` title="${escapeHtml(title)}"` : ''}><input type="checkbox" class="toggle-input"${checked ? ' checked' : ''}><div class="toggle-track"><div class="toggle-thumb"></div></div><div class="toggle-content"><span class="toggle-label">${label}</span></div></label>`;
}
// Set a design-system Button's text without removing its inner label element.
function setButtonText(el, text) { (el.querySelector('.btn-label') || el).textContent = text; }

// ------------------------------------------------------------------ theme
// Canvas can't read CSS variables directly, so resolve the design-system tokens
// once: C holds colors and fonts, and the timeline geometry below holds sizes.
let C = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const rootPx = parseFloat(cs.fontSize) || 16;
  const px = (n) => { const raw = v(n); return raw.endsWith('rem') ? parseFloat(raw) * rootPx : parseFloat(raw); };
  C = {
    ruler: v('--cb-surface-menu-bg'), muted: v('--cb-secondary_text-text'), text: v('--cb-surface-001-text'),
    lane: v('--cb-surface-001-bg'), laneAlt: v('--cb-surface-003-bg'), panel: v('--cb-surface-card-bg'),
    video: v('--primitive-datavis-categorical-001'), videoText: v('--primitive-basics-core-white'),
    audio: v('--primitive-datavis-categorical-002'), audioText: v('--primitive-basics-grayscale-950'),
    wave: v('--primitive-basics-grayscale-950'), select: v('--primitive-basics-core-white'),
    playhead: v('--primitive-datavis-categorical-000'), mark: v('--primitive-evaluative-meh-200'),
    black: v('--primitive-basics-core-black'), missing: v('--cb-disabled-bg'),
    mono: v('--font-mono') || 'monospace', sans: v('--font-sans') || 'sans-serif',
    codeSize: px('--typography-code-medium-font-size') || 12, uiSize: px('--typography-ui-medium-font-size') || 12,
    radius: px('--radius-sm') || 6, line: px('--border-md') || 2, lineThin: px('--border-md-sm') || 1.25, lineThick: px('--border-lg') || 3,
  };
  RULER_H = px('--height-sm') || 32; VH = px('--height-lg') || 64; AH = px('--height-md') || 48;
  GAP = px('--spacing-sm') || 10; LABEL_H = px('--spacing-xl') || 16;
}

// ------------------------------------------------------------------ state
const S = {
  info: null, slug: null, project: null, dir: '',
  media: {}, assets: {}, uploads: {},
  rev: 0, changeSeq: 0, savedSeq: 0, saving: false, saveTimer: 0, uiDirty: false, saveError: null,
  undo: [], redo: [],
  selection: new Set(),
  playhead: 0, zoom: 60, scroll: 0, vscroll: 0,
  snap: true, linked: true, focus: 'program',
  source: { mediaId: null, clipId: null, t: 0 },
  play: null, drag: null, mediaDrag: null, dropTarget: null, snapLine: null,
  rec: null, // the take being recorded (see startRecording)
};
const P = () => S.project;
const len = (c) => c.out - c.in;
const end = (c) => c.start + c.out - c.in;
const seqFps = () => (P() && P().settings.fps) || 30;
const minDur = () => 1 / seqFps();
const qt = (t, fps = seqFps()) => Math.round(t * fps) / fps;
const clipById = (id) => P().clips.find((c) => c.id === id);
const trackById = (id) => P().tracks.find((t) => t.id === id);
const seqEnd = () => P().clips.reduce((m, c) => Math.max(m, end(c)), 0);
const partners = (c) => (c.linkId ? P().clips.filter((o) => o.linkId === c.linkId && o.id !== c.id) : []);
const mediaDur = (id) => (S.media[id] && S.media[id].duration) || 0;

function fmtTC(t, fps = seqFps()) {
  t = Math.max(0, t || 0);
  const s = Math.floor(t + EPS);
  const f = Math.min(Math.ceil(fps) - 1, Math.floor((t - s) * fps + 1e-3));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}
function fmtDur(t) {
  t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

// ------------------------------------------------------------------ render scheduling
const dirty = { program: true, source: true, timeline: true, bin: true };
function requestRender(what = 'all') {
  if (what === 'all') for (const k in dirty) dirty[k] = true; else dirty[what] = true;
}

// ------------------------------------------------------------------ media assets
let actx = null, master = null;
function audioCtx() {
  if (!actx) { actx = new AudioContext({ latencyHint: 'interactive' }); master = actx.createGain(); master.connect(actx.destination); }
  return actx;
}

const FRAME_LIMIT = 3000;
const frameLRU = new Map();

class Asset {
  constructor(meta) { this.meta = meta; this.frames = new Map(); this.peaks = null; this.audioBuf = null; this.audioP = null; this.peaksP = null; this.videos = {}; }
  get base() { return `/files/${enc(S.slug)}/cache/${this.meta.id}/`; }
  get ready() { return this.meta.status === 'ready'; }
  get hasFrames() { return this.ready && this.meta.hasVideo && this.meta.frameCount > 0; }
  idx(t) { return clamp(Math.floor(t * this.meta.scrubFps + 1e-4), 0, this.meta.frameCount - 1); }
  frame(i) {
    const key = this.meta.id + ':' + i;
    let img = this.frames.get(i);
    if (img) { const e = frameLRU.get(key); if (e) { frameLRU.delete(key); frameLRU.set(key, e); } return img; }
    img = new Image(); img.decoding = 'async'; img._t = i / this.meta.scrubFps;
    img.onload = () => { img.ok = true; requestRender(); };
    img.src = this.base + 'frames/' + String(i + 1).padStart(6, '0') + '.jpg';
    this.frames.set(i, img); frameLRU.set(key, { asset: this, i });
    while (frameLRU.size > FRAME_LIMIT) {
      const [k, e] = frameLRU.entries().next().value; frameLRU.delete(k); e.asset.frames.delete(e.i);
    }
    return img;
  }
  // The exact cached frame if decoded, otherwise the nearest decoded neighbour.
  frameAt(t, reach = 120) {
    if (!this.hasFrames) return null;
    const i = this.idx(t); const img = this.frame(i);
    if (img.ok) return img;
    for (let d = 1; d <= reach; d++) {
      const a = this.frames.get(i - d); if (a && a.ok) return a;
      const b = this.frames.get(i + d); if (b && b.ok) return b;
    }
    return null;
  }
  preload(t, before = 1, after = 3) {
    if (!this.hasFrames) return;
    const a = this.idx(t - before), b = this.idx(t + after);
    for (let i = a; i <= b; i++) this.frame(i);
  }
  loadPeaks() {
    if (!this.peaksP && this.ready && this.meta.hasAudio) {
      this.peaksP = fetch(this.base + 'peaks.json', { cache: 'no-store' }).then((r) => r.json())
        .then((j) => { this.peaks = j; requestRender(); }).catch(() => { this.peaksP = null; });
    }
    return this.peaksP;
  }
  loadAudio() {
    if (!this.audioP && this.ready && this.meta.hasAudio) {
      this.audioP = fetch(this.base + 'audio.m4a').then((r) => r.arrayBuffer())
        .then((b) => audioCtx().decodeAudioData(b))
        .then((buf) => { this.audioBuf = buf; onAudioLoaded(); })
        .catch((e) => { console.warn('audio decode', e); this.audioP = null; });
    }
    return this.audioP;
  }
  video(role) {
    if (!this.meta.hasVideo || !this.ready) return null;
    let v = this.videos[role];
    if (!v) {
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = this.base + 'proxy.mp4';
      // _shownTime: the media time of the frame the element is actually showing.
      // currentTime jumps to a new target as soon as a seek starts, but the old
      // frame stays on screen until 'seeked'.
      v._queued = null; v._shownTime = null;
      v.addEventListener('seeked', () => {
        if (v._queued != null) { const q = v._queued; v._queued = null; if (Math.abs(q - v.currentTime) > 1e-4) { v.currentTime = q; return; } }
        v._shownTime = v.currentTime;
        requestRender();
      });
      v.addEventListener('loadeddata', () => { v._shownTime = v.currentTime; requestRender(); });
      v.addEventListener('pause', () => { v._shownTime = v.currentTime; });
      $('videoPool').append(v);
      this.videos[role] = v;
    }
    return v;
  }
  poster() { return this.hasFrames ? this.frameAt(Math.min(1, this.meta.duration / 3)) : null; }
}

// Latest-wins exact seek: never queue more than one seek behind the current one.
function seekVideo(v, t) {
  if (!v || v.readyState < 1) return;
  if (v.seeking) { v._queued = t; return; }
  if (Math.abs(v.currentTime - t) > 1e-4) v.currentTime = t;
}

function drawContain(ctx, src, sw, sh, x, y, w, h) {
  if (!sw || !sh) return;
  const s = Math.min(w / sw, h / sh); const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Draw media time `mt` of an asset into a rect, from whichever source is closest
// to `mt`: the sharp proxy video (what it is showing right now, even mid-seek)
// or the instant frame cache. The video keeps the screen unless the cache is
// more than one cache step closer, so slow scrubbing doesn't flip between the
// two or step backwards while a seek catches up.
function drawAssetFrame(ctx, a, mt, x, y, w, h, role, playing) {
  if (!a || !a.hasFrames) return false;
  const v = a.videos[role];
  if (playing) {
    if (v && v.readyState >= 2 && !v.paused && Math.abs(v.currentTime - mt) < 0.2) {
      drawContain(ctx, v, v.videoWidth, v.videoHeight, x, y, w, h); return true;
    }
  }
  const img = a.frameAt(mt);
  const imgDist = img ? Math.abs(img._t - mt) : Infinity;
  const vidDist = !playing && v && v.readyState >= 2 && v._shownTime != null ? Math.abs(v._shownTime - mt) : Infinity;
  if (vidDist < Infinity && vidDist <= Math.max(imgDist, 1 / a.meta.scrubFps)) drawContain(ctx, v, v.videoWidth, v.videoHeight, x, y, w, h);
  else if (img) drawContain(ctx, img, img.naturalWidth, img.naturalHeight, x, y, w, h);
  if (!playing) seekVideo(a.video(role), mt);
  return !!img || vidDist < Infinity;
}

function drawWave(ctx, peaks, t0, t1, x, y, w, h, color) {
  if (!peaks || w < 1) return;
  const rate = peaks.rate, arr = peaks.peaks; const mid = y + h / 2;
  ctx.fillStyle = color; ctx.beginPath();
  const step = (t1 - t0) / w;
  for (let px = 0; px < w; px++) {
    const a = Math.floor((t0 + px * step) * rate), b = Math.max(a + 1, Math.floor((t0 + (px + 1) * step) * rate));
    let m = 0; for (let i = a; i < b && i < arr.length; i++) if (arr[i] > m) m = arr[i];
    const hh = (m / 255) * (h / 2);
    ctx.rect(x + px, mid - hh, 1, hh * 2 || 0.5);
  }
  ctx.fill();
}

// ------------------------------------------------------------------ canvases
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(); const d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w: r.width, h: r.height, d };
}

function topClipAt(t) {
  for (const tr of P().tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    const c = P().clips.find((c) => c.trackId === tr.id && c.start <= t + EPS && end(c) > t + EPS);
    if (c && S.media[c.mediaId] && S.media[c.mediaId].hasVideo) return c;
  }
  return null;
}

function renderProgram() {
  const cv = $('programCanvas'); const { w, h, d } = fitCanvas(cv); const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.lane; ctx.fillRect(0, 0, w, h);
  const { width: sw, height: sh } = P().settings;
  const s = Math.min(w / sw, h / sh); const rw = sw * s, rh = sh * s, rx = (w - rw) / 2, ry = (h - rh) / 2;
  ctx.fillStyle = C.black; ctx.fillRect(rx, ry, rw, rh);
  const t = S.playhead; const clip = topClipAt(t);
  const playing = S.play && S.play.target === 'program' && S.play.rate > 0;
  if (clip) {
    const a = S.assets[clip.mediaId];
    ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    drawAssetFrame(ctx, a, clip.in + t - clip.start, rx, ry, rw, rh, 'program', playing);
    ctx.restore();
  }
  $('programTc').textContent = fmtTC(t);
  $('programDur').textContent = fmtTC(seqEnd());
}

function renderSource() {
  const cv = $('sourceCanvas'); const { w, h, d } = fitCanvas(cv); const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
  const src = S.source; const a = src.mediaId && S.assets[src.mediaId];
  $('sourceMsg').hidden = !!a;
  if (a) {
    const m = a.meta; const playing = S.play && S.play.target === 'source' && S.play.rate > 0;
    if (m.hasVideo) drawAssetFrame(ctx, a, src.t, 0, 0, w, h, 'source', playing);
    else {
      a.loadPeaks();
      const mk = sourceMarks();
      drawWave(ctx, a.peaks, 0, m.duration, 0, h * 0.2, w, h * 0.6, C.audio);
      ctx.fillStyle = C.playhead; ctx.fillRect((src.t / m.duration) * w, 0, C.line, h);
      ctx.globalAlpha = 0.5; ctx.fillStyle = C.lane;
      ctx.fillRect(0, 0, (mk.in / m.duration) * w, h); ctx.fillRect((mk.out / m.duration) * w, 0, w, h); ctx.globalAlpha = 1;
    }
    $('sourceTc').textContent = fmtTC(src.t, m.fps || seqFps());
  }
  renderSourceScrub();
}

function renderSourceScrub() {
  const cv = $('sourceScrub'); const { w, h, d } = fitCanvas(cv); const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.lane; ctx.fillRect(0, 0, w, h);
  const a = S.source.mediaId && S.assets[S.source.mediaId]; if (!a) return;
  const m = a.meta; const D = m.duration || 1;
  if (a.hasFrames) {
    const tw = (h * (m.width || 16)) / (m.height || 9);
    for (let x = 0; x < w; x += tw) {
      const img = a.frameAt(((x + tw / 2) / w) * D, 30);
      if (img) { ctx.save(); ctx.beginPath(); ctx.rect(x, 0, tw, h); ctx.clip(); drawContain(ctx, img, img.naturalWidth, img.naturalHeight, x, 0, tw, h); ctx.restore(); }
    }
  } else if (m.hasAudio) { a.loadPeaks(); drawWave(ctx, a.peaks, 0, D, 0, 4, w, h - 8, C.audio); }
  const mk = sourceMarks(); const xi = (mk.in / D) * w, xo = (mk.out / D) * w;
  ctx.globalAlpha = 0.7; ctx.fillStyle = C.lane; ctx.fillRect(0, 0, xi, h); ctx.fillRect(xo, 0, w - xo, h); ctx.globalAlpha = 1;
  ctx.fillStyle = C.mark; ctx.fillRect(xi, 0, C.line, h); ctx.fillRect(xo - C.line, 0, C.line, h);
  ctx.fillRect(xi, 0, xo - xi, C.lineThick); ctx.fillRect(xi, h - C.lineThick, xo - xi, C.lineThick);
  const xp = (S.source.t / D) * w;
  ctx.fillStyle = C.playhead; ctx.fillRect(xp - C.line / 2, 0, C.line, h);
  ctx.beginPath(); ctx.moveTo(xp - 6, 0); ctx.lineTo(xp + 6, 0); ctx.lineTo(xp, 8); ctx.fill();
  const fps = m.fps || seqFps();
  $('sourceInOut').innerHTML = `<span>In ${fmtTC(mk.in, fps)}</span><span>Out ${fmtTC(mk.out, fps)}</span><span>Duration ${fmtTC(mk.out - mk.in, fps)}</span>`;
}

// ------------------------------------------------------------------ timeline geometry
// Set from tokens in readTheme().
let RULER_H = 32, VH = 64, AH = 48, GAP = 10, LABEL_H = 16;
const xOf = (t) => (t - S.scroll) * S.zoom;
const tOf = (x) => x / S.zoom + S.scroll;

function layout() {
  const rows = []; let y = RULER_H + 6 - S.vscroll; let prev = null;
  for (const t of P().tracks) {
    if (prev === 'video' && t.kind === 'audio') y += GAP;
    const h = t.kind === 'video' ? VH : AH;
    rows.push({ track: t, y, h }); y += h + 3; prev = t.kind;
  }
  return { rows, contentH: y + S.vscroll + 10 };
}

function hitClip(x, y) {
  const { rows } = layout();
  const row = rows.find((r) => y >= r.y && y < r.y + r.h); if (!row) return null;
  const t = tOf(x);
  const c = P().clips.find((c) => c.trackId === row.track.id && t >= c.start - 6 / S.zoom && t <= end(c) + 6 / S.zoom);
  if (!c) return null;
  const x0 = xOf(c.start), x1 = xOf(end(c)); const w = x1 - x0; const grip = Math.min(8, w / 4);
  let edge = null;
  if (Math.abs(x - x0) <= grip || (x < x0 && x0 - x < 6)) edge = 'in';
  else if (Math.abs(x - x1) <= grip || (x > x1 && x - x1 < 6)) edge = 'out';
  if (!edge && (t < c.start || t > end(c))) return null;
  return { clip: c, edge, row };
}

function snapPoints(excludeIds) {
  const pts = [0, S.playhead];
  for (const c of P().clips) if (!excludeIds.has(c.id)) pts.push(c.start, end(c));
  return pts;
}
// Snap one of `cands` (absolute times) to the nearest point; returns delta to add.
function snapDelta(cands, excludeIds) {
  S.snapLine = null; if (!S.snap) return 0;
  const thr = 8 / S.zoom; let best = null;
  for (const p of snapPoints(excludeIds)) for (const c of cands) {
    const d = p - c; if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, p };
  }
  if (best) { S.snapLine = best.p; return best.d; }
  return 0;
}

function renderTimeline() {
  const cv = $('tlCanvas'); const { w, h, d } = fitCanvas(cv); const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
  const { rows } = layout();
  const tA = tOf(0), tB = tOf(w);

  rows.forEach((r, i) => {
    ctx.fillStyle = i % 2 ? C.lane : C.laneAlt; ctx.globalAlpha = 0.9;
    ctx.fillRect(0, r.y, w, r.h); ctx.globalAlpha = 1;
    const off = r.track.kind === 'video' ? r.track.hidden : r.track.muted;
    for (const c of P().clips) {
      if (c.trackId !== r.track.id || end(c) < tA || c.start > tB) continue;
      drawClip(ctx, c, r, w, off);
    }
  });

  // The take being recorded, growing from where it started to the playhead.
  if (S.rec && S.rec.startedWall) {
    const r = rows.find((row) => row.track.id === S.rec.trackId);
    if (r) {
      const rx0 = xOf(S.rec.start), rw = Math.max(0, S.playhead - S.rec.start) * S.zoom;
      ctx.globalAlpha = 0.35; ctx.fillStyle = C.playhead; ctx.fillRect(rx0, r.y + 1, rw, r.h - 2); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.playhead; ctx.lineWidth = C.lineThin; ctx.strokeRect(rx0, r.y + 1, rw, r.h - 2);
    }
  }

  // Drop ghost
  if (S.dropTarget) {
    const dt = S.dropTarget; const dl = dt.out - dt.in;
    for (const r of rows) if (r.track.id === dt.vTrack || r.track.id === dt.aTrack) {
      ctx.globalAlpha = 0.5; ctx.fillStyle = r.track.kind === 'video' ? C.video : C.audio;
      ctx.fillRect(xOf(dt.start), r.y + 1, dl * S.zoom, r.h - 2); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.select; ctx.lineWidth = C.lineThin; ctx.strokeRect(xOf(dt.start), r.y + 1, dl * S.zoom, r.h - 2);
    }
  }
  if (S.snapLine != null && (S.drag || S.dropTarget)) {
    ctx.fillStyle = C.mark; ctx.fillRect(Math.round(xOf(S.snapLine)) - 0.5, RULER_H, 1, h);
  }

  // Ruler
  ctx.fillStyle = C.ruler; ctx.fillRect(0, 0, w, RULER_H);
  const fps = seqFps();
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
  const major = steps.find((s) => s * S.zoom >= 80) || 3600;
  const minor = major / (major >= 1 && major % 5 === 0 ? 5 : 2);
  ctx.fillStyle = C.muted; ctx.font = `${C.codeSize}px ${C.mono}`; ctx.textBaseline = 'middle';
  for (let t = Math.floor(tA / minor) * minor; t <= tB; t += minor) {
    if (t < -EPS) continue;
    const x = Math.round(xOf(t)) + 0.5; const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ctx.globalAlpha = isMajor ? 0.9 : 0.4; ctx.fillRect(x, isMajor ? 0 : RULER_H * 0.7, 1, isMajor ? RULER_H : RULER_H * 0.3);
    if (isMajor) ctx.fillText(major < 1 ? fmtTC(t) : fmtTC(t).slice(0, 8), x + 4, RULER_H / 2);
  }
  ctx.globalAlpha = 1;

  // Playhead
  const px = Math.round(xOf(S.playhead)) + 0.5;
  ctx.fillStyle = C.playhead; ctx.fillRect(px - C.line / 2, 0, C.line, h);
  ctx.beginPath(); ctx.moveTo(px - 7, 0); ctx.lineTo(px + 8, 0); ctx.lineTo(px + 0.5, 10); ctx.fill();
}

function drawClip(ctx, c, r, cw, off) {
  const a = S.assets[c.mediaId]; const m = S.media[c.mediaId];
  const x0 = xOf(c.start), wpx = len(c) * S.zoom; const y = r.y + 1, h = r.h - 2;
  const vx0 = Math.max(x0, -4), vx1 = Math.min(x0 + wpx, cw + 4);
  if (vx1 <= vx0) return;
  const isVideo = r.track.kind === 'video';
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x0, y, Math.max(1, wpx), h, C.radius); ctx.clip();
  ctx.fillStyle = !m || m.status !== 'ready' ? C.missing : isVideo ? C.video : C.audio;
  ctx.fillRect(vx0, y, vx1 - vx0, h);
  if (a && a.ready) {
    if (isVideo && a.hasFrames) {
      const th = h - LABEL_H; const tw = Math.max(16, (th * (m.width || 16)) / (m.height || 9));
      // Tiles sit on a grid in source time, not from the clip's left edge, so a
      // trim reveals or hides frames instead of sliding the whole strip.
      const tileDur = tw / S.zoom;
      const first = Math.floor((c.in + (vx0 - x0) / S.zoom) / tileDur);
      for (let k = first; x0 + (k * tileDur - c.in) * S.zoom < vx1; k++) {
        const tx = x0 + (k * tileDur - c.in) * S.zoom;
        const mt = clamp((k + 0.5) * tileDur, c.in, c.out - EPS);
        const img = a.frameAt(mt, 40);
        if (img) drawContain(ctx, img, img.naturalWidth, img.naturalHeight, tx, y + LABEL_H, tw, th);
      }
    } else if (!isVideo) {
      a.loadPeaks();
      drawWave(ctx, a.peaks, c.in + (vx0 - x0) / S.zoom, c.in + (vx1 - x0) / S.zoom, vx0, y + LABEL_H, vx1 - vx0, h - LABEL_H, C.wave);
    }
  }
  // label strip
  ctx.fillStyle = isVideo ? C.video : C.audio; ctx.fillRect(vx0, y, vx1 - vx0, LABEL_H);
  ctx.fillStyle = isVideo ? C.videoText : C.audioText; ctx.font = `${C.uiSize}px ${C.sans}`; ctx.textBaseline = 'middle';
  const vol = c.volume != null && c.volume !== 1 ? `  ${(20 * Math.log10(Math.max(c.volume, 0.0001))).toFixed(1)} dB` : '';
  ctx.fillText(((m && m.name) || 'Missing media') + vol, Math.max(x0, 0) + 6, y + LABEL_H / 2);
  if (off) { ctx.globalAlpha = 0.6; ctx.fillStyle = C.lane; ctx.fillRect(vx0, y, vx1 - vx0, h); ctx.globalAlpha = 1; }
  ctx.restore();
  if (S.selection.has(c.id)) {
    ctx.strokeStyle = C.select; ctx.lineWidth = C.line;
    ctx.beginPath(); ctx.roundRect(x0 + 1, y + 1, Math.max(1, wpx - 2), h - 2, C.radius); ctx.stroke();
  }
  if (S.source.clipId === c.id) { ctx.fillStyle = C.mark; ctx.fillRect(x0 + 2, y + h - C.lineThick, Math.max(1, wpx - 4), C.line); }
}

function renderTrackHeads() {
  const el = $('trackHeads'); const { rows } = layout();
  el.innerHTML = '';
  for (const r of rows) {
    const d = document.createElement('div'); d.className = 'track-head';
    d.style.top = r.y + 'px'; d.style.height = r.h + 'px';
    const isV = r.track.kind === 'video';
    const pressed = isV ? r.track.hidden : r.track.muted;
    const recHere = S.rec && S.rec.trackId === r.track.id;
    d.innerHTML = `<span class="tname text-labels-medium">${escapeHtml(r.track.name)}</span>
      ${dsToggle(isV ? 'Hide' : 'Mute', !!pressed, isV ? 'Hide this track' : 'Mute this track')}
      ${isV ? '' : dsIconButton(recHere ? 'primary' : 'subtle', recHere ? 'stop' : 'mic', 'rec', recHere ? 'Stop recording' : 'Record onto this track from the playhead')}`;
    if (!isV) d.querySelector('.rec').onclick = () => {
      if (!S.rec) startRecording(r.track.id);
      else if (S.rec.trackId === r.track.id) stopRecording();
      else toast(`Already recording on ${trackById(S.rec.trackId)?.name || 'another track'}`);
    };
    d.querySelector('input').onchange = () => mutate(isV ? 'Toggle track visibility' : 'Toggle mute', () => {
      const t = trackById(r.track.id); if (isV) t.hidden = !t.hidden; else t.muted = !t.muted;
    });
    el.append(d);
  }
}

// ------------------------------------------------------------------ edits / undo
function editState() { return JSON.stringify({ tracks: P().tracks, clips: P().clips, settings: P().settings, bin: P().bin }); }
function restoreState(json) { Object.assign(P(), JSON.parse(json)); afterStructureChange(); }

function mutate(label, fn) {
  const before = editState(); fn(); commit(label, before);
}
function commit(label, before) {
  if (before === editState()) { requestRender(); return; }
  S.undo.push({ label, state: before }); if (S.undo.length > 500) S.undo.shift();
  S.redo = [];
  afterStructureChange(); markDirty();
}
function undo() {
  const u = S.undo.pop(); if (!u) return toast('Nothing to undo');
  S.redo.push({ label: u.label, state: editState() }); restoreState(u.state); markDirty(); toast('Undo: ' + u.label);
}
function redo() {
  const r = S.redo.pop(); if (!r) return toast('Nothing to redo');
  S.undo.push({ label: r.label, state: editState() }); restoreState(r.state); markDirty(); toast('Redo: ' + r.label);
}
function afterStructureChange() {
  for (const id of [...S.selection]) if (!clipById(id)) S.selection.delete(id);
  if (S.source.clipId && !clipById(S.source.clipId)) S.source.clipId = null;
  if (S.play && S.play.target === 'program') restartPlayback();
  renderTrackHeads(); updateClipVolumeUI(); updateUndoButtons(); requestRender();
  $('seqInfo').textContent = `${P().settings.width}×${P().settings.height} · ${+P().settings.fps.toFixed(3)} fps`;
}
function updateUndoButtons() { $('undoBtn').disabled = !S.undo.length; $('redoBtn').disabled = !S.redo.length; }

// Remove whatever is under [s, e) on a track, trimming or splitting neighbours.
function overwrite(trackId, s, e, exclude) {
  const clips = P().clips; const add = [];
  for (const c of [...clips]) {
    if (c.trackId !== trackId || exclude.has(c.id)) continue;
    const cs = c.start, ce = end(c);
    if (ce <= s + EPS || cs >= e - EPS) continue;
    if (cs >= s - EPS && ce <= e + EPS) { clips.splice(clips.indexOf(c), 1); continue; }
    if (cs < s && ce > e) {
      add.push({ ...c, id: uid(), linkId: null, start: e, in: c.in + (e - cs) });
      c.out = c.in + (s - cs);
    } else if (cs < s) c.out = c.in + (s - cs);
    else { const cut = e - cs; c.in += cut; c.start = e; }
  }
  clips.push(...add);
}

function placeMedia(target) {
  const m = S.media[target.mediaId]; if (!m) return;
  mutate('Add clip', () => {
    if (P().settings.auto && m.hasVideo) {
      P().settings = { width: m.width, height: m.height, fps: m.fps, auto: false };
      toast(`Sequence set to ${m.width}×${m.height} @ ${+m.fps.toFixed(3)} fps from this clip`);
    }
    const linkId = target.vTrack && target.aTrack ? uid() : null; const ids = [];
    const e = target.start + (target.out - target.in);
    for (const tid of [target.vTrack, target.aTrack]) {
      if (!tid) continue;
      overwrite(tid, target.start, e, new Set());
      const c = { id: uid(), mediaId: m.id, trackId: tid, start: target.start, in: target.in, out: target.out, linkId, volume: 1 };
      P().clips.push(c); ids.push(c.id);
    }
    S.selection = new Set(ids);
  });
  S.playhead = qt(target.start + (target.out - target.in));
  S.uiDirty = true; requestRender();
}

// Trim helpers shared by edge drags, source-viewer In/Out and Q/W.
function trimGroup(c, alt) { return [c, ...(S.linked && !alt ? partners(c) : [])].map((x) => ({ ...x })); }
function clampTrim(set, edge, delta) {
  let lo = -Infinity, hi = Infinity; const ids = new Set(set.map((o) => o.id)); const md = minDur();
  for (const o of set) {
    const others = P().clips.filter((c) => c.trackId === o.trackId && !ids.has(c.id));
    if (edge === 'in') {
      lo = Math.max(lo, -o.in, -o.start); hi = Math.min(hi, o.out - o.in - md);
      for (const c of others) if (end(c) <= o.start + EPS) lo = Math.max(lo, end(c) - o.start);
    } else {
      hi = Math.min(hi, mediaDur(o.mediaId) - o.out); lo = Math.max(lo, o.in + md - o.out);
      for (const c of others) if (c.start >= end(o) - EPS) hi = Math.min(hi, c.start - end(o));
    }
  }
  return lo > hi ? 0 : clamp(delta, lo, hi);
}
function applyTrim(set, edge, delta) {
  for (const o of set) {
    const c = clipById(o.id); if (!c) continue;
    if (edge === 'in') { c.in = o.in + delta; c.start = o.start + delta; } else c.out = o.out + delta;
  }
}

function splitAt(t) {
  const under = P().clips.filter((c) => c.start + EPS < t && end(c) - EPS > t);
  const targets = S.selection.size ? under.filter((c) => S.selection.has(c.id)) : under;
  if (!targets.length) return toast('No clip under the playhead to split');
  mutate('Split', () => {
    const links = {}; const fresh = [];
    for (const c of targets) {
      const off = t - c.start;
      const right = { ...c, id: uid(), start: t, in: c.in + off };
      if (c.linkId) right.linkId = links[c.linkId] || (links[c.linkId] = uid());
      c.out = c.in + off; P().clips.push(right); fresh.push(right.id);
    }
    if (S.selection.size) S.selection = new Set(fresh);
  });
}

function deleteSelected(ripple) {
  if (!S.selection.size) return;
  mutate(ripple ? 'Ripple delete' : 'Delete', () => {
    const gone = P().clips.filter((c) => S.selection.has(c.id));
    P().clips = P().clips.filter((c) => !S.selection.has(c.id));
    if (ripple) {
      const byTrack = {};
      for (const c of gone) (byTrack[c.trackId] = byTrack[c.trackId] || []).push([c.start, end(c)]);
      for (const c of P().clips) {
        const ranges = byTrack[c.trackId]; if (!ranges) continue;
        let shift = 0; for (const [s, e] of ranges) if (e <= c.start + EPS) shift += e - s;
        c.start = Math.max(0, c.start - shift);
      }
    }
    S.selection.clear();
  });
}

function trimSelectedToPlayhead(edge) {
  const c = [...S.selection].map(clipById).find((c) => c && c.start < S.playhead && end(c) > S.playhead);
  if (!c) return toast('Select a clip under the playhead');
  const set = trimGroup(c);
  mutate(edge === 'in' ? 'Trim start' : 'Trim end', () => {
    const delta = edge === 'in' ? S.playhead - c.start : S.playhead - end(c);
    applyTrim(set, edge, clampTrim(set, edge, delta));
  });
}

// ------------------------------------------------------------------ saving
function setSaveState(state, text) {
  $('saveState').dataset.state = state; $('saveText').textContent = text;
}
function markDirty() {
  S.changeSeq++; setSaveState('dirty', 'Saving…');
  clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 350);
}
function projectBody(rev) {
  return { ...P(), rev, ui: { playhead: S.playhead, zoom: S.zoom, scroll: S.scroll, snap: S.snap, linked: S.linked } };
}
async function save({ snapshot } = {}) {
  if (!P()) return;
  if (S.saving) { S.saveAgain = true; return; }
  clearTimeout(S.saveTimer);
  S.saving = true; const seq = S.changeSeq; const rev = S.rev + 1;
  setSaveState('saving', 'Saving…');
  try {
    await api('PUT', `/api/projects/${enc(S.slug)}${snapshot ? '?snapshot=1' : ''}`, projectBody(rev));
    S.rev = rev; S.savedSeq = Math.max(S.savedSeq, seq); S.uiDirty = false; S.saveError = null;
    P().rev = rev;
    if (S.savedSeq === S.changeSeq) setSaveState('saved', `Saved to disk ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    S.saveError = e;
    setSaveState('error', e.status === 409 ? 'Saved from another tab — reload' : 'Not saved — retrying');
    if (e.status !== 409) { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 2000); }
    else toast(e.message, true);
  } finally {
    S.saving = false;
    if (S.saveAgain) { S.saveAgain = false; save(); }
  }
}
async function flushSave(opts) {
  while (S.saving) await new Promise((r) => setTimeout(r, 50));
  if (S.changeSeq !== S.savedSeq || S.uiDirty || (opts && opts.snapshot)) await save(opts);
  if (S.saveError) throw S.saveError;
}
setInterval(() => { if (S.uiDirty && !S.saving && S.changeSeq === S.savedSeq) save(); }, 5000);
window.addEventListener('beforeunload', (e) => {
  if (!P()) return;
  if (S.rec) { e.preventDefault(); e.returnValue = ''; }
  if (S.changeSeq !== S.savedSeq || S.uiDirty) {
    fetch(`/api/projects/${enc(S.slug)}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(projectBody(S.rev + 1)) });
    if (S.changeSeq !== S.savedSeq) { e.preventDefault(); e.returnValue = ''; }
  }
});

// ------------------------------------------------------------------ playback
function restartPlayback() { const p = S.play; if (!p) return; const t = playTime(p); stop(true); setPos(p.target, t); play(p.target, p.rate); }
function onAudioLoaded() { if (S.play && S.play.rate > 0) restartPlayback(); }
// Audio hardware clock keeps picture locked to sound; fall back to the wall clock
// if the audio device isn't running (no output device, suspended context).
function playTime(p) {
  const wall = performance.now() / 1000 - p.w0;
  let el = actx.currentTime - p.c0;
  if (!p.wall && wall > 0.3 && (actx.state !== 'running' || el < wall * 0.5)) p.wall = true;
  if (p.wall) el = wall;
  return p.t0 + Math.max(0, el) * p.rate;
}
function getPos(target) { return target === 'program' ? S.playhead : S.source.t; }
function setPos(target, t) { if (target === 'program') { S.playhead = Math.max(0, t); S.uiDirty = true; } else S.source.t = t; }

function play(target, rate = 1) {
  if (S.play) stop(true);
  const ctx = audioCtx(); if (ctx.state !== 'running') ctx.resume();
  let t0 = getPos(target);
  if (target === 'program') {
    // While recording, play runs from the playhead even on an empty timeline or past its end.
    const e = seqEnd(); if (!e && !S.rec) return;
    if (rate > 0 && t0 >= e - EPS && !S.rec) t0 = 0;
  } else {
    const a = S.assets[S.source.mediaId]; if (!a || !a.ready) return;
    const mk = sourceMarks();
    if (rate > 0 && t0 >= (S.source.clipId ? mk.out : a.meta.duration) - EPS) t0 = mk.in;
  }
  setPos(target, t0);
  const p = { target, rate, t0, c0: ctx.currentTime + 0.08, w0: performance.now() / 1000 + 0.08, nodes: [] };
  S.play = p;
  if (rate > 0) {
    const sched = (buf, startAt, offset, dur, gain) => {
      if (!buf || dur <= 0 || offset >= buf.duration) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
      const g = ctx.createGain(); g.gain.value = gain; src.connect(g).connect(master);
      src.start(startAt, Math.max(0, offset), dur); p.nodes.push(src);
    };
    if (target === 'program') {
      for (const c of P().clips) {
        const tr = trackById(c.trackId); if (!tr || tr.kind !== 'audio' || tr.muted || end(c) <= t0) continue;
        const a = S.assets[c.mediaId]; if (!a) continue;
        if (!a.audioBuf) { a.loadAudio(); continue; }
        const delay = Math.max(0, c.start - t0) / rate; const into = Math.max(0, t0 - c.start);
        sched(a.audioBuf, p.c0 + delay, c.in + into, len(c) - into, c.volume ?? 1);
      }
    } else {
      const a = S.assets[S.source.mediaId]; const gain = sourceAudioGain();
      if (gain > 0 && a.audioBuf) sched(a.audioBuf, p.c0, t0, a.meta.duration - t0, gain);
      else if (gain > 0) a.loadAudio();
    }
  }
  updateTransport();
}
// `internal` is for the engine's own restarts (after an edit, when audio loads).
// Any other stop is the user's, and it also ends a recording in progress.
function stop(internal = false) {
  if (S.rec && !internal && !S.rec.stopping) { stopRecording(); return; }
  const p = S.play; if (!p) return;
  for (const n of p.nodes) { try { n.stop(); } catch {} }
  for (const a of Object.values(S.assets)) { const v = a.videos[p.target]; if (v && !v.paused) v.pause(); if (v) v._clip = null; }
  setPos(p.target, qt(getPos(p.target), p.target === 'program' ? seqFps() : (S.assets[S.source.mediaId] || {}).meta?.fps || seqFps()));
  S.play = null; updateTransport(); requestRender();
}
function togglePlay(target) { if (S.play && S.play.target === target && S.play.rate !== 0) stop(); else play(target, 1); }
function shuttle(dir) {
  const target = S.focus === 'source' ? 'source' : 'program';
  const cur = S.play && S.play.target === target ? S.play.rate : 0;
  let rate;
  if (dir > 0) rate = cur > 0 ? Math.min(cur * 2, 8) : 1;
  else rate = cur < 0 ? Math.max(cur * 2, -8) : -1;
  play(target, rate);
}
function updateTransport() {
  const p = S.play;
  $('pgPlay').querySelector('.ds-icon').textContent = p && p.target === 'program' ? 'pause' : 'play_arrow';
  $('srcPlay').querySelector('.ds-icon').textContent = p && p.target === 'source' ? 'pause' : 'play_arrow';
  $('rateLabel').textContent = p && p.rate !== 1 ? `${p.rate > 0 ? '▶' : '◀'} ${Math.abs(p.rate)}×` : '';
}

function syncProgramVideo(p, t) {
  const clip = topClipAt(t);
  const a = clip && S.assets[clip.mediaId];
  const v = p.rate > 0 && p.rate <= 4 && a ? a.video('program') : null;
  const next = topClipAt(t + 0.6); const na = next && next !== clip && S.assets[next.mediaId];
  const nv = na ? na.video('program') : null;
  for (const o of Object.values(S.assets)) { const ov = o.videos.program; if (ov && ov !== v && !ov.paused) ov.pause(); }
  if (v) {
    const want = clip.in + t - clip.start;
    if (v._clip !== clip.id) {
      if (Math.abs(v.currentTime - want) > 0.1) { v._queued = null; v.currentTime = want; }
      v._clip = clip.id;
    } else if (!v.seeking && Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (v.playbackRate !== p.rate) v.playbackRate = p.rate;
    if (v.paused) v.play().catch(() => {});
  }
  // Pre-roll the next clip's proxy so the cut is clean.
  if (nv && nv !== v && nv._clip !== next.id && nv.readyState >= 1) { nv._clip = next.id; nv.currentTime = next.in; }
}
function syncSourceVideo(p, t) {
  const a = S.assets[S.source.mediaId]; if (!a) return;
  const v = p.rate > 0 && p.rate <= 4 ? a.video('source') : null; if (!v) return;
  if (v._clip !== 'src') { v._clip = 'src'; v._queued = null; v.currentTime = t; }
  else if (!v.seeking && Math.abs(v.currentTime - t) > 0.3) v.currentTime = t;
  if (v.playbackRate !== p.rate) v.playbackRate = p.rate;
  if (v.paused) v.play().catch(() => {});
}

// How loud the Source viewer plays. Media from the bin plays at full volume; a
// timeline clip plays only the audio it has on the timeline (its linked audio
// clip, at that clip's gain), so deleting or muting a clip's sound silences it here too.
function sourceAudioGain() {
  const c = S.source.clipId && clipById(S.source.clipId);
  if (!c) return 1;
  const ac = [c, ...partners(c)].find((x) => trackById(x.trackId) && trackById(x.trackId).kind === 'audio');
  if (!ac || trackById(ac.trackId).muted) return 0;
  return ac.volume ?? 1;
}

// Audio scrubbing: short enveloped grains at the scrub position.
let lastGrain = 0;
function scrubAudio(target) {
  const ctx = audioCtx(); if (ctx.state !== 'running') ctx.resume();
  const now = ctx.currentTime; if (now - lastGrain < 0.045) return; lastGrain = now;
  const G = 0.08;
  const grain = (buf, off, gain) => {
    if (!buf || off < 0 || off >= buf.duration - 0.01) return;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(gain, now + 0.006);
    g.gain.setValueAtTime(gain, now + G - 0.02); g.gain.linearRampToValueAtTime(0, now + G);
    src.connect(g).connect(master); src.start(now, off, G);
  };
  if (target === 'program') {
    const t = S.playhead;
    for (const c of P().clips) {
      const tr = trackById(c.trackId); if (!tr || tr.kind !== 'audio' || tr.muted || c.start > t || end(c) <= t) continue;
      const a = S.assets[c.mediaId]; if (!a) continue; if (!a.audioBuf) { a.loadAudio(); continue; }
      grain(a.audioBuf, c.in + t - c.start, c.volume ?? 1);
    }
  } else {
    const a = S.assets[S.source.mediaId]; const gain = sourceAudioGain(); if (!a || gain <= 0) return;
    if (!a.audioBuf) { a.loadAudio(); return; }
    grain(a.audioBuf, S.source.t, gain);
  }
}

// ------------------------------------------------------------------ recording
// A take records from the microphone while the sequence plays from the playhead.
// Chunks stream to the project folder every second (server.js keeps them in
// recordings/), so a crash loses at most the last second; on stop the take is
// placed where it started, on a new audio track if it would overlap a clip.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startRecording(trackId) {
  if (S.rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("This browser can't record audio", true);
  if (S.play) stop(true);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('Microphone access was blocked. Allow it for this page in the browser to record.', true); }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try { rec = await api('POST', `/api/projects/${enc(S.slug)}/recordings`, { trackId, start: S.playhead, mimeType }); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); return toast('Could not start recording: ' + e.message, true); }
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const R = S.rec = { id: rec.id, slug: S.slug, trackId, start: S.playhead, recorder, stream, sending: Promise.resolve(), lost: 0, startedWall: 0 };
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) R.sending = R.sending.then(() => sendChunk(R, e.data)); };
  recorder.onstart = () => {
    R.start = S.playhead; R.startedWall = performance.now();
    play('program', 1);
    renderTrackHeads(); requestRender('timeline');
  };
  recorder.start(1000);
  toast(`Recording on ${trackById(trackId).name}. Click the stop button (or press Space) to finish.`);
}

async function sendChunk(R, blob) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/projects/${enc(R.slug)}/recordings/${R.id}/chunk`, { method: 'POST', body: blob });
      if (res.ok) return;
      throw new Error(String(res.status));
    } catch {
      if (attempt >= 5) { R.lost++; toast('Part of the recording could not be saved to disk', true); return; }
      await sleep(500 * (attempt + 1));
    }
  }
}

async function stopRecording() {
  const R = S.rec; if (!R || R.stopping) return;
  R.stopping = true;
  const stopped = new Promise((res) => R.recorder.addEventListener('stop', res, { once: true }));
  if (R.recorder.state !== 'inactive') R.recorder.stop();
  stop(true);
  await stopped;
  R.stream.getTracks().forEach((t) => t.stop());
  await R.sending; // every chunk is on disk before finishing
  const measured = R.startedWall ? (performance.now() - R.startedWall) / 1000 : 0;
  const trackName = trackById(R.trackId)?.name || 'audio';
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const name = `Recording ${trackName} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
  let meta;
  try { meta = await api('POST', `/api/projects/${enc(R.slug)}/recordings/${R.id}/finish`, { name }); }
  catch (e) {
    S.rec = null; renderTrackHeads(); requestRender('timeline');
    return toast("The take is saved in the project's recordings folder, but adding it failed: " + e.message, true);
  }
  S.rec = null;
  if (R.slug !== S.slug) return; // project was switched; the take is in that project's bin
  await refreshMedia();
  const dur = meta.duration > 0 ? meta.duration : measured;
  if (dur > 0) placeRecording(meta.id, R.trackId, R.start, dur);
  renderTrackHeads(); requestRender();
  toast(R.lost ? 'Recording added, but part of it could not be saved' : 'Recording added to the timeline', !!R.lost);
}

function placeRecording(mediaId, trackId, start, dur) {
  mutate('Record audio', () => {
    let tid = trackById(trackId) ? trackId : P().tracks.find((t) => t.kind === 'audio')?.id;
    const e = start + dur;
    const hits = (id) => P().clips.some((c) => c.trackId === id && c.start < e - EPS && end(c) > start + EPS);
    if (!tid || hits(tid)) {
      // Keep both: put the take on a new audio track right below this one.
      const t = { id: 'A' + uid(), kind: 'audio', name: '', muted: false };
      const at = tid ? P().tracks.findIndex((x) => x.id === tid) + 1 : P().tracks.length;
      P().tracks.splice(at, 0, t); tid = t.id;
      // Keep audio track labels in order top to bottom (A1, A2, …); ids don't change.
      P().tracks.filter((x) => x.kind === 'audio').forEach((x, i) => { x.name = 'A' + (i + 1); });
    }
    const c = { id: uid(), mediaId, trackId: tid, start, in: 0, out: dur, linkId: null, volume: 1 };
    P().clips.push(c); S.selection = new Set([c.id]);
  });
}

// ------------------------------------------------------------------ main loop
function frame() {
  const p = S.play;
  if (p) {
    const t = playTime(p);
    if (p.target === 'program') {
      const e = seqEnd();
      if (p.rate > 0 && t >= e && !S.rec) { S.playhead = e; stop(); }
      else if (p.rate < 0 && t <= 0) { S.playhead = 0; stop(); }
      else {
        S.playhead = t; syncProgramVideo(p, t);
        if (p.rate < 0 || p.rate > 4) { const c = topClipAt(t); if (c && S.assets[c.mediaId]) S.assets[c.mediaId].preload(c.in + t - c.start, p.rate < 0 ? 2 : 0.2, p.rate < 0 ? 0.2 : 2); }
        const w = $('tlCanvas').clientWidth; const x = xOf(t);
        if (x > w - 40 || x < 0) S.scroll = Math.max(0, t - (p.rate > 0 ? 40 : w - 40) / S.zoom);
      }
      dirty.program = dirty.timeline = true;
    } else {
      const a = S.assets[S.source.mediaId];
      const mk = sourceMarks(); const stopAt = S.source.clipId ? mk.out : a ? a.meta.duration : 0;
      if (!a || (p.rate > 0 && t >= stopAt)) { S.source.t = Math.min(stopAt, t); stop(); }
      else if (p.rate < 0 && t <= 0) { S.source.t = 0; stop(); }
      else { S.source.t = t; syncSourceVideo(p, t); if (p.rate < 0 || p.rate > 4) a.preload(t, 2, 2); }
      dirty.source = true;
    }
  }
  try {
    if (P()) {
      if (dirty.program) { dirty.program = false; renderProgram(); }
      if (dirty.source) { dirty.source = false; renderSource(); }
      if (dirty.timeline) { dirty.timeline = false; renderTimeline(); }
      if (dirty.bin) { dirty.bin = false; renderBinThumbs(); }
    }
  } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ source viewer
function sourceMarks() {
  const s = S.source;
  if (s.clipId) { const c = clipById(s.clipId); if (c) return { in: c.in, out: c.out }; }
  const D = mediaDur(s.mediaId); const m = (P().bin.marks || {})[s.mediaId] || {};
  return { in: clamp(m.in ?? 0, 0, D), out: clamp(m.out ?? D, 0, D) };
}
function loadSource(mediaId, clipId = null) {
  if (S.play && S.play.target === 'source') stop();
  const a = S.assets[mediaId]; if (!a) return;
  const c = clipId && clipById(clipId);
  const sameSource = S.source.mediaId === mediaId && S.source.clipId === clipId;
  S.source = { mediaId, clipId, t: sameSource ? S.source.t : c ? c.in : sourceMarksFor(mediaId).in };
  if (c) { // keep the source playhead in sync with the program playhead when it's over this clip
    if (S.playhead >= c.start && S.playhead < end(c)) S.source.t = c.in + S.playhead - c.start;
  }
  $('sourceTitle').textContent = (c ? 'Timeline clip · ' : '') + a.meta.name;
  $('sourceDur').textContent = fmtTC(a.meta.duration, a.meta.fps || seqFps());
  $('srcInsert').hidden = !!c;
  a.preload(S.source.t, 1, 3); a.loadAudio(); a.loadPeaks();
  updateClipVolumeUI(); markBinActive(); requestRender();
}
function sourceMarksFor(id) { const prev = S.source; S.source = { mediaId: id, clipId: null }; const m = sourceMarks(); S.source = prev; return m; }

function setSourceMark(which) {
  const s = S.source; const a = S.assets[s.mediaId]; if (!a) return;
  const t = qt(s.t, a.meta.fps || seqFps());
  if (s.clipId) {
    const c = clipById(s.clipId); if (!c) return;
    const set = trimGroup(c);
    const delta = which === 'in' ? t - c.in : t - c.out;
    mutate(which === 'in' ? 'Set clip in' : 'Set clip out', () => {
      const d = clampTrim(set, which, delta); applyTrim(set, which, d);
      if (Math.abs(d - delta) > 1e-3) toast('Limited by a neighbouring clip or the media length');
    });
  } else {
    mutate(which === 'in' ? 'Mark in' : 'Mark out', () => {
      const marks = (P().bin.marks = P().bin.marks || {});
      const m = (marks[s.mediaId] = { ...sourceMarks() });
      m[which] = t;
      if (m.out - m.in < 1 / 60) { if (which === 'in') m.out = a.meta.duration; else m.in = 0; }
    });
  }
}

function stepFrames(target, n) {
  if (S.play) stop();
  if (target === 'program') { S.playhead = Math.max(0, qt(S.playhead + n / seqFps())); S.uiDirty = true; ensurePlayheadVisible(); }
  else {
    const a = S.assets[S.source.mediaId]; if (!a) return; const f = a.meta.fps || 30;
    S.source.t = clamp(qt(S.source.t + n / f, f), 0, a.meta.duration);
  }
  scrubAudio(target); requestRender();
}

function updateClipVolumeUI() {
  const c = S.source.clipId && clipById(S.source.clipId);
  const ac = c && [c, ...partners(c)].find((x) => trackById(x.trackId) && trackById(x.trackId).kind === 'audio');
  $('clipVolWrap').hidden = !ac;
  if (ac) { const v = ac.volume ?? 1; $('clipVol').value = v; $('clipVolVal').textContent = v ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '−∞ dB'; }
}

// ------------------------------------------------------------------ bin
const binEls = new Map();
function renderBin() {
  const grid = $('binGrid'); const hidden = new Set(P().bin.hidden || []);
  const used = new Set(P().clips.map((c) => c.mediaId));
  const items = [
    ...Object.values(S.media).filter((m) => !hidden.has(m.id)),
    ...Object.entries(S.uploads).map(([id, u]) => ({ id, name: u.name, status: 'uploading', progress: u.progress, upload: true })),
  ];
  const keep = new Set(items.map((m) => m.id));
  for (const [id, el] of binEls) if (!keep.has(id)) { el.remove(); binEls.delete(id); }
  for (const m of items) {
    let el = binEls.get(m.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'bin-item'; el.dataset.id = m.id;
      el.innerHTML = `<canvas width="256" height="144"></canvas><div class="name text-ui-small"></div><div class="meta text-code-small"><span class="d"></span><span class="k"></span></div><div class="status"></div>${dsIconButton('subtle', 'close', 'hide', 'Remove from bin (the file stays in the project folder)')}`;
      if (!m.upload) wireBinItem(el, m.id);
      el.querySelector('.hide').hidden = !!m.upload;
      grid.append(el); binEls.set(m.id, el);
    } else grid.append(el);
    el.querySelector('.name').textContent = m.name; el.querySelector('.name').title = m.name;
    el.classList.toggle('used', used.has(m.id));
    el.querySelector('.d').textContent = m.duration ? fmtDur(m.duration) : '';
    el.querySelector('.k').textContent = m.status === 'ready' ? (m.hasVideo ? `${m.width}×${m.height}` : 'audio') : '';
    const st = el.querySelector('.status');
    if (m.status === 'ready') st.innerHTML = '';
    else if (m.status === 'error') st.innerHTML = `<div class="err text-ui-small">${escapeHtml(m.error || 'Failed')}</div>${dsButton('outline', 'Retry', 'retry')}`;
    else {
      const label = m.status === 'uploading' ? 'Copying into project' : m.status === 'queued' ? 'Waiting…' : 'Building scrub cache';
      st.innerHTML = `<div class="text-ui-small">${label} ${Math.round((m.progress || 0) * 100)}%</div><div class="progress"><div class="bar" style="width:${(m.progress || 0) * 100}%"></div></div>`;
    }
    const retry = st.querySelector('.retry');
    if (retry) retry.onclick = async (e) => { e.stopPropagation(); await api('POST', `/api/projects/${enc(S.slug)}/media/${m.id}/retry`); refreshMedia(); };
  }
  $('binEmpty').hidden = items.length > 0;
  const hc = hidden.size;
  $('showHiddenBtn').hidden = !hc; setButtonText($('showHiddenBtn'), `Show ${hc} removed item${hc > 1 ? 's' : ''}`);
  markBinActive(); requestRender('bin');
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function markBinActive() { for (const [id, el] of binEls) el.classList.toggle('active', id === S.source.mediaId && !S.source.clipId); }

function renderBinThumbs() {
  for (const [id, el] of binEls) {
    const a = S.assets[id]; const cv = el.querySelector('canvas'); const ctx = cv.getContext('2d');
    ctx.fillStyle = C.lane; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!a || !a.ready) continue;
    if (a.hasFrames) {
      const img = el._skim != null ? a.frameAt(el._skim) : a.poster();
      if (img) drawContain(ctx, img, img.naturalWidth, img.naturalHeight, 0, 0, cv.width, cv.height);
      if (el._skim != null) { ctx.fillStyle = C.playhead; ctx.fillRect((el._skim / a.meta.duration) * cv.width - 1, 0, 3, cv.height); }
    } else { a.loadPeaks(); drawWave(ctx, a.peaks, 0, a.meta.duration, 0, 16, cv.width, cv.height - 32, C.audio); }
  }
}

function wireBinItem(el, id) {
  const cv = el.querySelector('canvas');
  cv.addEventListener('pointermove', (e) => {
    const a = S.assets[id]; if (!a || !a.hasFrames || S.mediaDrag) return;
    const r = cv.getBoundingClientRect(); el._skim = clamp((e.clientX - r.left) / r.width, 0, 1) * a.meta.duration;
    requestRender('bin');
  });
  cv.addEventListener('pointerleave', () => { el._skim = null; requestRender('bin'); });
  el.querySelector('.hide').addEventListener('click', (e) => {
    e.stopPropagation();
    mutate('Remove from bin', () => { const h = (P().bin.hidden = P().bin.hidden || []); if (!h.includes(id)) h.push(id); });
    renderBin();
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const m = S.media[id]; if (!m || m.status !== 'ready') return;
    beginMediaDrag(e, id, () => sourceMarksFor(id), () => { focusPanel('source'); loadSource(id); });
  });
}

// Pointer-driven drag from the bin or the source picture onto the timeline.
function beginMediaDrag(e, mediaId, getRange, onClick) {
  e.preventDefault();
  S.mediaDrag = { mediaId, getRange, onClick, x0: e.clientX, y0: e.clientY, started: false };
}
document.addEventListener('pointermove', (e) => {
  const md = S.mediaDrag; if (!md) return;
  if (!md.started && Math.hypot(e.clientX - md.x0, e.clientY - md.y0) > 5) { md.started = true; md.range = md.getRange(); document.body.style.cursor = 'copy'; }
  if (!md.started) return;
  const cv = $('tlCanvas'); const r = cv.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  S.dropTarget = inside ? dropTargetAt(e.clientX - r.left, e.clientY - r.top, md) : null;
  requestRender('timeline');
});
document.addEventListener('pointerup', () => {
  const md = S.mediaDrag; if (!md) return;
  S.mediaDrag = null; document.body.style.cursor = '';
  if (!md.started) { md.onClick && md.onClick(); return; }
  const t = S.dropTarget; S.dropTarget = null; S.snapLine = null;
  if (t) { placeMedia(t); focusPanel('program'); }
  requestRender();
});

function dropTargetAt(x, y, md) {
  const m = S.media[md.mediaId]; const { rows } = layout();
  const vts = P().tracks.filter((t) => t.kind === 'video'); const ats = P().tracks.filter((t) => t.kind === 'audio');
  let row = rows.find((r) => y >= r.y - 2 && y < r.y + r.h + 2);
  if (!row) row = y < rows[0].y ? rows[0] : rows[rows.length - 1];
  const level = row.track.kind === 'video' ? vts.length - 1 - vts.indexOf(row.track) : ats.indexOf(row.track);
  const vTrack = m.hasVideo && vts.length ? vts[vts.length - 1 - Math.min(level, vts.length - 1)].id : null;
  const aTrack = m.hasAudio && ats.length ? ats[Math.min(level, ats.length - 1)].id : null;
  const dl = md.range.out - md.range.in;
  let start = Math.max(0, tOf(x));
  start = Math.max(0, qt(start + snapDelta([start, start + dl], new Set())));
  return { mediaId: md.mediaId, vTrack, aTrack, start, in: md.range.in, out: md.range.out };
}

// ------------------------------------------------------------------ media import & polling
const uploadQueue = []; let uploadsActive = 0;
function importFiles(files) {
  for (const f of files) {
    const id = 'up-' + uid(); S.uploads[id] = { name: f.name, progress: 0 };
    uploadQueue.push({ id, file: f });
  }
  renderBin(); pumpUploads();
}
function pumpUploads() {
  while (uploadsActive < 2 && uploadQueue.length) {
    const { id, file } = uploadQueue.shift(); uploadsActive++;
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/projects/${enc(S.slug)}/media?name=${enc(file.name)}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { S.uploads[id].progress = e.loaded / e.total; renderBin(); } };
    const done = (ok) => {
      uploadsActive--; delete S.uploads[id];
      if (!ok) toast(`Couldn't import ${file.name}`, true);
      refreshMedia(); pumpUploads();
    };
    xhr.onload = () => done(xhr.status === 200); xhr.onerror = () => done(false);
    xhr.send(file);
  }
}

let pollTimer = 0;
async function refreshMedia() {
  clearTimeout(pollTimer);
  if (!S.slug) return;
  const slug = S.slug;
  let list;
  try { list = await api('GET', `/api/projects/${enc(slug)}/media`); } catch { pollTimer = setTimeout(refreshMedia, 2000); return; }
  if (slug !== S.slug) return;
  applyMediaList(list);
  if (list.some((m) => m.status !== 'ready' && m.status !== 'error')) pollTimer = setTimeout(refreshMedia, 800);
}
function applyMediaList(list) {
  for (const m of list) {
    const prev = S.media[m.id]; S.media[m.id] = m;
    let a = S.assets[m.id];
    if (!a) a = S.assets[m.id] = new Asset(m);
    else a.meta = m;
    if (m.status === 'ready' && (!prev || prev.status !== 'ready')) {
      a.loadPeaks(); a.preload(Math.min(1, m.duration / 3), 0, 0);
      if (P().clips.some((c) => c.mediaId === m.id)) a.loadAudio();
    }
  }
  renderBin(); requestRender();
}

// ------------------------------------------------------------------ timeline interaction
function focusPanel(which) {
  S.focus = which;
  $('sourcePanel').classList.toggle('focused', which === 'source');
  $('programPanel').classList.toggle('focused', which === 'program');
  $('timelinePanel').classList.toggle('focused', which === 'program');
}
function setPlayhead(t) { S.playhead = Math.max(0, qt(t)); S.uiDirty = true; syncSourceToPlayhead(); requestRender(); }
function syncSourceToPlayhead() {
  const c = S.source.clipId && clipById(S.source.clipId);
  if (c && S.playhead >= c.start && S.playhead < end(c)) { S.source.t = c.in + S.playhead - c.start; dirty.source = true; }
}
function ensurePlayheadVisible() {
  const w = $('tlCanvas').clientWidth; const x = xOf(S.playhead);
  if (x < 0 || x > w - 20) S.scroll = Math.max(0, S.playhead - (w * 0.4) / S.zoom);
}
function setSelection(clips) { S.selection = new Set(clips.map((c) => c.id)); requestRender('timeline'); }
function localXY(e, el) { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function wireTimeline() {
  const cv = $('tlCanvas');
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    focusPanel('program'); $('timelinePanel').focus({ preventScroll: true });
    const { x, y } = localXY(e, cv); cv.setPointerCapture(e.pointerId);
    if (S.play && S.play.target === 'program' && y < RULER_H) stop();
    const hit = y >= RULER_H ? hitClip(x, y) : null;
    if (!hit) {
      if (y >= RULER_H && !e.shiftKey) setSelection([]);
      if (S.play) stop();
      S.drag = { type: 'scrub' }; setPlayhead(tOf(x)); scrubAudio('program'); return;
    }
    const c = hit.clip;
    if (e.shiftKey || e.metaKey) {
      const group = [c, ...(S.linked ? partners(c) : [])];
      const on = !S.selection.has(c.id); for (const g of group) on ? S.selection.add(g.id) : S.selection.delete(g.id);
    } else if (!S.selection.has(c.id)) setSelection([c, ...(S.linked && !e.altKey ? partners(c) : [])]);
    loadSource(c.mediaId, c.id);
    const before = editState();
    if (hit.edge) {
      S.drag = { type: 'trim', edge: hit.edge, x0: x, before, set: trimGroup(c, e.altKey), grab: { ...c } };
    } else {
      let ids = new Set(e.altKey ? [c.id] : [...S.selection]);
      if (S.linked && !e.altKey) for (const id of [...ids]) for (const p of partners(clipById(id))) ids.add(p.id);
      S.drag = { type: 'move', x0: x, y0: y, before, started: false, grab: { ...c }, orig: [...ids].map((id) => ({ ...clipById(id) })) };
    }
    requestRender();
  });

  cv.addEventListener('pointermove', (e) => {
    const { x, y } = localXY(e, cv); const d = S.drag;
    if (!d) {
      const hit = y >= RULER_H ? hitClip(x, y) : null;
      cv.style.cursor = !hit ? (y < RULER_H ? 'ew-resize' : 'default') : hit.edge ? 'ew-resize' : 'grab';
      return;
    }
    if (d.type === 'scrub') { setPlayhead(tOf(Math.max(0, x))); scrubAudio('program'); edgeScroll(x, cv.clientWidth); return; }
    if (d.type === 'trim') {
      const raw = tOf(x) - tOf(d.x0);
      const ids = new Set(d.set.map((o) => o.id));
      const edgeT = d.edge === 'in' ? d.grab.start + raw : end(d.grab) + raw;
      const delta = qt(raw + snapDelta([edgeT], ids));
      applyTrim(d.set, d.edge, clampTrim(d.set, d.edge, delta));
      const c = clipById(d.grab.id);
      S.source.t = d.edge === 'in' ? c.in : Math.max(c.in, c.out - 1 / (S.media[c.mediaId].fps || 30));
      scrubAudio('source'); requestRender(); edgeScroll(x, cv.clientWidth); return;
    }
    if (d.type === 'move') {
      if (!d.started && Math.hypot(x - d.x0, y - d.y0) < 4) return;
      d.started = true; cv.style.cursor = 'grabbing';
      const ids = new Set(d.orig.map((o) => o.id));
      let dt = tOf(x) - tOf(d.x0);
      dt = Math.max(dt, -Math.min(...d.orig.map((o) => o.start)));
      const cands = []; for (const o of d.orig) cands.push(o.start + dt, end(o) + dt);
      dt = qt(dt + snapDelta(cands, ids)); dt = Math.max(dt, -Math.min(...d.orig.map((o) => o.start)));
      // Track change for clips of the grabbed clip's kind.
      const kind = trackById(d.grab.trackId).kind; const kt = P().tracks.filter((t) => t.kind === kind);
      const { rows } = layout(); const row = rows.find((r) => y >= r.y && y < r.y + r.h && r.track.kind === kind);
      let dTrack = row ? kt.indexOf(row.track) - kt.findIndex((t) => t.id === d.grab.trackId) : d.dTrack || 0;
      for (const o of d.orig) {
        if (trackById(o.trackId).kind !== kind) continue;
        const i = kt.findIndex((t) => t.id === o.trackId); dTrack = clamp(dTrack, -i, kt.length - 1 - i);
      }
      d.dTrack = dTrack;
      for (const o of d.orig) {
        const c = clipById(o.id); c.start = o.start + dt;
        if (trackById(o.trackId).kind === kind) c.trackId = kt[kt.findIndex((t) => t.id === o.trackId) + dTrack].id;
      }
      requestRender('timeline'); requestRender('program'); edgeScroll(x, cv.clientWidth);
    }
  });

  const finish = () => {
    const d = S.drag; S.drag = null; S.snapLine = null; cv.style.cursor = '';
    if (!d) return;
    if (d.type === 'trim') commit(d.edge === 'in' ? 'Trim start' : 'Trim end', d.before);
    if (d.type === 'move' && d.started) {
      const ids = new Set(d.orig.map((o) => o.id));
      for (const id of ids) { const c = clipById(id); overwrite(c.trackId, c.start, end(c), ids); }
      commit('Move clip', d.before);
    }
    requestRender();
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  // Wheel up/down (or pinch) zooms around the playhead, which stays put on
  // screen. Shift-wheel or a sideways swipe scrolls in time; Option-wheel
  // scrolls through tracks.
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cv.clientHeight : 1; // lines/pages → px
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.altKey) {
      const overflow = layout().contentH - cv.clientHeight;
      if (overflow > 0) { S.vscroll = clamp(S.vscroll + dy, 0, overflow); renderTrackHeads(); }
    } else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
      S.scroll = Math.max(0, S.scroll + (e.shiftKey && !dx ? dy : dx) / S.zoom);
    } else {
      zoomAroundPlayhead(S.zoom * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002))); return;
    }
    S.uiDirty = true; requestRender('timeline');
  }, { passive: false });
}
function edgeScroll(x, w) {
  if (x > w - 30) S.scroll += 12 / S.zoom; else if (x < 20 && S.scroll > 0) S.scroll = Math.max(0, S.scroll - 12 / S.zoom);
}
const ZMIN = 0.5, ZMAX = 2000;
function zoomAt(z, x) {
  const t = tOf(x); S.zoom = clamp(z, ZMIN, ZMAX); S.scroll = Math.max(0, t - x / S.zoom);
  $('zoomSlider').value = Math.round((Math.log(S.zoom / ZMIN) / Math.log(ZMAX / ZMIN)) * 1000);
  S.uiDirty = true; requestRender('timeline');
}
function zoomAroundPlayhead(z) { const x = clamp(xOf(S.playhead), 0, $('tlCanvas').clientWidth); zoomAt(z, x); }
function zoomFit() { const w = $('tlCanvas').clientWidth - 40; S.scroll = 0; zoomAt(w / Math.max(seqEnd(), 10), 0); }

// ------------------------------------------------------------------ source viewer interaction
function wireSource() {
  const bar = $('sourceScrub');
  const scrubTo = (e) => {
    const a = S.assets[S.source.mediaId]; if (!a) return;
    const { x } = localXY(e, bar); const f = a.meta.fps || 30;
    S.source.t = clamp(qt((x / bar.clientWidth) * a.meta.duration, f), 0, a.meta.duration);
    a.preload(S.source.t, 1, 1); scrubAudio('source'); requestRender('source');
  };
  bar.addEventListener('pointerdown', (e) => { focusPanel('source'); if (S.play) stop(); bar.setPointerCapture(e.pointerId); bar._down = true; scrubTo(e); });
  bar.addEventListener('pointermove', (e) => { if (bar._down) scrubTo(e); });
  bar.addEventListener('pointerup', () => (bar._down = false));
  bar.addEventListener('pointercancel', () => (bar._down = false));
  bar.addEventListener('wheel', (e) => { e.preventDefault(); focusPanel('source'); stepFrames('source', Math.sign(e.deltaY || e.deltaX)); }, { passive: false });

  $('sourceCanvas').addEventListener('pointerdown', (e) => {
    focusPanel('source');
    const id = S.source.mediaId; if (!id || e.button !== 0) return;
    beginMediaDrag(e, id, () => sourceMarks(), null);
  });
  $('sourcePanel').addEventListener('pointerdown', () => focusPanel('source'));
  $('programPanel').addEventListener('pointerdown', () => focusPanel('program'));
  // Drag on the program picture scrubs the sequence.
  const pc = $('programCanvas');
  pc.addEventListener('pointerdown', (e) => { if (S.play) stop(); pc.setPointerCapture(e.pointerId); pc._x = e.clientX; pc._t = S.playhead; });
  pc.addEventListener('pointermove', (e) => {
    if (pc._x == null) return;
    const range = Math.max(seqEnd(), 1); setPlayhead(clamp(pc._t + ((e.clientX - pc._x) / pc.clientWidth) * range, 0, range)); scrubAudio('program'); ensurePlayheadVisible();
  });
  pc.addEventListener('pointerup', () => (pc._x = null));

  $('srcIn').onclick = () => setSourceMark('in');
  $('srcOut').onclick = () => setSourceMark('out');
  $('srcPlay').onclick = () => { focusPanel('source'); togglePlay('source'); };
  $('srcPrev').onclick = () => stepFrames('source', -1);
  $('srcNext').onclick = () => stepFrames('source', 1);
  $('srcInsert').onclick = () => {
    const id = S.source.mediaId; if (!id) return; const m = S.media[id]; const mk = sourceMarks();
    const vts = P().tracks.filter((t) => t.kind === 'video'), ats = P().tracks.filter((t) => t.kind === 'audio');
    placeMedia({ mediaId: id, vTrack: m.hasVideo ? vts[vts.length - 1].id : null, aTrack: m.hasAudio ? ats[0].id : null, start: S.playhead, in: mk.in, out: mk.out });
  };
  let volBefore = null;
  $('clipVol').addEventListener('input', () => {
    const c = S.source.clipId && clipById(S.source.clipId); if (!c) return;
    if (volBefore == null) volBefore = editState();
    const v = Number($('clipVol').value);
    for (const x of [c, ...partners(c)]) if (trackById(x.trackId).kind === 'audio') x.volume = v;
    $('clipVolVal').textContent = v ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '−∞ dB';
    requestRender('timeline');
  });
  $('clipVol').addEventListener('change', () => { if (volBefore) { commit('Clip gain', volBefore); volBefore = null; } });

  $('pgPlay').onclick = () => { focusPanel('program'); togglePlay('program'); };
  $('pgPrev').onclick = () => stepFrames('program', -1);
  $('pgNext').onclick = () => stepFrames('program', 1);
  $('pgStart').onclick = () => { if (S.play) stop(); setPlayhead(0); ensurePlayheadVisible(); };
  $('pgEnd').onclick = () => { if (S.play) stop(); setPlayhead(seqEnd()); ensurePlayheadVisible(); };
}

// ------------------------------------------------------------------ keyboard
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    // Switches (checkbox inputs) keep the shortcuts working; text fields and sliders don't.
    if (e.target.closest('input:not([type="checkbox"]), select, textarea, dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    const target = S.focus === 'source' ? 'source' : 'program';
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); flushSave({ snapshot: true }).then(() => toast('Saved — version snapshot written')).catch(() => {}); return; }
    if (mod && k === 'a') { e.preventDefault(); setSelection(P().clips); return; }
    if (mod && (k === 'k' || k === 'b')) { e.preventDefault(); splitAt(S.playhead); return; }
    if (mod) return;
    switch (k) {
      case ' ': e.preventDefault(); togglePlay(target); break;
      case 'k': stop(); break;
      case 'l': shuttle(1); break;
      case 'j': shuttle(-1); break;
      case 'arrowleft': e.preventDefault(); stepFrames(target, e.shiftKey ? -Math.round(target === 'program' ? seqFps() : 30) : -1); break;
      case 'arrowright': e.preventDefault(); stepFrames(target, e.shiftKey ? Math.round(target === 'program' ? seqFps() : 30) : 1); break;
      case 'arrowup': e.preventDefault(); jumpEdit(-1); break;
      case 'arrowdown': e.preventDefault(); jumpEdit(1); break;
      case 'home': if (S.play) stop(); if (target === 'program') setPlayhead(0); else { S.source.t = 0; requestRender(); } ensurePlayheadVisible(); break;
      case 'end': if (S.play) stop(); if (target === 'program') setPlayhead(seqEnd()); else { S.source.t = mediaDur(S.source.mediaId); requestRender(); } ensurePlayheadVisible(); break;
      case 'i': setSourceMark('in'); break;
      case 'o': setSourceMark('out'); break;
      case 'q': trimSelectedToPlayhead('in'); break;
      case 'w': trimSelectedToPlayhead('out'); break;
      case 's': splitAt(S.playhead); break;
      case 'backspace': case 'delete': e.preventDefault(); deleteSelected(e.shiftKey); break;
      case 'n': toggleSnap(); break;
      case '=': case '+': zoomAroundPlayhead(S.zoom * 1.5); break;
      case '-': zoomAroundPlayhead(S.zoom / 1.5); break;
      case '\\': zoomFit(); break;
      case 'escape': setSelection([]); break;
    }
  });
}
function jumpEdit(dir) {
  if (S.play) stop();
  const pts = [...new Set([0, ...P().clips.flatMap((c) => [c.start, end(c)])])].sort((a, b) => a - b);
  const t = dir > 0 ? pts.find((p) => p > S.playhead + EPS) : [...pts].reverse().find((p) => p < S.playhead - EPS);
  if (t != null) { setPlayhead(t); ensurePlayheadVisible(); }
}
function toggleSnap() { S.snap = !S.snap; $('snapBtn').checked = S.snap; S.uiDirty = true; }

// ------------------------------------------------------------------ projects
async function openProject(slug) {
  if (S.rec) await stopRecording();
  if (S.slug) { try { await flushSave(); } catch {} }
  if (S.play) stop();
  const data = await api('GET', `/api/projects/${enc(slug)}`);
  for (const a of Object.values(S.assets)) for (const v of Object.values(a.videos)) { v.removeAttribute('src'); v.load(); v.remove(); }
  frameLRU.clear(); binEls.forEach((el) => el.remove()); binEls.clear();
  const p = data.project;
  p.tracks = p.tracks || []; p.clips = p.clips || []; p.bin = p.bin || { marks: {}, hidden: [] };
  p.bin.marks = p.bin.marks || {}; p.bin.hidden = p.bin.hidden || [];
  p.settings = p.settings || { width: 1920, height: 1080, fps: 30, auto: true };
  Object.assign(S, {
    slug, project: p, dir: data.dir, rev: p.rev || 0, changeSeq: 0, savedSeq: 0, uiDirty: false,
    media: {}, assets: {}, undo: [], redo: [], selection: new Set(),
    playhead: p.ui?.playhead || 0, zoom: p.ui?.zoom || 60, scroll: p.ui?.scroll || 0, vscroll: 0,
    snap: p.ui?.snap ?? true, linked: p.ui?.linked ?? true,
    source: { mediaId: null, clipId: null, t: 0 },
  });
  $('snapBtn').checked = S.snap; $('linkBtn').checked = S.linked;
  $('projectName').textContent = p.name; document.title = `${p.name} — Cutroom`;
  history.replaceState(null, '', `?p=${enc(slug)}`);
  setSaveState('saved', `Opened from disk`);
  $('sourceTitle').textContent = 'No clip'; $('sourceDur').textContent = ''; $('sourceInOut').innerHTML = '';
  applyMediaList(data.media);
  for (const c of p.clips) S.assets[c.mediaId] && S.assets[c.mediaId].loadAudio();
  zoomAt(S.zoom, 0); S.scroll = p.ui?.scroll || 0;
  afterStructureChange(); refreshMedia();
}

async function showProjects(required) {
  const dlg = $('projectDialog');
  $('projectsDir').textContent = S.info.projectsDir;
  const list = await api('GET', '/api/projects');
  const el = $('projectList'); el.innerHTML = '';
  if (!list.length) el.innerHTML = '<p class="text-body-small muted">No projects yet — name your first one below.</p>';
  for (const p of list) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'list-item text-ui-medium' + (p.slug === S.slug ? ' current' : '');
    b.innerHTML = `<span class="grow">${escapeHtml(p.name)}</span><span class="sub text-ui-small">${p.clips} clips · ${new Date(p.updatedAt).toLocaleString()}</span>`;
    b.onclick = async () => { dlg.close(); await openProject(p.slug); };
    el.append(b);
  }
  dlg.oncancel = (e) => { if (required && !S.slug) e.preventDefault(); };
  $('createProjectBtn').onclick = async (e) => {
    e.preventDefault();
    const name = $('newProjectName').value.trim() || 'Untitled project';
    const { slug } = await api('POST', '/api/projects', { name });
    $('newProjectName').value = ''; dlg.close(); await openProject(slug);
  };
  dlg.showModal();
}

// ------------------------------------------------------------------ dialogs
let exportPoll = 0;
async function showExport() {
  try { await flushSave(); } catch { toast('Saving failed — fix that before exporting', true); return; }
  const dlg = $('exportDialog'); const sel = $('exPreset');
  // #exPreset/#exRes/#exFps mirror the dialog's Dropdowns (components/Dialogs.jsx),
  // which fire 'change' on them when the choice changes.
  if (!$('exName').value) $('exName').value = P().name;
  const s = P().settings; const summary = () => {
    const pr = S.info.presets[sel.value];
    $('exSummary').textContent = `${fmtTC(seqEnd())} long · sequence ${s.width}×${s.height} @ ${+s.fps.toFixed(3)} fps · saves a new file in exports/ (never overwrites)${pr.audioOnly ? ' · audio only' : ''}`;
  };
  sel.onchange = summary; summary();
  await refreshExports();
  dlg.showModal();
}
async function refreshExports() {
  const { files, running } = await api('GET', `/api/projects/${enc(S.slug)}/exports`);
  const el = $('exportList'); el.innerHTML = files.length ? '' : '<p class="text-body-small muted">None yet.</p>';
  for (const f of files) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'list-item text-ui-small';
    b.innerHTML = `<span class="grow">${escapeHtml(f.file)}</span><span class="sub">${fmtSize(f.size)} · ${new Date(f.mtime).toLocaleString()}</span><span>Show</span>`;
    b.onclick = () => api('POST', `/api/projects/${enc(S.slug)}/reveal`, { file: 'exports/' + f.file });
    el.append(b);
  }
  if (running[0] && !exportPoll) trackJob(running[0].id);
}
function trackJob(id) {
  $('exProgressWrap').hidden = false; $('exCancel').hidden = false; $('exStart').disabled = true;
  $('exCancel').onclick = () => api('POST', `/api/jobs/${id}/cancel`);
  const tick = async () => {
    let j; try { j = await api('GET', `/api/jobs/${id}`); } catch { exportPoll = 0; return; }
    $('exBar').style.width = (j.progress * 100).toFixed(1) + '%';
    if (j.status === 'running') {
      const el = (Date.now() - j.startedAt) / 1000; const eta = j.progress > 0.02 ? el / j.progress - el : null;
      $('exStatus').textContent = `Exporting ${j.file} — ${(j.progress * 100).toFixed(0)}%${eta != null ? ` · about ${fmtDur(eta)} left` : ''}`;
      exportPoll = setTimeout(tick, 400); return;
    }
    exportPoll = 0; $('exCancel').hidden = true; $('exStart').disabled = false;
    if (j.status === 'done') { $('exStatus').textContent = `Done: exports/${j.file} (${fmtSize(j.size)})`; toast('Export finished'); }
    else if (j.status === 'cancelled') $('exStatus').textContent = 'Export cancelled.';
    else $('exStatus').textContent = 'Export failed: ' + (j.error || 'unknown error');
    refreshExports();
  };
  tick();
}
async function startExport() {
  try { await flushSave(); } catch { return toast('Saving failed — fix that before exporting', true); }
  try {
    $('exStatus').textContent = 'Starting…';
    const j = await api('POST', `/api/projects/${enc(S.slug)}/export`, { preset: $('exPreset').value, resolution: $('exRes').value, fps: $('exFps').value || null, name: $('exName').value.trim() });
    trackJob(j.id);
  } catch (e) { $('exStatus').textContent = e.message; }
}

async function showHistory() {
  const dlg = $('historyDialog'); const el = $('historyList');
  try { await flushSave(); } catch {}
  const files = await api('GET', `/api/projects/${enc(S.slug)}/history`);
  el.innerHTML = files.length ? '' : '<p class="text-body-small muted">No versions yet — they appear as you edit.</p>';
  for (const f of files.slice(0, 300)) {
    const m = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z(?:-(.+))?\.json$/.exec(f);
    const when = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`).toLocaleString() : f;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'list-item text-ui-small';
    b.innerHTML = `<span class="grow">${when}</span><span class="sub">${m && m[6] ? escapeHtml(m[6]) : 'autosave'}</span><span>Restore</span>`;
    b.onclick = async () => {
      const snap = await api('GET', `/api/projects/${enc(S.slug)}/history/${enc(f)}`);
      await api('POST', `/api/projects/${enc(S.slug)}/snapshot/before-restore`);
      mutate('Restore version', () => {
        P().tracks = snap.tracks; P().clips = snap.clips; P().settings = snap.settings;
        P().bin = snap.bin || { marks: {}, hidden: [] };
      });
      renderBin(); dlg.close(); toast(`Restored version from ${when} (⌘Z to undo)`);
    };
    el.append(b);
  }
  dlg.showModal();
}

function showSettings() {
  const s = P().settings; $('setW').value = s.width; $('setH').value = s.height; $('setFps').value = s.fps;
  $('setSave').onclick = (e) => {
    const w = Math.round(Number($('setW').value) / 2) * 2, h = Math.round(Number($('setH').value) / 2) * 2, f = Number($('setFps').value);
    if (!(w >= 16 && h >= 16 && f > 0 && f <= 240)) { e.preventDefault(); return toast('Enter a valid size and frame rate', true); }
    mutate('Sequence settings', () => { P().settings = { width: w, height: h, fps: f, auto: false }; });
  };
  $('settingsDialog').showModal();
}

// ------------------------------------------------------------------ boot
function wireChrome() {
  $('importBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
  $('showHiddenBtn').onclick = () => { mutate('Show removed media', () => { P().bin.hidden = []; }); renderBin(); };
  $('projectBtn').onclick = () => showProjects(false);
  $('exportBtn').onclick = showExport;
  $('exStart').onclick = startExport;
  $('historyBtn').onclick = showHistory;
  $('settingsBtn').onclick = showSettings;
  $('revealBtn').onclick = () => api('POST', `/api/projects/${enc(S.slug)}/reveal`, {});
  $('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
  $('splitBtn').onclick = () => splitAt(S.playhead);
  $('deleteBtn').onclick = () => deleteSelected(false);
  $('snapBtn').onchange = toggleSnap;
  $('linkBtn').onchange = () => { S.linked = $('linkBtn').checked; S.uiDirty = true; };
  $('fitBtn').onclick = zoomFit;
  $('zoomSlider').oninput = (e) => zoomAroundPlayhead(ZMIN * Math.pow(ZMAX / ZMIN, e.target.value / 1000));
  $('addVBtn').onclick = () => mutate('Add video track', () => {
    const n = P().tracks.filter((t) => t.kind === 'video').length + 1; P().tracks.unshift({ id: 'V' + uid(), kind: 'video', name: 'V' + n, hidden: false });
  });
  $('addABtn').onclick = () => mutate('Add audio track', () => {
    const n = P().tracks.filter((t) => t.kind === 'audio').length + 1; P().tracks.push({ id: 'A' + uid(), kind: 'audio', name: 'A' + n, muted: false });
  });

  // Files dragged in from Finder.
  let depth = 0; const ov = $('dropOverlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.classList.add('on'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; ov.classList.remove('on'); } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); depth = 0; ov.classList.remove('on');
    if (S.slug) importFiles([...e.dataTransfer.files]);
  });

  new ResizeObserver(() => { if (P()) renderTrackHeads(); requestRender(); }).observe(document.body);
}

async function boot() {
  const pool = document.createElement('div'); pool.id = 'videoPool';
  pool.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;';
  document.body.append(pool);
  readTheme(); wireChrome(); wireTimeline(); wireSource(); wireKeys(); focusPanel('program');
  S.info = await api('GET', '/api/info');
  const want = new URLSearchParams(location.search).get('p');
  const list = await api('GET', '/api/projects');
  const target = list.find((p) => p.slug === want) || list[0];
  if (target) await openProject(target.slug); else await showProjects(true);
  requestAnimationFrame(frame);
}
// Called once from the Editor component after it mounts (guarded against React
// StrictMode's double effect run in development).
let started = false;
// In development, editing this file makes Next.js load a fresh copy of it while
// the old copy keeps driving the page; two engines would fight over the canvas
// and both save. Every edit is already on disk, so reload instead of starting twice.
export function startEditor() {
  if (started) return;
  if (window.__cutroomEngineStarted) { window.location.reload(); return; }
  started = true;
  window.__cutroomEngineStarted = true;
  boot().catch((e) => { console.error(e); toast('Could not reach the Cutroom server: ' + e.message, true); });
}
