// Cutroom client engine. Imported only in the browser (see app/Editor.jsx). State lives on the server's disk; this file only renders it and
// sends every change back (autosave). Scrubbing never uses a <video> player UI:
// frames come from a per-clip JPEG frame cache drawn to canvas, refined by
// exact seeks on a short-GOP proxy, with audio "grains" while you drag.

import { getInputStream } from './inputs';
import { clipFrame, clipZoom, clipText, clipGeometry, drawText, textBounds, hasZoom, ROUNDED, TEXT_DEFAULT } from './geometry.mjs';

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
    radius: px('--radius-sm') || 6, pad: px('--spacing-md') || 12, line: px('--border-md') || 2, lineThin: px('--border-md-sm') || 1.25, lineThick: px('--border-lg') || 3,
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
  pushMode: 'off', // 'off' (overwrite) | 'track' | 'all': see setPushMode
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
  if (!actx) { actx = new AudioContext({ latencyHint: 'playback' }); master = actx.createGain(); master.connect(actx.destination); }
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
        .then((buf) => { this.audioBuf = buf; onAudioLoaded(this); })
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
function frameSource(a, mt, role, playing) {
  if (!a || !a.hasFrames) return null;
  const v = a.videos[role];
  if (playing) {
    if (v && v.readyState >= 2 && !v.paused && Math.abs(v.currentTime - mt) < 0.2) return { src: v, w: v.videoWidth, h: v.videoHeight };
  }
  const img = a.frameAt(mt);
  const imgDist = img ? Math.abs(img._t - mt) : Infinity;
  const vidDist = !playing && v && v.readyState >= 2 && v._shownTime != null ? Math.abs(v._shownTime - mt) : Infinity;
  if (!playing) seekVideo(a.video(role), mt);
  if (vidDist < Infinity && vidDist <= Math.max(imgDist, 1 / a.meta.scrubFps)) return { src: v, w: v.videoWidth, h: v.videoHeight };
  if (img) return { src: img, w: img.naturalWidth, h: img.naturalHeight };
  return null;
}
function drawAssetFrame(ctx, a, mt, x, y, w, h, role, playing) {
  const f = frameSource(a, mt, role, playing); if (!f) return false;
  drawContain(ctx, f.src, f.w, f.h, x, y, w, h); return true;
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

// ------------------------------------------------------------------ layers
// Every visible video track is a layer; the top track is the top layer. A clip
// that fills the frame (or a text card with a full background) hides the
// layers under it, so they're skipped. Placement maths is in geometry.mjs,
// shared with the export.
const isText = (c) => c.kind === 'text';
const progress = (c, t) => clamp((t - c.start) / Math.max(len(c), EPS), 0, 1);
function layersAt(t) {
  const out = [];
  for (const tr of P().tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    const c = P().clips.find((c) => c.trackId === tr.id && c.start <= t + EPS && end(c) > t + EPS);
    if (!c) continue;
    if (isText(c)) { out.push(c); if (clipText(c).bgMode === 'full') break; continue; }
    const m = S.media[c.mediaId]; if (!m || !m.hasVideo) continue;
    out.push(c); if (layerBox(c, t).full) break;
  }
  return out.reverse(); // bottom first
}
const videoRole = (c) => 'pv' + c.trackId; // each track plays through its own <video>
let measureCtx = null;
// Where a layer sits, in sequence pixels (for drawing outlines and for picking it in the viewer).
function layerBox(c, t = S.playhead) {
  const { width: W, height: H } = P().settings;
  if (isText(c)) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    return { ...textBounds(measureCtx, c, W, H), full: clipText(c).bgMode === 'full' };
  }
  const m = S.media[c.mediaId]; if (!m || !m.width) return { x: 0, y: 0, w: W, h: H, full: true };
  const g = clipGeometry(c, m.width, m.height, W, H, progress(c, t));
  return { ...g.box, full: g.full, g };
}
function shapePath(ctx, shape, x, y, w, h) {
  ctx.beginPath();
  if (shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'rounded') ctx.roundRect(x, y, w, h, Math.min(w, h) * ROUNDED);
  else ctx.rect(x, y, w, h);
}
const fontsAsked = new Set();
function ensureFont(t) {
  const spec = `${t.weight} 32px "${t.font}"`;
  if (fontsAsked.has(spec) || document.fonts.check(spec)) return;
  fontsAsked.add(spec); document.fonts.load(spec).then(() => requestRender('program')).catch(() => {});
}
// Draw one layer into the viewer, where the sequence frame is at (rx, ry) scaled by k.
function drawLayer(ctx, c, t, rx, ry, k, playing) {
  const { width: W, height: H } = P().settings;
  if (isText(c)) {
    ensureFont(clipText(c));
    ctx.save(); ctx.translate(rx, ry); ctx.scale(k, k); drawText(ctx, c, W, H); ctx.restore();
    return;
  }
  const a = S.assets[c.mediaId]; const b = layerBox(c, t); const g = b.g;
  const f = frameSource(a, c.in + t - c.start, videoRole(c), playing); if (!f || !g) return;
  ctx.save();
  shapePath(ctx, g.shape, rx + b.x * k, ry + b.y * k, b.w * k, b.h * k); ctx.clip();
  ctx.drawImage(f.src, g.src.x * f.w, g.src.y * f.h, g.src.w * f.w, g.src.h * f.h, rx + b.x * k, ry + b.y * k, b.w * k, b.h * k);
  ctx.restore();
}

function renderProgram() {
  const cv = $('programCanvas'); const { w, h, d } = fitCanvas(cv); const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.lane; ctx.fillRect(0, 0, w, h);
  const { width: sw, height: sh } = P().settings;
  const s = Math.min(w / sw, h / sh); const rw = sw * s, rh = sh * s, rx = (w - rw) / 2, ry = (h - rh) / 2;
  S.view = { rx, ry, k: s };
  ctx.fillStyle = C.black; ctx.fillRect(rx, ry, rw, rh);
  const t = S.playhead;
  const playing = S.play && S.play.target === 'program' && S.play.rate > 0;
  const layers = layersAt(t);
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
  for (const c of layers) drawLayer(ctx, c, t, rx, ry, s, playing);
  ctx.restore();
  // The clip being inspected: its outline (when it doesn't fill the frame) and its zoom focus.
  const sel = !playing && inspectedClip();
  if (sel && layers.includes(sel)) {
    const b = layerBox(sel, t);
    ctx.strokeStyle = C.select; ctx.lineWidth = C.line;
    if (!b.full) { shapePath(ctx, isText(sel) ? 'rect' : clipFrame(sel).shape, rx + b.x * s, ry + b.y * s, b.w * s, b.h * s); ctx.stroke(); }
    if (!isText(sel) && hasZoom(clipZoom(sel))) {
      const z = clipZoom(sel); const g = b.g;
      const fx = rx + (b.x + ((z.x - g.src.x) / g.src.w) * b.w) * s, fy = ry + (b.y + ((z.y - g.src.y) / g.src.h) * b.h) * s;
      ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.moveTo(fx - 10, fy); ctx.lineTo(fx + 10, fy); ctx.moveTo(fx, fy - 10); ctx.lineTo(fx, fy + 10); ctx.stroke();
    }
  }
  // While recording the camera, show it picture-in-picture in the bottom right.
  const live = S.rec && S.rec.preview;
  if (live && live.readyState >= 2 && live.videoWidth) {
    const pw = rw * 0.3, ph = (pw * live.videoHeight) / live.videoWidth;
    const px = rx + rw - pw - C.pad, py = ry + rh - ph - C.pad;
    if (S.rec.mirror) { ctx.save(); ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(live, 0, 0, pw, ph); ctx.restore(); }
    else ctx.drawImage(live, px, py, pw, ph);
    ctx.strokeStyle = C.playhead; ctx.lineWidth = C.line; ctx.strokeRect(px, py, pw, ph);
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

  updateScrollbar(w);

  // Markers (script beats from a cut list): a flag and a label on the ruler.
  for (const k of P().markers || []) {
    const mx = Math.round(xOf(k.time)) + 0.5; if (mx < -200 || mx > w) continue;
    ctx.fillStyle = C.mark; ctx.globalAlpha = 0.5; ctx.fillRect(mx - 0.5, RULER_H, 1, h); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(mx, RULER_H); ctx.lineTo(mx + 7, RULER_H - 5); ctx.lineTo(mx, RULER_H - 10); ctx.fill();
    if (k.label) {
      ctx.font = `${C.uiSize}px ${C.sans}`; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(k.label).width;
      ctx.fillStyle = C.ruler; ctx.fillRect(mx + 8, RULER_H - 13, tw + 6, 13);
      ctx.fillStyle = C.mark; ctx.fillText(k.label, mx + 11, RULER_H - 6);
    }
  }

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
  ctx.fillStyle = isText(c) ? C.video : !m || m.status !== 'ready' ? C.missing : isVideo ? C.video : C.audio;
  ctx.fillRect(vx0, y, vx1 - vx0, h);
  if (isText(c)) {
    // A text card: a swatch of its colours under the label.
    const t = clipText(c);
    ctx.fillStyle = t.bgMode === 'none' ? C.lane : t.bg; ctx.fillRect(vx0, y + LABEL_H, vx1 - vx0, h - LABEL_H);
    ctx.fillStyle = t.color; ctx.font = `${t.weight} ${Math.min(h - LABEL_H - 6, 18)}px "${t.font}"`; ctx.textBaseline = 'middle';
    ctx.fillText(t.content.split('\n')[0], Math.max(x0, 0) + 6, y + LABEL_H + (h - LABEL_H) / 2);
  } else if (a && a.ready) {
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
  const fx = (!isText(c) && (c.frame || c.zoom)) ? '  · reframed' : '';
  ctx.fillText((isText(c) ? 'Text' : ((m && m.name) || 'Missing media')) + vol + fx, Math.max(x0, 0) + 6, y + LABEL_H / 2);
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
      ${dsIconButton(recHere ? 'primary' : 'subtle', recHere ? 'stop' : isV ? 'videocam' : 'mic', 'rec', recHere ? 'Stop recording' : isV ? 'Record the camera onto this track from the playhead' : 'Record the microphone onto this track from the playhead')}`;
    d.querySelector('.rec').onclick = () => {
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
function editState() { return JSON.stringify({ tracks: P().tracks, clips: P().clips, settings: P().settings, bin: P().bin, markers: P().markers }); }
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
  renderTrackHeads(); updateClipVolumeUI(); updateUndoButtons(); requestRender(); syncAudioBuffers();
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
      lo = Math.max(lo, -o.start, isText(o) ? -Infinity : -o.in); hi = Math.min(hi, o.out - o.in - md);
      for (const c of others) if (end(c) <= o.start + EPS) lo = Math.max(lo, end(c) - o.start);
    } else {
      if (!isText(o)) hi = Math.min(hi, mediaDur(o.mediaId) - o.out);
      lo = Math.max(lo, o.in + md - o.out);
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

// Delete; in a push mode (or with Shift) the gap closes up. 'all' closes it on
// every track, as far as each track has room.
function deleteSelected(ripple) {
  if (!S.selection.size) return;
  const mode = S.pushMode !== 'off' ? S.pushMode : ripple ? 'track' : 'off';
  mutate(mode === 'off' ? 'Delete' : 'Ripple delete', () => {
    const gone = P().clips.filter((c) => S.selection.has(c.id));
    P().clips = P().clips.filter((c) => !S.selection.has(c.id));
    if (mode === 'all') closeGapsAllTracks(gone.map((c) => [c.start, end(c)]));
    else if (mode === 'track') {
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

// ------------------------------------------------------------------ clip inspector
// The Clip inspector (components/Inspector.jsx) is React. It hears about the
// selected video-track clip through 'cutroom:clip' and asks for changes with
// 'cutroom:clip-edit' { id, patch: { frame?, zoom?, text? }, label }. A patch
// value of null removes that setting.
function inspectedClip() {
  if (!P()) return null;
  const vids = P().clips.filter((c) => S.selection.has(c.id) && trackById(c.trackId)?.kind === 'video');
  return vids.find((c) => c.id === S.lastClicked) || vids[0] || null;
}
let lastEmitted = '';
function emitClip() {
  const c = inspectedClip(); const m = c && !isText(c) ? S.media[c.mediaId] : null;
  const detail = {
    slug: S.slug, seq: P() ? { width: P().settings.width, height: P().settings.height } : null,
    clip: c ? clone(c) : null, track: c ? trackById(c.trackId).name : null,
    media: m ? { name: m.name, width: m.width, height: m.height } : null,
  };
  const sig = JSON.stringify(detail); if (sig === lastEmitted) return;
  lastEmitted = sig; window.__cutroomClip = detail;
  window.dispatchEvent(new CustomEvent('cutroom:clip', { detail }));
}
// Consecutive edits of the same setting on the same clip (a slider being
// dragged, a word being typed) make a single undo step.
function editClip({ id, patch, label = 'Edit clip' }) {
  const c = clipById(id); if (!c) return;
  const key = id + '|' + label; const now = performance.now();
  const merge = S.lastEdit && S.lastEdit.key === key && now - S.lastEdit.at < 1500 && S.undo[S.undo.length - 1] === S.lastEdit.entry;
  const before = merge ? null : editState();
  for (const k of ['frame', 'zoom', 'text']) {
    if (patch[k] === null) delete c[k];
    else if (patch[k]) c[k] = { ...(c[k] || {}), ...patch[k] };
  }
  if (before) {
    if (before === editState()) return;
    S.undo.push({ label, state: before }); if (S.undo.length > 500) S.undo.shift();
  }
  S.lastEdit = { key, at: now, entry: S.undo[S.undo.length - 1] };
  S.redo = []; updateUndoButtons(); markDirty(); requestRender();
  emitClip(); // now, so the inspector's controls never show a stale value mid-drag
  if (isText(c)) queueCard(c.id);
}

// A text card goes at the playhead on the highest video track with room for
// it (a new top track if none has), so it sits over the picture.
function addTextCard() {
  const dur = 4; const s = qt(S.playhead), e = s + dur; let id;
  mutate('Add text card', () => {
    const vts = P().tracks.filter((t) => t.kind === 'video');
    let tr = vts.find((t) => !P().clips.some((c) => c.trackId === t.id && c.start < e - EPS && end(c) > s + EPS));
    if (!tr) { tr = { id: 'V' + uid(), kind: 'video', name: 'V' + (vts.length + 1), hidden: false }; P().tracks.unshift(tr); }
    const c = { id: uid(), kind: 'text', trackId: tr.id, start: s, in: 0, out: dur, text: { ...TEXT_DEFAULT } };
    P().clips.push(c); id = c.id;
    S.selection = new Set([c.id]); S.lastClicked = c.id;
  });
  queueCard(id);
  window.dispatchEvent(new Event('cutroom:show-inspector'));
}

// The export uses each card as a PNG drawn here, so it matches the preview
// exactly (same fonts, same layout). Saved to cache/cards/<clip id>.png.
const cardTimers = new Map();
function queueCard(id) {
  clearTimeout(cardTimers.get(id));
  cardTimers.set(id, setTimeout(() => { cardTimers.delete(id); const c = clipById(id); if (c) uploadCard(c).catch((e) => console.warn('card', e)); }, 1000));
}
async function uploadCard(c) {
  const { width: W, height: H } = P().settings; const t = clipText(c);
  await document.fonts.load(`${t.weight} 32px "${t.font}"`).catch(() => {});
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  drawText(cv.getContext('2d'), c, W, H);
  await api('PUT', `/api/projects/${enc(S.slug)}/cards/${enc(c.id)}`, { png: cv.toDataURL('image/png') });
}

// ------------------------------------------------------------------ timelines
// A project holds several timelines. The active one is the top-level tracks/clips/
// settings/markers (what saving, playback and export use); the rest are kept in
// P().timelines with their own view position. Each keeps its own undo history
// for the session. Switching, adding and renaming are saved but not undoable;
// every version is still in Versions.

function stashActive() {
  const p = P();
  return { id: p.timeline.id, name: p.timeline.name, tracks: p.tracks, clips: p.clips, settings: p.settings, markers: p.markers,
    ui: { playhead: S.playhead, zoom: S.zoom, scroll: S.scroll } };
}
function loadTimeline(t) {
  const p = P();
  p.timeline = { id: t.id, name: t.name };
  p.tracks = t.tracks; p.clips = t.clips; p.settings = t.settings; p.markers = t.markers || [];
  S.playhead = t.ui?.playhead || 0; S.scroll = t.ui?.scroll || 0; zoomAt(t.ui?.zoom || S.zoom, 0); S.scroll = t.ui?.scroll || 0;
  const u = S.undoByTimeline[t.id] || { undo: [], redo: [] }; S.undo = u.undo; S.redo = u.redo;
  S.selection = new Set(); S.source.clipId = null;
}
function switchTimeline(id) {
  const p = P(); if (id === p.timeline.id) return;
  const target = p.timelines.find((t) => t.id === id); if (!target) return;
  if (S.rec) return toast('Stop recording before switching timelines', true);
  if (S.play) stop();
  S.undoByTimeline[p.timeline.id] = { undo: S.undo, redo: S.redo };
  p.timelines = p.timelines.filter((t) => t.id !== id).concat(stashActive());
  loadTimeline(target);
  afterStructureChange(); markDirty(); emitTimelines(); updateClipVolumeUI();
  toast(`Timeline: ${target.name}`);
}
function freshTracks() {
  return [
    { id: 'V2', kind: 'video', name: 'V2', hidden: false }, { id: 'V1', kind: 'video', name: 'V1', hidden: false },
    { id: 'A1', kind: 'audio', name: 'A1', muted: false }, { id: 'A2', kind: 'audio', name: 'A2', muted: false },
  ];
}
function uniqueTimelineName(base) {
  const names = new Set([P().timeline.name, ...P().timelines.map((t) => t.name)]);
  let n = base, i = 2; while (names.has(n)) n = `${base} ${i++}`;
  return n;
}
function addTimeline(t) {
  t.id = 'tl' + uid(); t.name = uniqueTimelineName(t.name || 'Timeline');
  P().timelines.push(t); switchTimeline(t.id);
}
function newTimeline() { addTimeline({ name: 'Timeline', tracks: freshTracks(), clips: [], settings: { ...P().settings }, markers: [] }); }
function duplicateTimeline() {
  const a = clone(stashActive());
  addTimeline({ ...a, name: `${a.name} copy` });
}
function renameTimeline(id, name) {
  name = String(name || '').trim(); if (!name) return;
  const p = P(); const t = id === p.timeline.id ? p.timeline : p.timelines.find((x) => x.id === id); if (!t) return;
  t.name = name; markDirty(); emitTimelines();
}
// The Timelines dialog and the toolbar switcher are React; they hear about
// timelines through this event and ask for changes with 'cutroom:timeline'.
function emitTimelines() {
  const p = P(); if (!p) return;
  const list = [{ id: p.timeline.id, name: p.timeline.name }, ...p.timelines.map((t) => ({ id: t.id, name: t.name }))]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  window.__cutroomTimelines = { slug: S.slug, active: p.timeline.id, list };
  window.dispatchEvent(new CustomEvent('cutroom:timelines', { detail: window.__cutroomTimelines }));
}

// Build a new timeline from a cut list (projects/<p>/cutlists/<file>.json):
// { name, settings?: {width,height,fps}, markers?: [{time,label}],
//   clips: [{ media, start, in, out, video?: 'V1', audio?: 'A1', track?: 'V1', volume?, note? }] }
// `media` is a media id or a file name as shown in the bin. A clip with both
// `video` and `audio` is placed as a linked pair. Later clips overwrite earlier ones.
async function importCutList(file) {
  let cl;
  try { cl = await api('GET', `/api/projects/${enc(S.slug)}/cutlists/${enc(file)}`); } catch (e) { return toast('Could not read the cut list: ' + e.message, true); }
  if (!cl || !Array.isArray(cl.clips)) return toast('That cut list has no clips array', true);
  const byName = {}; for (const m of Object.values(S.media)) { byName[m.name] = m; byName[m.name.toLowerCase()] = m; }
  const find = (ref) => S.media[ref] || byName[ref] || byName[String(ref).toLowerCase()];
  const tracks = freshTracks(); const clips = []; const problems = [];
  const ensureTrack = (name) => {
    let t = tracks.find((x) => x.name === name); if (t) return t.id;
    const kind = /^V/i.test(name) ? 'video' : 'audio';
    t = { id: (kind === 'video' ? 'V' : 'A') + uid(), kind, name, ...(kind === 'video' ? { hidden: false } : { muted: false }) };
    if (kind === 'video') tracks.unshift(t); else tracks.push(t);
    return t.id;
  };
  const sortTracks = () => {
    const num = (t) => parseInt(t.name.slice(1), 10) || 0;
    const vs = tracks.filter((t) => t.kind === 'video').sort((a, b) => num(b) - num(a));
    const as = tracks.filter((t) => t.kind === 'audio').sort((a, b) => num(a) - num(b));
    tracks.splice(0, tracks.length, ...vs, ...as);
  };
  const place = (trackId, c) => {
    // overwrite anything already placed under this clip on this track
    const s = c.start, e = c.start + (c.out - c.in);
    for (const o of [...clips]) {
      if (o.trackId !== trackId) continue;
      const os = o.start, oe = o.start + (o.out - o.in);
      if (oe <= s + EPS || os >= e - EPS) continue;
      if (os >= s - EPS && oe <= e + EPS) clips.splice(clips.indexOf(o), 1);
      else if (os < s && oe > e) { clips.push({ ...o, id: uid(), linkId: null, start: e, in: o.in + (e - os) }); o.out = o.in + (s - os); }
      else if (os < s) o.out = o.in + (s - os);
      else { o.in += e - os; o.start = e; }
    }
    clips.push({ ...c, trackId });
  };
  cl.clips.forEach((x, i) => {
    const m = find(x.media);
    if (!m) { problems.push(`clip ${i + 1}: no media "${x.media}"`); return; }
    const D = m.duration || 0;
    const inn = clamp(Number(x.in) || 0, 0, D), out = clamp(x.out == null ? D : Number(x.out), 0, D);
    if (!(out - inn > 1e-3)) { problems.push(`clip ${i + 1}: empty range`); return; }
    const start = Math.max(0, Number(x.start) || 0);
    const v = x.video || (x.track && /^V/i.test(x.track) ? x.track : null);
    const a = x.audio || (x.track && /^A/i.test(x.track) ? x.track : null);
    const linkId = v && a ? uid() : null;
    const base = { mediaId: m.id, start, in: inn, out, linkId, volume: x.volume ?? 1, ...(x.note ? { note: String(x.note) } : {}) };
    if (v && m.hasVideo) place(ensureTrack(v), { ...base, id: uid() });
    if (a && m.hasAudio) place(ensureTrack(a), { ...base, id: uid() });
    if (!v && !a) problems.push(`clip ${i + 1}: no track given`);
  });
  sortTracks();
  const settings = { ...P().settings, ...(cl.settings || {}), auto: false };
  const markers = (cl.markers || []).filter((k) => k && isFinite(k.time)).map((k) => ({ time: Math.max(0, Number(k.time)), label: String(k.label || '') }));
  addTimeline({ name: cl.name || file.replace(/\.json$/, ''), tracks, clips, settings, markers, ui: { playhead: 0, zoom: S.zoom, scroll: 0 } });
  zoomFit();
  toast(problems.length ? `Imported with ${problems.length} problem(s): ${problems.slice(0, 3).join('; ')}` : `Imported "${cl.name || file}" (${clips.length} clips)`, problems.length > 0);
}

window.addEventListener('cutroom:timeline', (e) => {
  const d = e.detail || {}; if (!P()) return;
  if (d.action === 'switch') switchTimeline(d.id);
  else if (d.action === 'new') newTimeline();
  else if (d.action === 'duplicate') duplicateTimeline();
  else if (d.action === 'rename') renameTimeline(d.id, d.name);
  else if (d.action === 'import') importCutList(d.file);
});

// ------------------------------------------------------------------ push modes
// 'off': moving a clip overwrites what's under it. 'track': the clip and every
// clip after it on its track (and its linked clips' tracks) move together.
// 'all': every clip after it, on every track, moves with it.
const PUSH_BUTTONS = { off: 'pushOffBtn', track: 'pushTrackBtn', all: 'pushAllBtn' };
function setPushMode(mode, { restoring = false } = {}) {
  S.pushMode = PUSH_BUTTONS[mode] ? mode : 'off'; if (!restoring) S.uiDirty = true;
  for (const [m, id] of Object.entries(PUSH_BUTTONS)) {
    const b = $(id); if (!b) continue;
    b.classList.toggle('btn-primary', m === S.pushMode); b.classList.toggle('btn-subtle', m !== S.pushMode);
    b.setAttribute('aria-pressed', String(m === S.pushMode));
  }
}

// The clips that move with a dragged selection in a push mode, and how far left
// the block may go before it would cover an earlier clip.
function pushBlock(orig) {
  if (S.pushMode === 'off') return { pushing: false, followers: [], lo: 0 };
  const ids = new Set(orig.map((o) => o.id));
  const from = Math.min(...orig.map((o) => o.start));
  const tracks = S.pushMode === 'all' ? new Set(P().tracks.map((t) => t.id)) : new Set(orig.map((o) => o.trackId));
  const followers = P().clips.filter((c) => !ids.has(c.id) && tracks.has(c.trackId) && c.start >= from - EPS).map((c) => ({ ...c }));
  const block = [...orig, ...followers]; const inBlock = new Set(block.map((o) => o.id));
  let lo = -Math.min(...block.map((o) => o.start));
  for (const b of block) {
    for (const c of P().clips) {
      if (inBlock.has(c.id) || c.trackId !== b.trackId || end(c) > b.start + EPS) continue;
      lo = Math.max(lo, end(c) - b.start);
    }
  }
  return { pushing: true, followers, lo: Math.min(0, lo) };
}

// Close the gaps left by deleted ranges on every track. Each track moves its
// later clips left by the gap, or as far as it can without covering a clip.
function closeGapsAllTracks(ranges) {
  const gaps = ranges.sort((a, b) => b[0] - a[0]); // latest first, so earlier gaps don't move later ones twice
  for (const [gs, ge] of gaps) {
    const len = ge - gs;
    for (const t of P().tracks) {
      const after = P().clips.filter((c) => c.trackId === t.id && c.start >= ge - EPS);
      if (!after.length) continue;
      const first = Math.min(...after.map((c) => c.start));
      const before = P().clips.filter((c) => c.trackId === t.id && c.start < ge - EPS);
      const room = first - Math.max(0, ...before.map((c) => Math.min(end(c), first)));
      const shift = Math.min(len, room);
      for (const c of after) c.start -= shift;
    }
  }
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
  return { ...P(), rev, ui: { playhead: S.playhead, zoom: S.zoom, scroll: S.scroll, snap: S.snap, linked: S.linked, push: S.pushMode } };
}
async function save({ snapshot } = {}) {
  if (!P()) return;
  if (S.conflict) return; // another window saved this project; never overwrite it (the banner offers Reload)
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
    setSaveState('error', e.status === 409 ? 'Not saved: changed in another window' : 'Not saved — retrying');
    if (e.status !== 409) { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 2000); }
    else { S.conflict = true; emitPresence(); }
  } finally {
    S.saving = false;
    if (S.saveAgain) { S.saveAgain = false; save(); }
  }
}
async function flushSave(opts) {
  while (S.saving) await new Promise((r) => setTimeout(r, 50));
  if (S.changeSeq !== S.savedSeq || (opts && opts.snapshot)) await save(opts);
  else if (S.uiDirty) await saveUi();
  if (S.conflict) throw new Error('This project was changed in another window; reload to continue.');
  if (S.saveError && S.changeSeq !== S.savedSeq) throw S.saveError;
}
// View-only changes (playhead, zoom…) save on their own, without a version check.
async function saveUi() {
  if (!P() || S.saving || S.conflict) return;
  S.uiDirty = false;
  try { await api('PUT', `/api/projects/${enc(S.slug)}?ui=1`, { ui: projectBody(S.rev).ui }); } catch { S.uiDirty = true; }
}
setInterval(() => { if (S.uiDirty && !S.saving && S.changeSeq === S.savedSeq) saveUi(); }, 5000);
// ------------------------------------------------------------------ presence
// Each open editor checks in with the server, so every window can warn when the
// same project is also open somewhere else (Edge, Chrome, the Claude app's pane…).
// Two editors on one project overwrite each other's saves; the server refuses the
// older one, and this window then stops saving and offers to reload.
const SESSION = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
const WINDOW_LABEL = (() => {
  const ua = navigator.userAgent;
  if (/Claude|Electron/.test(ua)) return 'the Claude app';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'another browser';
})();
function emitPresence() {
  window.__cutroomPresence = { others: S.others || [], conflict: !!S.conflict, slug: S.slug };
  window.dispatchEvent(new CustomEvent('cutroom:presence', { detail: window.__cutroomPresence }));
}
async function pingPresence(slug = S.slug) {
  if (!slug) return;
  try {
    const r = await api('POST', `/api/projects/${enc(slug)}/presence`, { session: SESSION, label: WINDOW_LABEL });
    if (slug === S.slug) { S.others = r.others; emitPresence(); }
  } catch {}
}
function leavePresence(slug) {
  if (!slug) return;
  navigator.sendBeacon(`/api/projects/${enc(slug)}/presence`, JSON.stringify({ session: SESSION, leave: true }));
}
setInterval(() => pingPresence(), 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pingPresence(); });
window.addEventListener('pagehide', () => leavePresence(S.slug));
window.addEventListener('cutroom:reload-project', () => { S.conflict = true; location.reload(); });

window.addEventListener('beforeunload', (e) => {
  if (!P() || S.conflict) return;
  if (S.rec) { e.preventDefault(); e.returnValue = ''; }
  const headers = { 'Content-Type': 'application/json' };
  if (S.changeSeq !== S.savedSeq) {
    fetch(`/api/projects/${enc(S.slug)}`, { method: 'PUT', keepalive: true, headers, body: JSON.stringify(projectBody(S.rev + 1)) });
    e.preventDefault(); e.returnValue = '';
  } else if (S.uiDirty) {
    fetch(`/api/projects/${enc(S.slug)}?ui=1`, { method: 'PUT', keepalive: true, headers, body: JSON.stringify({ ui: projectBody(S.rev).ui }) });
  }
});

// ------------------------------------------------------------------ playback
function restartPlayback() { const p = S.play; if (!p) return; const t = playTime(p); stop(true); setPos(p.target, t); play(p.target, p.rate); }
// A sound that finishes loading while playing joins in from where playback is now,
// without restarting what's already playing (a restart is an audible hiccup).
function onAudioLoaded(asset) {
  const p = S.play; if (!p || p.rate <= 0) return;
  if (p.target === 'program') {
    const at = actx.currentTime + 0.05;
    scheduleProgramAudio(p, at, playTime(p) + 0.05 * p.rate, asset);
  } else if (S.source.mediaId === asset.meta.id) restartPlayback();
}

function schedBuffer(p, buf, startAt, offset, dur, gain) {
  if (!buf || dur <= 0 || offset >= buf.duration) return;
  const src = actx.createBufferSource(); src.buffer = buf; src.playbackRate.value = p.rate;
  // 10 ms fade in and out so a clip's edges never click
  const g = actx.createGain(); const real = dur / p.rate; const f = Math.min(0.01, real / 4);
  g.gain.setValueAtTime(0, startAt); g.gain.linearRampToValueAtTime(gain, startAt + f);
  g.gain.setValueAtTime(gain, startAt + real - f); g.gain.linearRampToValueAtTime(0, startAt + real);
  src.connect(g).connect(master);
  src.start(startAt, Math.max(0, offset), dur); p.nodes.push(src);
}

// Schedule the program's audible clips from sequence time `t` at audio-clock `at`
// (only `onlyAsset`'s clips when given). Sounds not decoded yet start loading and
// join through onAudioLoaded.
function scheduleProgramAudio(p, at, t, onlyAsset = null) {
  for (const c of P().clips) {
    const tr = trackById(c.trackId); if (!tr || tr.kind !== 'audio' || tr.muted || end(c) <= t) continue;
    const a = S.assets[c.mediaId]; if (!a || (onlyAsset && a !== onlyAsset)) continue;
    if (!a.audioBuf) { a.loadAudio(); continue; }
    const delay = Math.max(0, c.start - t) / p.rate; const into = Math.max(0, t - c.start);
    schedBuffer(p, a.audioBuf, at + delay, c.in + into, len(c) - into, c.volume ?? 1);
  }
}

// Media whose sound is heard on the current timeline (clips on audio tracks).
function heardMediaIds() {
  return new Set(P().clips.filter((c) => trackById(c.trackId)?.kind === 'audio').map((c) => c.mediaId));
}
// Decode only what's heard (plus what the Source viewer plays), and let go of the
// rest: a long screen recording's decoded sound is hundreds of MB.
function syncAudioBuffers() {
  const heard = heardMediaIds(); const src = S.source.mediaId;
  for (const [id, a] of Object.entries(S.assets)) {
    if (heard.has(id)) a.loadAudio();
    else if (id !== src && a.audioBuf && !(S.play && S.play.target === 'source')) { a.audioBuf = null; a.audioP = null; }
  }
}
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
    if (target === 'program') scheduleProgramAudio(p, p.c0, t0);
    else {
      const a = S.assets[S.source.mediaId]; const gain = sourceAudioGain();
      if (gain > 0 && a.audioBuf) schedBuffer(p, a.audioBuf, p.c0, t0, a.meta.duration - t0, gain);
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
  for (const a of Object.values(S.assets)) {
    for (const [role, v] of Object.entries(a.videos)) {
      if (p.target === 'program' ? !role.startsWith('pv') : role !== p.target) continue;
      if (!v.paused) v.pause(); v._clip = null;
    }
  }
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

// Each visible layer plays its proxy on its track's own <video>.
function syncProgramVideo(p, t) {
  const live = new Set();
  if (p.rate > 0 && p.rate <= 4) for (const clip of layersAt(t)) {
    const a = !isText(clip) && S.assets[clip.mediaId]; const v = a && a.video(videoRole(clip)); if (!v) continue;
    live.add(v);
    const want = clip.in + t - clip.start;
    if (v._clip !== clip.id) {
      if (Math.abs(v.currentTime - want) > 0.1) { v._queued = null; v.currentTime = want; }
      v._clip = clip.id;
    } else if (!v.seeking && Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (v.playbackRate !== p.rate) v.playbackRate = p.rate;
    if (v.paused) v.play().catch(() => {});
  }
  for (const o of Object.values(S.assets)) for (const [role, v] of Object.entries(o.videos)) if (role.startsWith('pv') && !live.has(v) && !v.paused) v.pause();
  // Pre-roll the next clips' proxies so the cuts are clean.
  for (const next of layersAt(t + 0.6)) {
    const na = !isText(next) && S.assets[next.mediaId]; const nv = na && na.video(videoRole(next));
    if (nv && !live.has(nv) && nv._clip !== next.id && nv.readyState >= 1) { nv._clip = next.id; nv.currentTime = next.in; }
  }
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
  const withVideo = trackById(trackId)?.kind === 'video';
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("This browser can't record here", true);
  if (S.play) stop(true);
  let stream, inputSettings = {}, fellBack = [];
  try { ({ stream, settings: inputSettings, fellBack } = await getInputStream({ audio: true, video: withVideo })); }
  catch (e) {
    const what = withVideo ? 'Camera or microphone' : 'Microphone';
    return toast(`${what} unavailable (${e.name}). Check the Inputs dialog, and that this app is allowed to use them in System Settings › Privacy & Security.`, true);
  }
  const candidates = withVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  const mirror = withVideo && !!inputSettings.mirrorVideo;
  try { rec = await api('POST', `/api/projects/${enc(S.slug)}/recordings`, { trackId, start: S.playhead, mimeType, mirror }); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); return toast('Could not start recording: ' + e.message, true); }
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...(withVideo ? { videoBitsPerSecond: 8e6 } : {}) });
  const R = S.rec = { id: rec.id, slug: S.slug, trackId, withVideo, mirror, start: S.playhead, recorder, stream, preview: null, sending: Promise.resolve(), lost: 0, startedWall: 0 };
  if (withVideo) {
    // Live camera, drawn as an overlay on the Program viewer while recording.
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
    v.addEventListener('loadeddata', () => requestRender('program')); v.play().catch(() => {});
    R.preview = v;
  }
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) R.sending = R.sending.then(() => sendChunk(R, e.data)); };
  recorder.onstart = () => {
    R.start = S.playhead; R.startedWall = performance.now();
    play('program', 1);
    renderTrackHeads(); requestRender('timeline');
  };
  recorder.start(1000);
  const note = fellBack.length ? ` Your chosen ${fellBack.join(' and ')} wasn't found, so the default is being used.` : '';
  toast(`Recording ${withVideo ? 'camera ' : ''}on ${trackById(trackId).name}. Click the stop button (or press Space) to finish.${note}`, fellBack.length > 0);
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
  if (R.preview) { R.preview.srcObject = null; R.preview = null; }
  await R.sending; // every chunk is on disk before finishing
  const measured = R.startedWall ? (performance.now() - R.startedWall) / 1000 : 0;
  const trackName = trackById(R.trackId)?.name || 'audio';
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const name = `${R.withVideo ? 'Camera' : 'Recording'} ${trackName} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
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
  if (dur > 0) placeTake(meta, R.trackId, R.start, dur);
  renderTrackHeads(); requestRender();
  toast(R.lost ? 'Recording added, but part of it could not be saved' : 'Recording added to the timeline', !!R.lost);
}

// Place a finished take where it started. Each part goes on the track that was
// recorded onto if it's free there, otherwise on a new track next to it, so
// existing clips are never covered or cut:
// - picture: the clicked video track, or a new video track just above it;
// - sound of a camera take: the first audio track free for that span, or a new one at the bottom;
// - sound of a microphone take: the clicked audio track, or a new one just below it.
function placeTake(meta, trackId, start, dur) {
  mutate(meta.hasVideo ? 'Record camera' : 'Record audio', () => {
    const e = start + dur;
    const free = (id) => !P().clips.some((c) => c.trackId === id && c.start < e - EPS && end(c) > start + EPS);
    const addTrack = (kind, at) => {
      const t = { id: (kind === 'video' ? 'V' : 'A') + uid(), kind, name: '', ...(kind === 'video' ? { hidden: false } : { muted: false }) };
      P().tracks.splice(at, 0, t); return t.id;
    };
    const target = trackById(trackId);
    let vTid = null, aTid = null;
    if (meta.hasVideo) {
      if (target && target.kind === 'video' && free(target.id)) vTid = target.id;
      else {
        const at = target && target.kind === 'video' ? P().tracks.indexOf(target) : 0; // above = earlier in the list
        vTid = addTrack('video', at);
      }
    }
    if (meta.hasAudio) {
      if (target && target.kind === 'audio') aTid = free(target.id) ? target.id : addTrack('audio', P().tracks.indexOf(target) + 1);
      else aTid = P().tracks.find((t) => t.kind === 'audio' && free(t.id))?.id || addTrack('audio', P().tracks.length);
    }
    // Keep labels in order: video V(n)…V1 top to bottom, audio A1…A(n). Ids don't change.
    const vs = P().tracks.filter((t) => t.kind === 'video'); vs.forEach((t, i) => { t.name = 'V' + (vs.length - i); });
    P().tracks.filter((t) => t.kind === 'audio').forEach((t, i) => { t.name = 'A' + (i + 1); });
    const linkId = vTid && aTid ? uid() : null; const ids = [];
    for (const tid of [vTid, aTid]) {
      if (!tid) continue;
      const c = { id: uid(), mediaId: meta.id, trackId: tid, start, in: 0, out: dur, linkId, volume: 1 };
      P().clips.push(c); ids.push(c.id);
    }
    S.selection = new Set(ids);
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
        if (p.rate < 0 || p.rate > 4) for (const c of layersAt(t)) if (S.assets[c.mediaId]) S.assets[c.mediaId].preload(c.in + t - c.start, p.rate < 0 ? 2 : 0.2, p.rate < 0 ? 0.2 : 2);
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
      if (dirty.timeline) { dirty.timeline = false; renderTimeline(); emitClip(); }
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
  a.preload(S.source.t, 1, 3); a.loadPeaks();
  if (sourceAudioGain() > 0) a.loadAudio(); // a timeline clip without sound needn't decode the whole file's audio
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
      if (heardMediaIds().has(m.id)) a.loadAudio();
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
function setSelection(clips) { S.selection = new Set(clips.map((c) => c.id)); requestRender(); }
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
    S.lastClicked = c.id;
    if (!isText(c)) loadSource(c.mediaId, c.id);
    else window.dispatchEvent(new Event('cutroom:show-inspector'));
    const before = editState();
    if (hit.edge) {
      S.drag = { type: 'trim', edge: hit.edge, x0: x, before, set: trimGroup(c, e.altKey), grab: { ...c } };
    } else {
      let ids = new Set(e.altKey ? [c.id] : [...S.selection]);
      if (S.linked && !e.altKey) for (const id of [...ids]) for (const p of partners(clipById(id))) ids.add(p.id);
      const orig = [...ids].map((id) => ({ ...clipById(id) }));
      S.drag = { type: 'move', x0: x, y0: y, before, started: false, grab: { ...c }, orig, ...pushBlock(orig) };
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
      if (!isText(c)) { S.source.t = d.edge === 'in' ? c.in : Math.max(c.in, c.out - 1 / (S.media[c.mediaId].fps || 30)); scrubAudio('source'); }
      requestRender(); edgeScroll(x, cv.clientWidth); return;
    }
    if (d.type === 'move') {
      if (!d.started && Math.hypot(x - d.x0, y - d.y0) < 4) return;
      d.started = true; cv.style.cursor = 'grabbing';
      const ids = new Set([...d.orig, ...d.followers].map((o) => o.id));
      const lo = d.pushing ? d.lo : -Math.min(...d.orig.map((o) => o.start));
      let dt = tOf(x) - tOf(d.x0);
      dt = Math.max(dt, lo);
      const cands = []; for (const o of d.orig) cands.push(o.start + dt, end(o) + dt);
      dt = qt(dt + snapDelta(cands, ids)); dt = Math.max(dt, lo);
      if (d.pushing) {
        // Push: the clip and everything after it on the affected tracks move as one block.
        for (const o of [...d.orig, ...d.followers]) clipById(o.id).start = o.start + dt;
        requestRender('timeline'); requestRender('program'); edgeScroll(x, cv.clientWidth);
        return;
      }
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
      if (d.pushing) commit(S.pushMode === 'all' ? 'Push all tracks' : 'Push track', d.before);
      else {
        const ids = new Set(d.orig.map((o) => o.id));
        for (const id of ids) { const c = clipById(id); overwrite(c.trackId, c.start, end(c), ids); }
        commit('Move clip', d.before);
      }
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
// The scrollbar under the timeline spans the whole sequence (plus room to keep
// going); its thumb is the visible part.
function scrollRange(visible) { return Math.max(seqEnd() + visible * 0.5, S.scroll + visible, visible); }
function updateScrollbar(viewW) {
  const bar = $('tlScroll'), thumb = $('tlThumb'); if (!bar) return;
  const W = bar.clientWidth; const visible = viewW / S.zoom; const total = scrollRange(visible);
  const tw = Math.max(24, (visible / total) * W);
  thumb.style.width = tw + 'px';
  thumb.style.left = Math.min(W - tw, (S.scroll / total) * W) + 'px';
}
function wireScrollbar() {
  const bar = $('tlScroll'), thumb = $('tlThumb');
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const W = bar.clientWidth; const visible = $('tlCanvas').clientWidth / S.zoom; const total = scrollRange(visible);
    if (e.target !== thumb) {
      // Click outside the thumb: center the view there, then keep dragging from it.
      const f = (e.clientX - bar.getBoundingClientRect().left) / W;
      S.scroll = clamp(f * total - visible / 2, 0, Math.max(0, total - visible));
    }
    drag = { x0: e.clientX, scroll0: S.scroll, total, visible, W };
    bar.setPointerCapture(e.pointerId); S.uiDirty = true; requestRender('timeline');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    S.scroll = clamp(drag.scroll0 + ((e.clientX - drag.x0) / drag.W) * drag.total, 0, Math.max(0, drag.total - drag.visible));
    S.uiDirty = true; requestRender('timeline');
  });
  const release = () => { drag = null; };
  bar.addEventListener('pointerup', release); bar.addEventListener('pointercancel', release);
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
  // On the program picture: drag a cutout or a text card to move it; ⌥-click a
  // clip to set its zoom focus; drag anywhere else to scrub the sequence.
  const pc = $('programCanvas');
  const toFrame = (e) => { const { x, y } = localXY(e, pc); const v = S.view; return v ? { x: (x - v.rx) / v.k, y: (y - v.ry) / v.k } : null; };
  const layerAtPoint = (pt) => {
    if (!pt || !P()) return null;
    for (const c of layersAt(S.playhead).reverse()) {
      const b = layerBox(c);
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return { c, b };
    }
    return null;
  };
  pc.addEventListener('pointerdown', (e) => {
    if (S.play) stop(); pc.setPointerCapture(e.pointerId);
    const pt = toFrame(e); const hit = layerAtPoint(pt);
    if (hit && e.altKey && !isText(hit.c)) {
      const g = hit.b.g; const u = (pt.x - hit.b.x) / hit.b.w, v = (pt.y - hit.b.y) / hit.b.h;
      setSelection([hit.c]); S.lastClicked = hit.c.id;
      editClip({ id: hit.c.id, patch: { zoom: { x: clamp(g.src.x + u * g.src.w, 0, 1), y: clamp(g.src.y + v * g.src.h, 0, 1) } }, label: 'Zoom focus' });
      return;
    }
    if (hit && !hit.b.full) {
      const c = hit.c; setSelection([c]); S.lastClicked = c.id;
      const o = isText(c) ? clipText(c) : clipFrame(c);
      pc._move = { id: c.id, key: isText(c) ? 'text' : 'frame', p0: pt, x0: o.x, y0: o.y };
      return;
    }
    pc._x = e.clientX; pc._t = S.playhead;
  });
  pc.addEventListener('pointermove', (e) => {
    const mv = pc._move;
    if (mv) {
      const pt = toFrame(e); const { width: W, height: H } = P().settings;
      const x = clamp(mv.x0 + (pt.x - mv.p0.x) / W, 0, 1), y = clamp(mv.y0 + (pt.y - mv.p0.y) / H, 0, 1);
      editClip({ id: mv.id, patch: { [mv.key]: { x, y } }, label: 'Move in frame' });
      return;
    }
    if (pc._x == null) {
      const hit = e.buttons ? null : layerAtPoint(toFrame(e));
      pc.style.cursor = hit && e.altKey && !isText(hit.c) ? 'crosshair' : hit && !hit.b.full ? 'move' : '';
      return;
    }
    const range = Math.max(seqEnd(), 1); setPlayhead(clamp(pc._t + ((e.clientX - pc._x) / pc.clientWidth) * range, 0, range)); scrubAudio('program'); ensurePlayheadVisible();
  });
  const endDrag = () => { pc._x = null; pc._move = null; };
  pc.addEventListener('pointerup', endDrag);
  pc.addEventListener('pointercancel', endDrag);

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
  if (S.slug && S.slug !== slug) leavePresence(S.slug);
  if (S.slug) { try { await flushSave(); } catch {} }
  if (S.play) stop();
  const data = await api('GET', `/api/projects/${enc(slug)}`);
  for (const a of Object.values(S.assets)) for (const v of Object.values(a.videos)) { v.removeAttribute('src'); v.load(); v.remove(); }
  frameLRU.clear(); binEls.forEach((el) => el.remove()); binEls.clear();
  const p = data.project;
  p.tracks = p.tracks || []; p.clips = p.clips || []; p.bin = p.bin || { marks: {}, hidden: [] };
  p.bin.marks = p.bin.marks || {}; p.bin.hidden = p.bin.hidden || [];
  p.settings = p.settings || { width: 1920, height: 1080, fps: 30, auto: true };
  // The active timeline lives at the top level (tracks, clips, settings, markers),
  // so saving and export always see it; the others wait in p.timelines.
  p.markers = p.markers || []; p.timeline = p.timeline || { id: 'main', name: 'Main' }; p.timelines = p.timelines || [];
  Object.assign(S, {
    slug, project: p, dir: data.dir, rev: p.rev || 0, changeSeq: 0, savedSeq: 0, uiDirty: false,
    media: {}, assets: {}, undo: [], redo: [], undoByTimeline: {}, selection: new Set(),
    playhead: p.ui?.playhead || 0, zoom: p.ui?.zoom || 60, scroll: p.ui?.scroll || 0, vscroll: 0,
    snap: p.ui?.snap ?? true, linked: p.ui?.linked ?? true, pushMode: p.ui?.push || 'off',
    source: { mediaId: null, clipId: null, t: 0 },
  });
  $('snapBtn').checked = S.snap; $('linkBtn').checked = S.linked; setPushMode(S.pushMode, { restoring: true });
  p.name = p.name || slug; // a project folder's name stands in if the file lost its own
  $('projectName').textContent = p.name; document.title = `${p.name} — Cutroom`;
  history.replaceState(null, '', `?p=${enc(slug)}`);
  setSaveState('saved', `Opened from disk`);
  $('sourceTitle').textContent = 'No clip'; $('sourceDur').textContent = ''; $('sourceInOut').innerHTML = '';
  applyMediaList(data.media);
  zoomAt(S.zoom, 0); S.scroll = p.ui?.scroll || 0;
  afterStructureChange(); refreshMedia(); emitTimelines();
  S.conflict = false; S.others = []; emitPresence(); pingPresence();
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
  try { for (const c of P().clips.filter(isText)) await uploadCard(c); } catch (e) { $('exStatus').textContent = 'Could not draw a text card: ' + e.message; return; }
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
        P().tracks = snap.tracks; P().clips = snap.clips; P().settings = snap.settings; P().markers = snap.markers || [];
        if (snap.timeline) { P().timeline = snap.timeline; P().timelines = snap.timelines || []; }
        P().bin = snap.bin || { marks: {}, hidden: [] };
      });
      emitTimelines(); renderBin(); dlg.close(); toast(`Restored version from ${when} (⌘Z to undo)`);
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
  for (const [m, id] of Object.entries(PUSH_BUTTONS)) $(id).onclick = () => setPushMode(m);
  $('linkBtn').onchange = () => { S.linked = $('linkBtn').checked; S.uiDirty = true; };
  $('fitBtn').onclick = zoomFit;
  $('addTextBtn').onclick = addTextCard;
  window.addEventListener('cutroom:clip-edit', (e) => editClip(e.detail));
  window.addEventListener('cutroom:add-text', addTextCard);
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
  readTheme(); wireChrome(); wireTimeline(); wireScrollbar(); wireSource(); wireKeys(); focusPanel('program');
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
