# Cutroom

A simple local video editor built with Next.js. `server.js` is a Next.js custom
server: it handles `/api/*` and `/files/*` itself (uploads, `ffmpeg`/`ffprobe`
processing, saving, export) and hands every other request to Next.js, which renders
the UI from `app/`. The browser UI is only a view: every edit is saved to disk as
you make it, so nothing lives in browser storage.

```bash
cd ~/Documents/projects/videoeditor && npm run dev    # http://localhost:4700
npm run build && npm start                            # production build, same port
```

- `app/layout.js`, `app/page.js` — Next.js root; imports `design-system/styles.css`.
- `app/Editor.jsx`, `app/components/*` — the editor's structure as React components.
- `app/editor/engine.js` — the client engine (canvas scrubbing, timeline, playback,
  autosave). It attaches to the rendered DOM by element id after mount.

The port is registered in `~/Documents/projects/PROJECTS.md` (if present) — change it
there and in `.claude/launch.json` together.

Styling comes from the design system in `design-system/` (pulled from Design System Studio;
see `design-system/AGENTS.md`), imported once in `app/layout.js`. Re-pull to update it.
`design-system/ADOPTION.md` is the plan for restyling the editor with it.

Requires Node 20.9+ and `ffmpeg`/`ffprobe` on `PATH` (override with `FFMPEG=`/`FFPROBE=`).
Projects live in `videoeditor/projects/` by default (override with `VE_PROJECTS_DIR=`).

## Project folder

```
projects/<Project name>/
  project.json     timeline, tracks, marks, sequence settings (atomic write + fsync on every edit)
  media/           your original files, copied in on import — never modified or deleted
  cache/<id>/      derived files: proxy.mp4, frames/*.jpg (scrub cache), audio.m4a, peaks.json, meta.json
  history/         a full snapshot of project.json every 30 s of editing, on ⌘S, and before a restore
  exports/         rendered files; an export never overwrites an existing file
```

`cache/` can always be rebuilt from `media/` (use **Retry** on a bin item).

## How scrubbing works

On import each clip gets a frame cache (every frame up to 30 fps for clips under
4 minutes, sparser for longer ones) and a short-GOP proxy. Dragging draws cached
frames straight to canvas, so the picture follows the mouse instantly; when you stop,
an exact seek on the proxy fills in the full-resolution frame. Audio scrubs too, as
short enveloped grains. Playback is clocked from the audio device.

## Keys

| Key | Action |
| --- | --- |
| Space | Play / pause (focused viewer) |
| J / K / L | Shuttle reverse / stop / forward (press again for 2×, 4×, 8×) |
| ← / → | One frame (⇧ = one second) |
| ↑ / ↓ | Previous / next edit point |
| I / O | Mark in / out in the Source viewer (on a timeline clip, this trims it) |
| Q / W | Trim selected clip's start / end to the playhead |
| S or ⌘K | Split at playhead (selected clips, or everything under the playhead) |
| ⌫ / ⇧⌫ | Delete / ripple delete |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘S | Save and write a version snapshot |
| N | Toggle snapping |
| = / − / \\ | Zoom in / out / fit |

⌥-drag a clip to move it without its linked audio/video. Pinch or ⌘-scroll the
timeline to zoom.

## Export presets

H.264 (high / standard / small / hardware), HEVC (software / hardware), ProRes 422
and 422 HQ, and audio-only AAC or WAV, at sequence size or 2160/1080/720/480p and any
common frame rate.
