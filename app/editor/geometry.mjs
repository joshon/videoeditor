// Where a clip on a video track lands in the frame, and what part of its media
// shows. Shared by the editor (engine.js, drawing the Program viewer) and the
// server (server.js, building the export), so the two always agree.
//
//   clip.frame = { scale, x, y, shape }  — reframe: size (1 = fills the frame),
//                                           centre (0..1 of the frame), and
//                                           'rect' | 'rounded' | 'circle'
//   clip.zoom  = { from, to, x, y }      — push in or out over the clip: zoom at
//                                           its first and last frame (1 = none),
//                                           around a focus point (0..1 of the picture)
//   clip.text  = { content, font, weight, size, color, bg, bgMode, x, y, align }
//                                        — a text card (clip.kind === 'text')

export const FRAME_DEFAULT = { scale: 1, x: 0.5, y: 0.5, shape: 'rect' };
export const ZOOM_DEFAULT = { from: 1, to: 1, x: 0.5, y: 0.5 };
export const TEXT_DEFAULT = {
  content: 'Title', font: 'Inter', weight: 700, size: 96, color: '#ffffff',
  bg: '#000000', bgMode: 'full', x: 0.5, y: 0.5, align: 'center',
};
// Size is in pixels of a 1080-pixel-tall frame, so a card looks the same at any resolution.
export const TEXT_REF_HEIGHT = 1080;

export const clipFrame = (c) => ({ ...FRAME_DEFAULT, ...(c.frame || {}) });
export const clipZoom = (c) => ({ ...ZOOM_DEFAULT, ...(c.zoom || {}) });
export const clipText = (c) => ({ ...TEXT_DEFAULT, ...(c.text || {}) });

// The rounded shape's corner radius, as a fraction of the box's shorter side.
export const ROUNDED = 0.12;

export const isFullFrame = (f) => f.scale >= 0.999 && Math.abs(f.x - 0.5) < 1e-3 && Math.abs(f.y - 0.5) < 1e-3 && f.shape === 'rect';
export const hasZoom = (z) => Math.abs(z.from - 1) > 1e-3 || Math.abs(z.to - 1) > 1e-3;

// Eased progress 0..1 through the clip; the export writes the same curve as an ffmpeg expression.
export const ease = (u) => u * u * (3 - 2 * u);
export const zoomAt = (z, u) => z.from + (z.to - z.from) * ease(Math.min(1, Math.max(0, u)));

// The box's aspect ratio and the share of the media it shows at zoom 1 (a circle
// shows a square from the picture, positioned by the focus point).
export function boxShape(f, mw, mh) {
  const ma = mw / mh; const ba = f.shape === 'circle' ? 1 : ma;
  return { ba, sw: ba < ma ? ba / ma : 1, sh: ba > ma ? ma / ba : 1 };
}

// For a frame W×H and progress u through the clip:
//   box: where the clip is drawn (frame pixels)
//   src: the part of the media shown (0..1 of the media's width and height)
export function clipGeometry(c, mw, mh, W, H, u = 0) {
  const f = clipFrame(c); const z = clipZoom(c);
  const { ba, sw, sh } = boxShape(f, mw, mh);
  const bh = Math.min(H, W / ba) * f.scale, bw = bh * ba;
  const zf = Math.max(1, zoomAt(z, u));
  const zw = sw / zf, zh = sh / zf;
  return {
    box: { x: f.x * W - bw / 2, y: f.y * H - bh / 2, w: bw, h: bh },
    src: { x: z.x * (1 - zw), y: z.y * (1 - zh), w: zw, h: zh },
    shape: f.shape, full: isFullFrame(f),
  };
}

// A text card's lines, laid out for a frame W×H. Used to draw it and to hit-test it.
export function textLayout(ctx, t, W, H) {
  const px = t.size * (H / TEXT_REF_HEIGHT);
  ctx.font = `${t.weight} ${px}px "${t.font}"`;
  const lines = String(t.content || '').split('\n');
  const lh = px * 1.2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(1, ...widths), bh = lh * lines.length;
  const pad = t.bgMode === 'box' ? px * 0.4 : 0;
  const cx = t.x * W, cy = t.y * H;
  return { px, lh, lines, widths, block: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, pad };
}

// Draw a text card into a W×H frame (on a canvas already scaled to frame pixels).
export function drawText(ctx, c, W, H) {
  const t = clipText(c); const L = textLayout(ctx, t, W, H);
  if (t.bgMode === 'full') { ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H); }
  if (t.bgMode === 'box') {
    const b = L.block, p = L.pad;
    ctx.fillStyle = t.bg; ctx.beginPath(); ctx.roundRect(b.x - p, b.y - p, b.w + 2 * p, b.h + 2 * p, p * 0.6); ctx.fill();
  }
  ctx.fillStyle = t.color; ctx.textBaseline = 'middle';
  L.lines.forEach((line, i) => {
    const w = L.widths[i];
    const x = t.align === 'left' ? L.block.x : t.align === 'right' ? L.block.x + L.block.w - w : L.block.x + (L.block.w - w) / 2;
    ctx.fillText(line, x, L.block.y + L.lh * (i + 0.5));
  });
}

// The text card's bounds in frame pixels, for selecting and dragging it in the viewer.
export function textBounds(ctx, c, W, H) {
  const t = clipText(c); const L = textLayout(ctx, t, W, H);
  if (t.bgMode === 'full') return { x: 0, y: 0, w: W, h: H };
  const p = L.pad; return { x: L.block.x - p, y: L.block.y - p, w: L.block.w + 2 * p, h: L.block.h + 2 * p };
}

// Placement presets, shared by the reframe and text controls.
export const PLACES = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};
export const MARGIN = 0.04; // of the frame height, from the edge

// The centre (0..1) that puts a box of w×h (frame pixels) at a preset place.
export function placeCentre(place, w, h, W, H) {
  const [px, py] = PLACES[place] || PLACES.center; const m = MARGIN * H;
  const x = px === 0.5 ? W / 2 : px === 0 ? m + w / 2 : W - m - w / 2;
  const y = py === 0.5 ? H / 2 : py === 0 ? m + h / 2 : H - m - h / 2;
  return { x: x / W, y: y / H };
}
