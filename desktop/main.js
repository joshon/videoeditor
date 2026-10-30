// Cutroom as a Mac app. Electron runs the same server as `npm run dev`
// (server.js, in production mode, on a free localhost port) and shows the editor
// in its own window. Projects live in ~/Movies/Cutroom on each Mac (Movies, like
// iMovie and Final Cut, needs no folder-access prompt): nothing is stored online,
// and each machine keeps its own projects.

const { app, BrowserWindow, dialog, session, shell } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// Everything the app and its server print goes to ~/Library/Logs/Cutroom/main.log
// (a Finder-launched app has no terminal), for diagnosing problems on any Mac.
const LOG = path.join(app.getPath('logs'), 'main.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`); } catch {}
    orig(...args);
  };
}
process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));
console.log('starting', app.getVersion(), 'cwd', process.cwd());
let win = null;
let server = null;
let quitting = false;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(url, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    if (Date.now() > until) throw new Error('The editor server did not start.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function startServer() {
  const port = await freePort(); console.log('port', port);
  const projects = path.join(app.getPath('videos'), 'Cutroom');
  fs.mkdirSync(projects, { recursive: true }); console.log('projects', projects);
  // The bundled, native (arm64) ffmpeg and ffprobe, so nothing needs installing.
  Object.assign(process.env, {
    NODE_ENV: 'production', PORT: String(port), VE_PROJECTS_DIR: projects,
    FFMPEG: require('ffmpeg-static'), FFPROBE: require('@ffprobe-installer/ffprobe').path,
  });
  console.log('ffmpeg', process.env.FFMPEG, 'ffprobe', process.env.FFPROBE);
  server = require(path.join(ROOT, 'server.js')); console.log('server loaded');
  const url = `http://localhost:${port}`;
  await waitFor(`${url}/api/info`);
  return url;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 700,
    title: 'Cutroom', backgroundColor: '#000000', show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(url);
  // Links to anything but the editor open in the default browser.
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });

  // Never close on unsaved work: finish a recording and save first.
  win.on('close', async (e) => {
    if (quitting) return;
    e.preventDefault();
    const running = server?.runningExports?.() || 0;
    if (running) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Keep exporting', 'Quit anyway'], defaultId: 0, cancelId: 0,
        message: 'An export is still running.', detail: 'Quitting stops it; the half-written file is removed. Everything else is saved.',
      });
      if (response === 0) return;
    }
    try {
      await Promise.race([
        win.webContents.executeJavaScript('window.__cutroomBeforeQuit ? window.__cutroomBeforeQuit() : null'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);
    } catch (err) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Stay', 'Quit without saving'], defaultId: 0, cancelId: 0,
        message: 'Cutroom could not save your latest changes.', detail: String(err && err.message || err),
      });
      if (response === 0) return;
    }
    quitting = true; app.quit();
  });
}

app.setName('Cutroom');
app.whenReady().then(async () => {
  // Camera and microphone for recording onto tracks; nothing else is granted.
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  try {
    const url = await startServer();
    createWindow(url); // macOS asks for camera/microphone access the first time you record
  } catch (err) {
    dialog.showErrorBox('Cutroom could not start', String(err && err.stack || err));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (e) => { if (!quitting && win && !win.isDestroyed()) { e.preventDefault(); win.close(); } });
