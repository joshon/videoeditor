'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Icon, Text, TextArea, TextField } from '@ds/components';
import { clipFrame, clipZoom, clipText, clipGeometry, textBounds, placeCentre, PLACES, hasZoom } from '../editor/geometry.mjs';

// The Clip inspector shares the left column with the media bin. The engine
// (editor/engine.js) tells it which clip is selected through 'cutroom:clip';
// changes go back as 'cutroom:clip-edit' and are undoable like any edit.
const edit = (id, patch, label) => window.dispatchEvent(new CustomEvent('cutroom:clip-edit', { detail: { id, patch, label } }));
export const showInspector = () => window.dispatchEvent(new Event('cutroom:show-inspector'));
export const showMedia = () => window.dispatchEvent(new Event('cutroom:show-media'));

const PLACE_LABELS = {
  'top-left': 'Top left', top: 'Top', 'top-right': 'Top right',
  left: 'Left', center: 'Centre', right: 'Right',
  'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right',
};
const PLACE_OPTIONS = Object.keys(PLACES).map((value) => ({ value, label: PLACE_LABELS[value] }));
const SHAPES = [{ value: 'rect', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }];
// Fonts that come with macOS, plus the design system's own.
const FONTS = ['Inter', 'Roboto Mono', 'Helvetica Neue', 'Avenir Next', 'Futura', 'Gill Sans', 'Georgia', 'Baskerville', 'Didot', 'American Typewriter', 'Menlo', 'Marker Felt']
  .map((f) => ({ value: f, label: f }));
const WEIGHTS = [{ value: '300', label: 'Light' }, { value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' }, { value: '900', label: 'Black' }];
const BG_MODES = [{ value: 'full', label: 'Fills the frame' }, { value: 'box', label: 'Box behind the text' }, { value: 'none', label: 'None (over the video)' }];
const ALIGNS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }];

function useClip() {
  const [state, setState] = useState(() => (typeof window !== 'undefined' && window.__cutroomClip) || { clip: null });
  useEffect(() => {
    const on = (e) => setState(e.detail);
    window.addEventListener('cutroom:clip', on);
    if (window.__cutroomClip) setState(window.__cutroomClip);
    return () => window.removeEventListener('cutroom:clip', on);
  }, []);
  return state;
}

// The preset a centre matches, or 'custom' once it has been dragged elsewhere.
function placeOf(x, y, w, h, W, H) {
  for (const p of Object.keys(PLACES)) {
    const c = placeCentre(p, w, h, W, H);
    if (Math.abs(c.x - x) < 0.002 && Math.abs(c.y - y) < 0.002) return p;
  }
  return 'custom';
}

export function PaneTabs({ current }) {
  return (
    <div className="pane-tabs">
      <Button variant={current === 'media' ? 'outline' : 'subtle'} type="button" onClick={showMedia}>Media</Button>
      <Button variant={current === 'clip' ? 'outline' : 'subtle'} type="button" onClick={showInspector}>Clip</Button>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, format, onChange }) {
  return (
    <label className="slider">
      <span className="text-labels-small">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="text-code-small value">{format ? format(value) : value}</span>
    </label>
  );
}

function MediaControls({ clip, media, seq }) {
  const f = clipFrame(clip), z = clipZoom(clip);
  const W = seq.width, H = seq.height;
  const boxFor = (frame) => clipGeometry({ frame }, media.width, media.height, W, H).box;
  const full = f.scale >= 0.999 && f.shape === 'rect' && Math.abs(f.x - 0.5) < 1e-3 && Math.abs(f.y - 0.5) < 1e-3;
  const box = boxFor(f);
  const place = full ? 'full' : placeOf(f.x, f.y, box.w, box.h, W, H);
  // Change the frame, keeping it at its preset place (a resized cutout stays in its corner).
  const setFrame = (next, label, at = place) => {
    const nf = { ...f, ...next };
    if (at !== 'custom' && at !== 'full') { const b = boxFor(nf); Object.assign(nf, placeCentre(at, b.w, b.h, W, H)); }
    edit(clip.id, { frame: nf }, label);
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  return (
    <>
      <div className="inspector-section">
        <Text variant="eyebrow-small">Position &amp; size</Text>
        <Button variant="outline" type="button" leftIcon={<Icon name="picture_in_picture" size="lg" />}
          onClick={() => setFrame({ scale: 0.32, shape: 'circle' }, 'Make cutout', 'bottom-right')}>
          Cutout in the bottom right
        </Button>
        <div className="row">
          <Dropdown label="Place" value={place}
            options={[{ value: 'full', label: 'Fill the frame' }, ...PLACE_OPTIONS, ...(place === 'custom' ? [{ value: 'custom', label: 'Where I dragged it' }] : [])]}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'full') edit(clip.id, { frame: null }, 'Fill the frame');
              else if (v !== 'custom') setFrame({ scale: full ? 0.32 : f.scale }, 'Place clip', v);
            }} />
          <Dropdown label="Shape" value={f.shape} options={SHAPES} onChange={(e) => setFrame({ shape: e.target.value, ...(full ? { scale: 0.32 } : {}) }, 'Clip shape', full ? 'bottom-right' : place)} />
        </div>
        <Slider label="Size" min={0.1} max={1} step={0.01} value={f.scale} format={pct} onChange={(v) => setFrame({ scale: v }, 'Clip size')} />
        <Text variant="body-small" color="muted">Drag it in the Program viewer to move it anywhere.</Text>
      </div>
      <div className="inspector-section">
        <Text variant="eyebrow-small">Zoom</Text>
        <div className="row">
          <Button variant="outline" type="button" onClick={() => edit(clip.id, { zoom: { from: 1, to: 1.25 } }, 'Push in')}>Push in</Button>
          <Button variant="outline" type="button" onClick={() => edit(clip.id, { zoom: { from: 1.25, to: 1 } }, 'Pull out')}>Pull out</Button>
          <Button variant="subtle" type="button" disabled={!hasZoom(z)} onClick={() => edit(clip.id, { zoom: null }, 'No zoom')}>None</Button>
        </div>
        <Slider label="At the start" min={1} max={3} step={0.01} value={z.from} format={pct} onChange={(v) => edit(clip.id, { zoom: { from: v } }, 'Zoom at start')} />
        <Slider label="At the end" min={1} max={3} step={0.01} value={z.to} format={pct} onChange={(v) => edit(clip.id, { zoom: { to: v } }, 'Zoom at end')} />
        <Text variant="body-small" color="muted">
          The zoom eases from the first value to the second across the clip. To zoom only near one end, split the clip there first.
          ⌥-click the Program viewer to choose the point it zooms towards.
        </Text>
      </div>
    </>
  );
}

function TextControls({ clip, seq }) {
  const t = clipText(clip);
  const W = seq.width, H = seq.height;
  const measure = useMemo(() => (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null), []);
  // The text's own size (ignoring a full-frame background), for placing it.
  const sizeOf = (tt) => { const b = textBounds(measure, { text: { ...tt, bgMode: tt.bgMode === 'full' ? 'none' : tt.bgMode } }, W, H); return b; };
  const b = measure ? sizeOf(t) : { w: 0, h: 0 };
  const place = measure ? placeOf(t.x, t.y, b.w, b.h, W, H) : 'center';
  const set = (next, label) => {
    const nt = { ...t, ...next };
    if (place !== 'custom' && measure) { const nb = sizeOf(nt); Object.assign(nt, placeCentre(place, nb.w, nb.h, W, H)); }
    edit(clip.id, { text: nt }, label);
  };
  return (
    <>
      <div className="inspector-section">
        <Text variant="eyebrow-small">Text</Text>
        <TextArea aria-label="Text" rows={3} value={t.content} onChange={(e) => set({ content: e.target.value }, 'Edit text')} />
        <div className="row">
          <Dropdown label="Font" value={t.font} options={FONTS} onChange={(e) => set({ font: e.target.value }, 'Font')} />
          <Dropdown label="Weight" value={String(t.weight)} options={WEIGHTS} onChange={(e) => set({ weight: Number(e.target.value) }, 'Font weight')} />
        </div>
        <Slider label="Size" min={16} max={400} value={t.size} format={(v) => `${v}px`} onChange={(v) => set({ size: v }, 'Text size')} />
        <div className="row">
          <Dropdown label="Place" value={place}
            options={[...PLACE_OPTIONS, ...(place === 'custom' ? [{ value: 'custom', label: 'Where I dragged it' }] : [])]}
            onChange={(e) => { const v = e.target.value; if (v !== 'custom') edit(clip.id, { text: placeCentre(v, b.w, b.h, W, H) }, 'Place text'); }} />
          <Dropdown label="Align lines" value={t.align} options={ALIGNS} onChange={(e) => set({ align: e.target.value }, 'Align text')} />
        </div>
      </div>
      <div className="inspector-section">
        <Text variant="eyebrow-small">Colour</Text>
        <div className="row">
          <TextField label="Text" type="color" className="swatch" value={t.color} onChange={(e) => set({ color: e.target.value }, 'Text colour')} />
          <TextField label="Background" type="color" className="swatch" value={t.bg} disabled={t.bgMode === 'none'} onChange={(e) => set({ bg: e.target.value }, 'Background colour')} />
        </div>
        <Dropdown label="Background" value={t.bgMode} options={BG_MODES} onChange={(e) => set({ bgMode: e.target.value }, 'Background')} />
        <Text variant="body-small" color="muted">Drag the text in the Program viewer to move it. Trim the clip on the timeline to change how long it shows.</Text>
      </div>
    </>
  );
}

export default function Inspector() {
  const [open, setOpen] = useState(false);
  const { clip, media, seq, track, count } = useClip();
  useEffect(() => {
    const show = () => setOpen(true), hide = () => setOpen(false);
    window.addEventListener('cutroom:show-inspector', show);
    window.addEventListener('cutroom:show-media', hide);
    return () => { window.removeEventListener('cutroom:show-inspector', show); window.removeEventListener('cutroom:show-media', hide); };
  }, []);
  // The media bin is the engine's; it is hidden, never unmounted, while this shows.
  useEffect(() => { const bin = document.getElementById('binPanel'); if (bin) bin.hidden = open; }, [open]);

  const isText = clip && clip.kind === 'text';
  return (
    <section className="pane inspector" hidden={!open}>
      <div className="pane-head">
        <PaneTabs current="clip" />
        <div className="spacer"></div>
        <Button variant="outline" type="button" title="Add a text card at the playhead" leftIcon={<Icon name="title" size="lg" />}
          onClick={() => window.dispatchEvent(new Event('cutroom:add-text'))}>Text card</Button>
      </div>
      <div className="inspector-body">
        {!clip && (
          <Text variant="body-small" color="muted" className="inspector-empty">
            Select a clip on a video track to resize it, make it a cutout or zoom into it. Add a text card for titles.
          </Text>
        )}
        {clip && (
          <Text variant="body-small" color="muted">
            {isText ? 'Text card' : media?.name || 'Clip'} · {track}
            {!isText && count > 1 ? ` · position, size and zoom apply to all ${count} selected clips` : ''}
          </Text>
        )}
        {clip && isText && seq && <TextControls key={clip.id} clip={clip} seq={seq} />}
        {clip && !isText && media && seq && <MediaControls key={clip.id} clip={clip} media={media} seq={seq} />}
      </div>
    </section>
  );
}
