# Design system adoption plan — Cutroom

Status: **plan only — waiting for go-ahead.** No UI has been restyled yet.

**Already wired**, as `AGENTS.md` asks:
- `app/layout.js` imports `design-system/styles.css` once, and `<html data-mode="2">` puts it in dark mode.
- The editor's own `app/globals.css` loads after it.
- `jsconfig.json` maps `@ds/*` to `./design-system/*`.

The editor moved to Next.js (React) just before this plan, so the React components
can be used directly.

**Rules for the work:**
- Behavior, data and saving stay exactly as they are.
- Each area is done in two passes: tokens first, then components.
- The engine (`app/editor/engine.js`) finds elements by `id`. Every swapped
  element keeps its id. Where a component changes the markup the engine touches,
  this plan lists the minimal engine edit (section 6).

---

## 1. What the editor is made of

| Area | File | Elements |
| --- | --- | --- |
| Top bar | `components/TopBar.jsx` | app name, project button, save-status dot + text, 4 subtle buttons, primary Export button |
| Media bin | `components/MediaBin.jsx` + engine `renderBin()` | panel, eyebrow heading, Import button, file input, grid of bin items built by the engine (thumbnail canvas, name, meta, status, progress bar, × and Retry buttons), empty state, "Show removed" link |
| Source viewer | `components/SourceViewer.jsx` | panel, heading row, picture canvas, scrub-bar canvas, timecode, 5 transport buttons, gain slider, "Place at playhead" button, in/out readout |
| Program viewer | `components/ProgramViewer.jsx` | panel, heading row, canvas, timecode, 5 transport buttons, shuttle-rate label |
| Timeline | `components/Timeline.jsx` + engine `renderTrackHeads()`, `renderTimeline()` | toolbar (8 buttons, 2 on/off buttons, separators, hint, zoom slider); track heads built by the engine (name + Hide/Mute); one canvas for ruler, lanes, clips, waveforms, filmstrips, playhead, snap line and drop ghost |
| Dialogs | `components/Dialogs.jsx` + engine | Projects (list, text input, Create), Export (3 selects, text input, progress, status, 3 buttons, list), Versions (list), Sequence settings (3 number inputs, 2 buttons) |
| Overlays | `Editor.jsx` | drop overlay, toast |

---

## 2. Components: what each element becomes

| Today | Design system | Notes |
| --- | --- | --- |
| `<button class="btn btn-primary">` (Export, Create, Apply, Export-start) | `<Button variant="primary">` | |
| `btn-outline` (Import, Place at playhead, Cancel export) | `<Button variant="outline">` | |
| `btn-subtle` (top bar, toolbar, Close/Cancel) | `<Button variant="subtle">` | |
| `btn-small` (toolbar, Import, Place) | `<Button size="medium">` | The system has no small size, so these grow from 24px to 32px and the toolbar gets 8px taller. |
| `btn-icon` transport (⏮ ◂ ▶ ▸ ⏭) | `<Button variant="subtle" iconOnly leftIcon={<Icon name="…"/>}>` | Material Symbols: `skip_previous`, `navigate_before`, `play_arrow` / `pause`, `navigate_next`, `skip_next`. This replaces the text glyphs. |
| `⇤ In` / `Out ⇥` | `<Button variant="subtle">` labelled "In" / "Out" | |
| Snap / Link on-off buttons | `<Toggle label="Snap">`, `<Toggle label="Link">` | Becomes a switch. Needs an engine edit (6c). |
| Track Hide / Mute (engine-built) | Toggle markup (`label.toggle.toggle-medium > input.toggle-input + .toggle-track > .toggle-thumb`, plus `.toggle-content > .toggle-label`) | Track heads are created in the engine, so it writes the Toggle's markup rather than rendering the React component. |
| Bin item × and Retry (engine-built) | Button markup (`button.btn.btn-medium.btn-subtle` / `btn-outline` + `span.btn-label`) | Same reason. |
| `.input` text and number fields | `<TextField label=… size="medium">` | Labels move from the wrapping `<label class="field">` into the component's `label` prop. |
| Export dialog `<select>`s | `<Dropdown options=… />` | The design system's Select is a custom dropdown, not a native `<select>`. Needs an engine edit (6d). |
| Headings, eyebrows, muted paragraphs | `<Text variant="headers-h5">`, `<Text variant="eyebrow-small">`, `<Text variant="body-small" color="muted">` | |
| `.panel` sections (bin, source, program, timeline) | `<Surface as="section" variant="surface-card" rounded="large" padding="small">` | Keeps `id` and `tabIndex`. The editor's own `.panel` class is renamed to `.pane`, because `design-system/panels.css` also defines `.panel`. |
| `.modal` dialogs | `<dialog>` stays (the engine calls `showModal()`), with the content wrapped in `<Surface variant="surface-menu">` | |
| Range sliders (gain, zoom) | *no component* | Stay native, coloured with `accent-color: var(--cb-brand-bg)`. |
| Progress bar, toast, drop overlay, save dot, bin item, list rows, timecode readouts | *no component* | Stay custom, built only from tokens (sections 3–5). |
| `Checkbox`, `RadioButton`, `TextArea` | — | Not used. |

---

## 3. Colors

The new system is grayscale. In dark mode `--cb-brand-bg` is near-white, and
`--cb-subtle-bg` is solid white (the system shows it through an opacity layer).
Three kinds of fix follow from that.

### 3a. Tokens the editor uses that don't exist in the new system (19)

| Old token | Where | New token |
| --- | --- | --- |
| `--cb-badge-positive-bg` | save dot: saved | `--primitive-evaluative-good-200` |
| `--cb-badge-warning-bg` | save dot: saving; track toggle on; in/out marks, snap line | `--primitive-evaluative-meh-200` |
| `--cb-badge-warning-text` | track toggle on | `--primitive-basics-grayscale-950` |
| `--cb-badge-negative-bg` | save dot: error; error text; error toast | `--cb-error-border` (dot), `--cb-error-text` (text), `--cb-error-bg` (toast) |
| `--cb-badge-negative-text` | error toast text | `--cb-error-text` |
| `--cb-badge-neutral-bg` / `-shadow` | save dot: idle | `--cb-disabled-bg` / none |
| `--cb-brand-text-hover` | primary button hover | the Button component handles it |
| `--cb-inputs-bg`, `-text`, `-border`, `-shadow`, `-bg-hover` | `.input` | the TextField component handles them |
| `--cb-secondary-bg` / `-text` | toggle on; active bin item; current project row | Toggle component; for rows, `--cb-surface-plot-bg` with a `--cb-surface-plot-border` outline |
| `--cb-subtle-shadow-hover` | subtle button hover | the Button component handles it |
| `--primitive-basics-indigo-1400` | audio waveform | `--primitive-basics-grayscale-950` |
| `--primitive-basics-text-25` | label text on video clips | `--primitive-basics-core-white` |
| `--primitive-basics-text-900` | label text on audio clips | `--primitive-basics-grayscale-950` |

### 3b. Tokens that still exist but now mean something else

| Use | Today | Problem | New |
| --- | --- | --- | --- |
| Timeline alternate lanes (canvas) | `--cb-subtle-bg` | now solid white (the white lanes you see now) | `--cb-surface-003-bg` |
| Bin item hover | `--cb-subtle-bg-hover` | now solid white | `--cb-surface-003-bg` |
| Ruler background (canvas) | `--cb-surface-content-bg` | now `none`, which canvas can't paint | `--cb-surface-menu-bg` |
| Video clip fill (canvas) | `--cb-brand-bg` | now near-white | `--primitive-datavis-categorical-001` (blue) |
| Audio clip fill (canvas) | `--primitive-datavis-categorical-002` | — | unchanged (green); the next categorical step after video |
| Panel focus ring, selected panel | `--cb-brand-bg` | white ring | `--cb-focus-ring` (green, as the Button component uses) |
| Muted text (`.muted`, `.hint`, list `.sub`, ruler labels) | `--cb-surface-card-text` + opacity | now plain white | `--cb-secondary_text-text`, opacity dropped |
| Toolbar separator | `--cb-ui-border` at 0.3 opacity | | `--cb-surface-plot-border`, opacity dropped |
| App name, link, rate label, used-in-timeline dot, drop-overlay border | `--cb-brand-bg` | white, no accent | unchanged; white is this system's accent in dark mode |
| Progress bar, slider accent | `--cb-brand-bg` | | unchanged |

### 3c. Colors with no token, kept as they are

These are opacities; the system has no opacity tokens except the subtle-layer ones:
- drop overlay 0.92 and dialog backdrop 0.7;
- canvas alphas: drop ghost 0.5, muted track 0.6, outside in/out 0.7, lanes 0.9, minor ruler ticks 0.4.

---

## 4. Fonts and type sizes

- **Faces:** Google Sans → **Inter** and Roboto Mono → **Roboto Mono**. Both are
  set by `--font-sans` / `--font-mono`, so no code change is needed. They load from
  Google's servers via `fonts.css` and fall back to the system font offline.
  Material Symbols, which the Icon component uses, loads the same way.
- **Sizes:** every type class is 2px smaller than before.
  - `ui-small`, `body-small` and `code-small` are now **10px**.
  - `labels-small` is now **8px**.
  - The editor keeps its class names, so the new sizes apply automatically.
- **Canvas text:** it uses `--typography-ui-small-font-size − 1`, which is now 9px
  and too small. It moves to `--typography-code-medium-font-size` (12px) for ruler
  timecodes and `--typography-ui-medium-font-size` (12px) for clip names.
- **Page base:** `body` takes `AGENTS.md`'s base, the `--typography-body-medium-*`
  family, size and line-height, instead of `--font-sans` with the ui-medium size.

## 5. Sizes, radii and shadows

| Hard-coded today | Where | Token |
| --- | --- | --- |
| `14rem` / `22rem` | bin column min/max (`.workspace`) | `--width-md` (15rem) / `--width-lg` (20rem) |
| `8.5rem` | bin thumbnail min width | `--width-sm` (10rem) |
| `6rem` | gain slider | `--width-xs` (5rem) |
| `9rem` | zoom slider | `--width-sm` (10rem) |
| `7.5rem` | track header column | `--width-sm` (10rem); it needs the room once Hide/Mute are switches |
| `2rem` | rate label min width | `--height-sm` |
| `36rem`, `calc(100vw - 2rem)` | dialog width | `--width-3xl` (35rem); the gutter uses `--spacing-xl` |
| `18rem` | dialog list max height | `--height-10xl` (25rem) |
| `20rem` | `.input` max-width fallback | removed (TextField sets its own) |
| canvas `RULER_H 28` | ruler height | `--height-sm` (32px) |
| canvas `VH 62` / `AH 46` | video / audio track height | `--height-lg` (64px) / `--height-md` (48px) |
| canvas `GAP 10` | gap between video and audio tracks | `--spacing-sm` |
| canvas `14` | clip label strip | `--spacing-lg` |
| canvas radius `5` | clip corners | `--radius-sm` (6px) |
| canvas `lineWidth 2` / `1.5`, bars `2` / `3` | selection, drop ghost, playhead, in/out bars | `--border-md` / `--border-md-sm`, `--border-md` / `--border-lg` |
| `--cb-surface-card-shadow`, `--cb-surface-menu-shadow` | panels, dialogs, toast | unchanged; both are `none` in this system's dark mode, so panels separate by background (grayscale-800 on black) |
| all `--radius-*`, `--spacing-*`, `--border-*`, `--height-*`, motion | everywhere else | already tokens; same names, same values (radii are now rem, which equals the old px) |

The canvas reads its values once in `readColors()`. That function becomes
`readTheme()` and also reads the size tokens through `getComputedStyle`, converting
rem to px.

Kept as is because they are functional, not visual:
- the hidden 2px video pool (`#videoPool`);
- the bin thumbnail canvas's internal 256×144 size;
- cursor styles.

---

## 6. Engine edits needed by the component swap

These are minimal and keep behavior identical:

- **a. Transport play buttons:** the engine sets `textContent = '▶' / '❚❚'`, which
  would wipe the Button's inner markup. It will set the Icon's text to
  `play_arrow` / `pause` instead.
- **b. Undo/Redo:** the engine sets `.disabled`. That works unchanged on Button.
- **c. Snap/Link:** the engine sets `aria-pressed` and listens for `click`. It will
  set `.checked` on the Toggle's input (same `id`) and listen for `change`. The N
  key keeps toggling snapping.
- **d. Export selects:** the engine fills `#exPreset` with `sel.add()` and reads
  `.value` from all three selects. `ExportDialog` will render the three `Dropdown`s
  from `/api/info`. It mirrors each value into a hidden `<input>` with the old id and
  fires `change` on it, so the engine's reads and its summary update stay as they are.
- **e. Track heads, bin items, dialog lists:** these stay engine-built. Only their
  markup strings change to the design system's class structure.

## 7. Order of work

One area at a time, each in two passes: tokens, then components. I'll check the
editor in the browser after each pass.

1. **Page base and canvas theme:** `body`, the `.panel` → `.pane` rename,
   `readTheme()`, sections 3 and 5 for the canvas. This fixes the white lanes first.
2. **Top bar**
3. **Media bin**
4. **Source and program viewers**
5. **Timeline toolbar and track heads**
6. **Dialogs and overlays**

## 8. Decisions for you

1. **Type size:** the new system is 2px smaller everywhere, so most of the editor
   ends up at 10px. Keep the classes as mapped (smaller, denser), or move every text
   class up one step (`ui-small` → `ui-medium`, and so on) so sizes stay close to
   today's?
2. **Switches:** are Snap/Link and the track Hide/Mute controls OK as switches,
   rather than buttons that light up?
3. **Clip colors:** blue for video and green for audio (categorical palette steps
   001 and 002)?
4. **Transport icons:** Material Symbols in place of the current text glyphs?
