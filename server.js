// Cutroom — local video editor server.
// A Next.js custom server: /api/* and /files/* are handled here (uploads, ffmpeg
// processing, saving, export); every other request goes to Next.js, which renders
// the editor UI from app/.
// Everything lives on disk under PROJECTS_DIR/<project>/. Nothing is kept in the
// browser: the client saves the timeline here on every edit, and media files are
// copied into the project folder on import and never modified or deleted.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const next = require('next');

const PORT = Number(process.env.PORT) || 4700;
const ROOT = __dirname;
const PROJECTS_DIR = path.resolve(process.env.VE_PROJECTS_DIR || path.join(ROOT, 'projects'));
const DEV = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev: DEV, dir: ROOT, hostname: 'localhost', port: PORT });
const nextHandle = nextApp.getRequestHandler();
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const SNAPSHOT_INTERVAL_MS = 30 * 1000;
const SETTINGS_FILE = path.join(PROJECTS_DIR, '.cutroom-settings.json');

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}
function fail(res, code, message) { sendJson(res, code, { error: message }); }

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Write-then-rename with fsync so a crash mid-write can never leave a half file.
async function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, file);
}
const writeJsonAtomic = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 2));

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const safeName = (s) => String(s).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'untitled';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function projectDir(slug) {
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.startsWith('.')) return null;
  const dir = path.join(PROJECTS_DIR, slug);
  return path.dirname(dir) === PROJECTS_DIR ? dir : null;
}

// Uniquely named path: never overwrite an existing file.
async function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext); let n = 2;
  while (await exists(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  return p;
}

function run(cmd, args, { onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => onStdout && onStdout(d));
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); onStderr && onStderr(d); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`)));
    run.last = child;
  });
}

function progressParser(duration, cb) {
  let buf = '';
  return (d) => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const m = /^out_time_us=(\d+)/.exec(l);
      if (m && duration > 0) cb(Math.min(0.999, Number(m[1]) / 1e6 / duration));
    }
  };
}

// ---------------------------------------------------------------- projects

function emptyProject(name) {
  return {
    format: 'cutroom-project', version: 1, name, rev: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    settings: { width: 1920, height: 1080, fps: 30, auto: true },
    tracks: [
      { id: 'V2', kind: 'video', name: 'V2', hidden: false },
      { id: 'V1', kind: 'video', name: 'V1', hidden: false },
      { id: 'A1', kind: 'audio', name: 'A1', muted: false },
      { id: 'A2', kind: 'audio', name: 'A2', muted: false },
    ],
    clips: [],
    bin: { marks: {}, hidden: [] },
    ui: { playhead: 0, zoom: 60, scroll: 0 },
  };
}

async function listProjects() {
  const out = [];
  for (const e of await fsp.readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = await readJson(path.join(PROJECTS_DIR, e.name, 'project.json'), null);
    if (!p) continue;
    out.push({ slug: e.name, name: p.name, updatedAt: p.updatedAt, clips: (p.clips || []).length });
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function createProject(name) {
  name = String(name || '').trim() || 'Untitled project';
  let slug = safeName(name); let n = 2;
  while (await exists(path.join(PROJECTS_DIR, slug))) slug = `${safeName(name)} ${n++}`;
  const dir = path.join(PROJECTS_DIR, slug);
  for (const sub of ['media', 'cache', 'history', 'exports']) await fsp.mkdir(path.join(dir, sub), { recursive: true });
  await writeJsonAtomic(path.join(dir, 'project.json'), emptyProject(name));
  return slug;
}

const lastSnapshot = new Map();
async function snapshot(dir, project, reason) {
  await fsp.mkdir(path.join(dir, 'history'), { recursive: true });
  await writeJsonAtomic(path.join(dir, 'history', `${stamp()}${reason ? '-' + reason : ''}.json`), project);
  lastSnapshot.set(dir, Date.now());
}

async function saveProject(dir, incoming, { forceSnapshot } = {}) {
  const file = path.join(dir, 'project.json');
  const current = await readJson(file, null);
  if (current && Number(incoming.rev) <= Number(current.rev)) {
    const e = new Error('Stale save: the project was saved from somewhere else (another tab?). Reload to get the latest.');
    e.code = 409; throw e;
  }
  incoming.updatedAt = new Date().toISOString();
  await writeJsonAtomic(file, incoming);
  if (forceSnapshot || Date.now() - (lastSnapshot.get(dir) || 0) > SNAPSHOT_INTERVAL_MS) {
    await snapshot(dir, incoming, forceSnapshot ? 'manual' : '');
  }
  return incoming;
}

// ---------------------------------------------------------------- media

const metaPath = (dir, id) => path.join(dir, 'cache', id, 'meta.json');
const activeUploads = new Set();
const queue = []; let processing = null;

async function listMedia(dir) {
  await recoverRecordings(dir);
  const cache = path.join(dir, 'cache'); const out = [];
  let entries = [];
  try { entries = await fsp.readdir(cache, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = await readJson(metaPath(dir, e.name), null);
    if (!m) continue;
    // Recover from a server restart mid-pipeline.
    const key = `${dir}::${m.id}`;
    if ((m.status === 'processing' || m.status === 'queued') && processing !== key && !queue.some((q) => q.key === key)) {
      enqueue(dir, m.id);
    }
    if (m.status === 'uploading' && !activeUploads.has(key)) {
      m.status = 'error'; m.error = 'Upload was interrupted. Import the file again.';
      await writeJsonAtomic(metaPath(dir, m.id), m);
    }
    out.push(m);
  }
  return out.sort((a, b) => String(a.importedAt).localeCompare(String(b.importedAt)));
}

async function handleUpload(req, res, dir, name) {
  const id = newId();
  const fileName = `${id}-${safeName(name)}`;
  const mediaFile = path.join(dir, 'media', fileName);
  const cacheDir = path.join(dir, 'cache', id);
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
  const meta = { id, name: String(name), file: fileName, status: 'uploading', progress: 0, importedAt: new Date().toISOString() };
  await writeJsonAtomic(metaPath(dir, id), meta);
  const key = `${dir}::${id}`; activeUploads.add(key);
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(mediaFile);
      req.pipe(out);
      req.on('error', reject); req.on('aborted', () => reject(new Error('aborted')));
      out.on('error', reject); out.on('finish', resolve);
    });
    const st = await fsp.stat(mediaFile);
    meta.size = st.size; meta.status = 'queued';
    await writeJsonAtomic(metaPath(dir, id), meta);
    enqueue(dir, id);
    sendJson(res, 200, meta);
  } catch (e) {
    meta.status = 'error'; meta.error = 'Upload failed: ' + e.message;
    await writeJsonAtomic(metaPath(dir, id), meta).catch(() => {});
    if (!res.headersSent) fail(res, 500, meta.error);
  } finally { activeUploads.delete(key); }
}

// ---------------------------------------------------------------- recordings
// A take is streamed here in ~1 s chunks while it records, appended to
// recordings/<id>.<ext>, so a crash or closed tab loses at most the last chunk.
// Finishing remuxes it into media/ (the raw file stays in recordings/ as a backup).

const activeRecordings = new Map(); // `${dir}::${id}` -> last activity (ms)
const RECORDING_IDLE_MS = 30 * 1000;
const recPath = (dir, id) => path.join(dir, 'recordings', id + '.json');
// "2026-10-09 17.19.09" in local time, for take names (no colons: they're file names).
const localStamp = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`; };

async function startRecording(dir, body) {
  const id = newId();
  const mime = String(body.mimeType || '');
  const ext = /mp4|m4a|aac/.test(mime) ? (/^video\//.test(mime) ? '.mp4' : '.m4a') : '.webm';
  await fsp.mkdir(path.join(dir, 'recordings'), { recursive: true });
  const rec = { id, ext, status: 'recording', startedAt: new Date().toISOString(), trackId: body.trackId || null, start: Number(body.start) || 0, mimeType: body.mimeType || '', mirror: !!body.mirror };
  await fsp.writeFile(path.join(dir, 'recordings', id + ext), Buffer.alloc(0));
  await writeJsonAtomic(recPath(dir, id), rec);
  activeRecordings.set(`${dir}::${id}`, Date.now());
  return rec;
}

// Append one chunk (raw bytes, in order) to the take's file and flush it to disk.
async function appendRecordingChunk(req, dir, id) {
  id = path.basename(id);
  const rec = await readJson(recPath(dir, id), null);
  if (!rec || rec.status !== 'recording') { const e = new Error('No such recording in progress'); e.code = 404; throw e; }
  const chunks = []; let size = 0;
  await new Promise((resolve, reject) => {
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024 * 1024) { reject(new Error('Chunk too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', resolve); req.on('error', reject);
  });
  const fh = await fsp.open(path.join(dir, 'recordings', id + rec.ext), 'a');
  try { await fh.write(Buffer.concat(chunks)); await fh.sync(); } finally { await fh.close(); }
  activeRecordings.set(`${dir}::${id}`, Date.now());
  return { ok: true, bytes: size };
}

async function finishRecording(dir, id, name) {
  id = path.basename(id);
  const rec = await readJson(recPath(dir, id), null);
  if (!rec) { const e = new Error('No such recording'); e.code = 404; throw e; }
  activeRecordings.delete(`${dir}::${id}`);
  if (rec.mediaId) return readJson(metaPath(dir, rec.mediaId), null); // already finished
  const raw = path.join(dir, 'recordings', id + rec.ext);
  const mediaId = newId();
  const label = safeName(name || `Recording ${localStamp(rec.startedAt)}`);
  const fileName = `${mediaId}-${label}${rec.ext}`;
  const mediaFile = path.join(dir, 'media', fileName);
  await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'cache', mediaId), { recursive: true });
  // A streamed recording has no duration or seek index; a stream copy writes both.
  try { await run(FFMPEG, ['-hide_banner', '-y', '-i', raw, '-c', 'copy', mediaFile]); }
  catch { await fsp.copyFile(raw, mediaFile); }
  const meta = { id: mediaId, name: label + rec.ext, file: fileName, status: 'queued', progress: 0, importedAt: new Date().toISOString(), recording: id, ...(rec.mirror ? { mirror: true } : {}) };
  try { Object.assign(meta, await probe(mediaFile)); } catch {}
  meta.size = (await fsp.stat(mediaFile)).size;
  await writeJsonAtomic(metaPath(dir, mediaId), meta);
  rec.status = 'finished'; rec.mediaId = mediaId; rec.finishedAt = new Date().toISOString();
  await writeJsonAtomic(recPath(dir, id), rec);
  enqueue(dir, mediaId);
  return meta;
}

// A take whose page went away (crash, closed tab, server restart) is turned into
// media so it shows up in the bin instead of sitting unseen in recordings/.
async function recoverRecordings(dir) {
  let files = [];
  try { files = (await fsp.readdir(path.join(dir, 'recordings'))).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const rec = await readJson(path.join(dir, 'recordings', f), null);
    if (!rec || rec.status !== 'recording') continue;
    const last = activeRecordings.get(`${dir}::${rec.id}`);
    if (last && Date.now() - last < RECORDING_IDLE_MS) continue;
    const st = await fsp.stat(path.join(dir, 'recordings', rec.id + rec.ext)).catch(() => null);
    if (!st || st.size === 0) { rec.status = 'empty'; await writeJsonAtomic(path.join(dir, 'recordings', f), rec); continue; }
    try { await finishRecording(dir, rec.id, `Recovered recording ${localStamp(rec.startedAt)}`); }
    catch (e) { console.error('[recordings] recover', rec.id, e.message); }
  }
}

function enqueue(dir, id) {
  const key = `${dir}::${id}`;
  if (processing === key || queue.some((q) => q.key === key)) return;
  queue.push({ key, dir, id }); pump();
}
async function pump() {
  if (processing || !queue.length) return;
  const job = queue.shift(); processing = job.key;
  try { await processMedia(job.dir, job.id); }
  catch (e) {
    const m = await readJson(metaPath(job.dir, job.id), {});
    m.status = 'error'; m.error = e.message;
    await writeJsonAtomic(metaPath(job.dir, job.id), m).catch(() => {});
    console.error('[media]', job.id, e.message);
  } finally { processing = null; pump(); }
}

async function probe(file) {
  let out = '';
  await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { onStdout: (d) => (out += d) });
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0;
  const info = { duration, hasVideo: !!v, hasAudio: !!a };
  if (v) {
    let rot = 0;
    for (const sd of v.side_data_list || []) if (sd.rotation != null) rot = Number(sd.rotation);
    if (v.tags && v.tags.rotate) rot = Number(v.tags.rotate);
    const swap = Math.abs(rot) % 180 === 90;
    info.width = swap ? v.height : v.width; info.height = swap ? v.width : v.height;
    const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
    let fps = d ? n / d : n; if (!fps || !isFinite(fps) || fps > 240) fps = 30;
    info.fps = Math.round(fps * 1000) / 1000;
    info.vcodec = v.codec_name;
  }
  if (a) { info.acodec = a.codec_name; info.channels = a.channels; info.sampleRate = Number(a.sample_rate); }
  return info;
}

// Long-side-bounded scale expression that keeps both dimensions even.
const fitScale = (max) => `scale=w='if(gte(iw,ih),trunc(min(${max},iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(${max},ih)/2)*2)'`;

async function processMedia(dir, id) {
  const mp = metaPath(dir, id);
  const meta = await readJson(mp, null);
  if (!meta) return;
  const src = path.join(dir, 'media', meta.file);
  const cacheDir = path.join(dir, 'cache', id);
  const save = () => writeJsonAtomic(mp, meta);
  meta.status = 'processing'; meta.progress = 0; delete meta.error; await save();

  Object.assign(meta, await probe(src));
  if (!meta.hasVideo && !meta.hasAudio) throw new Error('No video or audio stream found in this file.');
  meta.kind = meta.hasVideo ? 'video' : 'audio';
  await save();

  let lastWrite = 0;
  const onProgress = (p) => {
    meta.progress = p * (meta.hasAudio ? 0.85 : 1);
    if (Date.now() - lastWrite > 400) { lastWrite = Date.now(); save().catch(() => {}); }
  };

  if (meta.hasVideo) {
    // Scrub cache: every frame (up to 30fps) for short clips, sparser for long ones.
    const d = meta.duration;
    meta.scrubFps = d <= 240 ? Math.min(30, Math.round(meta.fps)) : d <= 900 ? 15 : 8;
    const framesDir = path.join(cacheDir, 'frames');
    await fsp.rm(framesDir, { recursive: true, force: true });
    await fsp.mkdir(framesDir, { recursive: true });
    const args = ['-hide_banner', '-y', '-i', src,
      '-filter_complex', `[0:v]${meta.mirror ? 'hflip,' : ''}split=2[a][b];[a]${fitScale(1280)},format=yuv420p[p];[b]fps=${meta.scrubFps},${fitScale(360)}[f]`,
      // Proxy: short GOP so the browser can land on any frame quickly.
      '-map', '[p]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-g', '6', '-keyint_min', '6', '-sc_threshold', '0', '-an', '-movflags', '+faststart', path.join(cacheDir, 'proxy.mp4'),
      '-map', '[f]', '-q:v', '5', path.join(framesDir, '%06d.jpg')];
    if (meta.hasAudio) args.push('-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000', path.join(cacheDir, 'audio.m4a'));
    args.push('-progress', 'pipe:1', '-nostats');
    await run(FFMPEG, args, { onStdout: progressParser(meta.duration, onProgress) });
    meta.frameCount = (await fsp.readdir(framesDir)).filter((f) => f.endsWith('.jpg')).length;
  } else {
    await run(FFMPEG, ['-hide_banner', '-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000',
      path.join(cacheDir, 'audio.m4a'), '-progress', 'pipe:1', '-nostats'], { onStdout: progressParser(meta.duration, onProgress) });
  }

  if (meta.hasAudio) {
    // Waveform peaks, 100 per second, 0–255.
    const RATE = 8000, PER = 80; const peaks = []; let cur = 0, n = 0, carry = null;
    await run(FFMPEG, ['-hide_banner', '-i', src, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], {
      onStdout: (d) => {
        if (carry) { d = Buffer.concat([carry, d]); carry = null; }
        const len = d.length - (d.length % 2);
        if (len < d.length) carry = d.subarray(len);
        for (let i = 0; i < len; i += 2) {
          const v = Math.abs(d.readInt16LE(i)); if (v > cur) cur = v;
          if (++n === PER) { peaks.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255))); cur = 0; n = 0; }
        }
      },
    });
    if (n) peaks.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255)));
    await writeJsonAtomic(path.join(cacheDir, 'peaks.json'), { rate: RATE / PER, peaks });
  }

  meta.status = 'ready'; meta.progress = 1; await save();
}

// ---------------------------------------------------------------- export

// Hardware encoders take a bitrate; scale it with pixels per second.
const kbps = (W, H, fps, bpp) => Math.round((W * H * fps * bpp) / 1000) + 'k';
const PRESETS = {
  'h264-high': { label: 'H.264 · High quality', ext: '.mp4', v: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high'], a: ['-c:a', 'aac', '-b:a', '320k'] },
  'h264-standard': { label: 'H.264 · Standard', ext: '.mp4', v: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '192k'] },
  'h264-small': { label: 'H.264 · Small file', ext: '.mp4', v: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '128k'] },
  'h264-fast': { label: 'H.264 · Fast (hardware)', ext: '.mp4', v: (W, H, fps) => ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', kbps(W, H, fps, 0.12), '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '192k'] },
  'hevc': { label: 'HEVC / H.265 · Efficient', ext: '.mp4', v: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'], a: ['-c:a', 'aac', '-b:a', '192k'] },
  'hevc-fast': { label: 'HEVC / H.265 · Fast (hardware)', ext: '.mp4', v: (W, H, fps) => ['-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-b:v', kbps(W, H, fps, 0.07), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac', '-b:a', '192k'] },
  'prores-422': { label: 'ProRes 422 · Editing master', ext: '.mov', v: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'], a: ['-c:a', 'pcm_s16le'] },
  'prores-hq': { label: 'ProRes 422 HQ · Archival master', ext: '.mov', v: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'], a: ['-c:a', 'pcm_s24le'] },
  'audio-aac': { label: 'Audio only · AAC (.m4a)', ext: '.m4a', audioOnly: true, a: ['-c:a', 'aac', '-b:a', '256k'] },
  'audio-wav': { label: 'Audio only · WAV', ext: '.wav', audioOnly: true, a: ['-c:a', 'pcm_s16le'] },
};

const jobs = new Map();
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function buildExport(dir, project, opts) {
  const preset = PRESETS[opts.preset]; if (!preset) throw new Error('Unknown preset');
  const media = Object.fromEntries((await listMedia(dir)).map((m) => [m.id, m]));
  const tracks = project.tracks || [];
  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const clips = (project.clips || []).filter((c) => media[c.mediaId] && media[c.mediaId].status === 'ready' && c.out > c.in);
  const total = clips.reduce((m, c) => Math.max(m, c.start + (c.out - c.in)), 0);
  if (total <= 0) throw new Error('The timeline is empty.');

  const s = project.settings || {};
  let W = s.width || 1920, H = s.height || 1080;
  if (opts.resolution && opts.resolution !== 'project') {
    const short = Number(opts.resolution);
    if (W >= H) { W = even(short * W / H); H = even(short); } else { H = even(short * H / W); W = even(short); }
  }
  W = even(W); H = even(H);
  const fps = Number(opts.fps) || s.fps || 30;

  // Video: lower video tracks are lower layers. tracks[] is ordered top to bottom.
  const vTracks = tracks.filter((t) => t.kind === 'video' && !t.hidden).reverse();
  const vClips = [];
  for (const t of vTracks) vClips.push(...clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start));
  const aClips = clips.filter((c) => trackById[c.trackId] && trackById[c.trackId].kind === 'audio' && !trackById[c.trackId].muted && media[c.mediaId].hasAudio && (c.volume ?? 1) > 0);

  const args = ['-hide_banner', '-y']; const graph = []; let idx = 0;
  const addInput = (c) => { args.push('-ss', c.in.toFixed(4), '-t', (c.out - c.in).toFixed(4), '-i', path.join(dir, 'media', media[c.mediaId].file)); return idx++; };
  const t = (n) => n.toFixed(4);

  let vOut = null;
  if (!preset.audioOnly) {
    const base = idx++; args.push('-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${t(total)}`);
    graph.push(`[${base}:v]format=yuv420p,setsar=1[vb]`);
    let prev = 'vb';
    vClips.forEach((c, k) => {
      const i = addInput(c); const end = c.start + (c.out - c.in);
      graph.push(`[${i}:v]${media[c.mediaId].mirror ? 'hflip,' : ''}fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${t(c.start)}/TB[v${k}]`);
      graph.push(`[${prev}][v${k}]overlay=eof_action=pass:enable='between(t,${t(c.start)},${t(end)})'[o${k}]`);
      prev = `o${k}`;
    });
    vOut = prev;
  }
  const sil = idx++; args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  graph.push(`[${sil}:a]atrim=0:${t(total)}[asil]`);
  const mixIn = ['[asil]'];
  aClips.forEach((c, k) => {
    const i = addInput(c); const ms = Math.round(c.start * 1000);
    graph.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${(c.volume ?? 1).toFixed(3)},adelay=${ms}:all=1[a${k}]`);
    mixIn.push(`[a${k}]`);
  });
  graph.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=first:dropout_transition=0[aout]`);

  args.push('-filter_complex', graph.join(';'));
  if (vOut) args.push('-map', `[${vOut}]`, ...(typeof preset.v === 'function' ? preset.v(W, H, fps) : preset.v), '-r', String(fps));
  args.push('-map', '[aout]', ...preset.a, '-t', t(total));
  if (preset.ext === '.mp4' || preset.ext === '.m4a') args.push('-movflags', '+faststart');
  return { args, total, preset, W, H, fps };
}

async function startExport(dir, slug, opts) {
  const project = await readJson(path.join(dir, 'project.json'), null);
  if (!project) throw new Error('Project not found');
  const { args, total, preset, W, H, fps } = await buildExport(dir, project, opts);
  const exportsDir = path.join(dir, 'exports'); await fsp.mkdir(exportsDir, { recursive: true });
  const base = safeName(opts.name || `${project.name} ${stamp().slice(0, 19)}`);
  const finalPath = await uniquePath(exportsDir, base, preset.ext);
  const partial = finalPath.slice(0, -preset.ext.length) + '.partial' + preset.ext;
  const id = newId();
  const job = { id, slug, status: 'running', progress: 0, file: path.basename(finalPath), path: finalPath, preset: preset.label, width: W, height: H, fps, duration: total, startedAt: Date.now() };
  jobs.set(id, job);
  const child = spawn(FFMPEG, [...args, partial, '-progress', 'pipe:1', '-nostats'], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child; let err = '';
  child.stdout.on('data', progressParser(total, (p) => (job.progress = p)));
  child.stderr.on('data', (d) => { err += d; if (err.length > 40000) err = err.slice(-20000); });
  child.on('close', async (code) => {
    delete job.child;
    if (code === 0) {
      await fsp.rename(partial, finalPath);
      job.size = (await fsp.stat(finalPath)).size; job.status = 'done'; job.progress = 1;
    } else {
      await fsp.rm(partial, { force: true });
      job.status = job.status === 'cancelled' ? 'cancelled' : 'error';
      job.error = err.trim().split('\n').slice(-5).join('\n');
    }
    job.finishedAt = Date.now();
  });
  return publicJob(job);
}
const publicJob = (j) => { const { child, ...rest } = j; return rest; };

// ---------------------------------------------------------------- static + range

async function serveFile(req, res, file, { noCache } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return fail(res, 404, 'Not found'); }
  if (!st.isFile()) return fail(res, 404, 'Not found');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': noCache ? 'no-cache' : 'private, max-age=31536000, immutable' };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- router

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const m = req.method;

    if (parts[0] === 'api') {
      // App-wide settings (chosen microphone and camera), kept on disk next to the projects.
      if (parts[1] === 'settings' && m === 'GET') return sendJson(res, 200, await readJson(SETTINGS_FILE, {}));
      if (parts[1] === 'settings' && m === 'PUT') {
        const next = { ...(await readJson(SETTINGS_FILE, {})), ...JSON.parse(await readBody(req) || '{}') };
        await writeJsonAtomic(SETTINGS_FILE, next); return sendJson(res, 200, next);
      }
      if (parts[1] === 'info' && m === 'GET') return sendJson(res, 200, { projectsDir: PROJECTS_DIR, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, ext: v.ext, audioOnly: !!v.audioOnly }])) });
      if (parts[1] === 'projects' && parts.length === 2) {
        if (m === 'GET') return sendJson(res, 200, await listProjects());
        if (m === 'POST') { const { name } = JSON.parse(await readBody(req) || '{}'); return sendJson(res, 200, { slug: await createProject(name) }); }
      }
      if (parts[1] === 'jobs' && parts[2]) {
        const job = jobs.get(parts[2]); if (!job) return fail(res, 404, 'No such job');
        if (parts[3] === 'cancel' && m === 'POST') { if (job.child) { job.status = 'cancelled'; job.child.kill('SIGTERM'); } return sendJson(res, 200, publicJob(job)); }
        return sendJson(res, 200, publicJob(job));
      }
      if (parts[1] === 'projects' && parts[2]) {
        const dir = projectDir(parts[2]);
        if (!dir || !(await exists(path.join(dir, 'project.json')))) return fail(res, 404, 'Project not found');
        const sub = parts[3];
        if (!sub) {
          if (m === 'GET') return sendJson(res, 200, { project: await readJson(path.join(dir, 'project.json')), media: await listMedia(dir), dir });
          if (m === 'PUT') {
            const body = JSON.parse(await readBody(req));
            try { return sendJson(res, 200, { ok: true, rev: (await saveProject(dir, body, { forceSnapshot: url.searchParams.get('snapshot') === '1' })).rev, savedAt: new Date().toISOString() }); }
            catch (e) { return fail(res, e.code === 409 ? 409 : 500, e.message); }
          }
        }
        if (sub === 'media' && m === 'GET') return sendJson(res, 200, await listMedia(dir));
        if (sub === 'media' && m === 'PUT') return handleUpload(req, res, dir, url.searchParams.get('name') || 'clip');
        if (sub === 'recordings' && m === 'POST') {
          try {
            if (!parts[4]) return sendJson(res, 200, await startRecording(dir, JSON.parse(await readBody(req) || '{}')));
            if (parts[5] === 'chunk') return sendJson(res, 200, await appendRecordingChunk(req, dir, parts[4]));
            if (parts[5] === 'finish') { const { name } = JSON.parse(await readBody(req) || '{}'); return sendJson(res, 200, await finishRecording(dir, parts[4], name)); }
          } catch (e) { return fail(res, e.code === 404 ? 404 : 500, e.message); }
        }
        if (sub === 'media' && parts[4] && parts[5] === 'retry' && m === 'POST') { enqueue(dir, parts[4]); return sendJson(res, 200, { ok: true }); }
        if (sub === 'history' && m === 'GET') {
          if (parts[4]) { const f = path.join(dir, 'history', path.basename(parts[4])); return sendJson(res, 200, await readJson(f, null)); }
          const files = (await fsp.readdir(path.join(dir, 'history')).catch(() => [])).filter((f) => f.endsWith('.json')).sort().reverse();
          return sendJson(res, 200, files);
        }
        if (sub === 'snapshot' && m === 'POST') { await snapshot(dir, await readJson(path.join(dir, 'project.json')), parts[4] ? safeName(parts[4]) : 'manual'); return sendJson(res, 200, { ok: true }); }
        if (sub === 'export' && m === 'POST') {
          try { return sendJson(res, 200, await startExport(dir, parts[2], JSON.parse(await readBody(req)))); }
          catch (e) { return fail(res, 400, e.message); }
        }
        if (sub === 'exports' && m === 'GET') {
          const files = (await fsp.readdir(path.join(dir, 'exports')).catch(() => [])).filter((f) => !f.startsWith('.') && !f.includes('.partial.'));
          const out = [];
          for (const f of files) { const st = await fsp.stat(path.join(dir, 'exports', f)); out.push({ file: f, size: st.size, mtime: st.mtimeMs }); }
          const running = [...jobs.values()].filter((j) => j.slug === parts[2] && j.status === 'running').map(publicJob);
          return sendJson(res, 200, { files: out.sort((a, b) => b.mtime - a.mtime), running });
        }
        if (sub === 'reveal' && m === 'POST') {
          const { file } = JSON.parse(await readBody(req) || '{}');
          const target = file ? path.join(dir, path.normalize(file)) : dir;
          if (!target.startsWith(dir)) return fail(res, 400, 'Bad path');
          spawn('open', file ? ['-R', target] : [target], { stdio: 'ignore', detached: true }).unref();
          return sendJson(res, 200, { ok: true });
        }
      }
      return fail(res, 404, 'Unknown endpoint');
    }

    if (parts[0] === 'files' && parts[1]) {
      const dir = projectDir(parts[1]); if (!dir) return fail(res, 404, 'Not found');
      const file = path.join(dir, ...parts.slice(2));
      if (!file.startsWith(dir + path.sep)) return fail(res, 400, 'Bad path');
      const mutable = parts[2] !== 'cache' || /\.json$/.test(file);
      return serveFile(req, res, file, { noCache: mutable });
    }
    return nextHandle(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, e.message);
  }
});

server.requestTimeout = 0; // large uploads
server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is already in use — Cutroom is probably already running at http://localhost:${PORT}`);
  console.error(`If not, find what holds it with: lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
  process.exit(1);
});
// Next's request handler attaches its own websocket (hot reload) handler to this
// server on the first request, so no 'upgrade' listener is added here.
nextApp.prepare().then(() => {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Cutroom running at http://localhost:${PORT}${DEV ? ' (Next.js dev mode)' : ''}`);
    console.log(`Projects folder: ${PROJECTS_DIR}`);
  });
});
