// Microphone and camera input, shared by the Inputs dialog and the recorder.
// The chosen devices are stored by the server (projects/.cutroom-settings.json),
// not in the browser.

export async function loadInputSettings() {
  try { return await (await fetch('/api/settings', { cache: 'no-store' })).json(); } catch { return {}; }
}

export async function saveInputSettings(patch) {
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}

// A stream from the microphone (and camera) chosen in the Inputs dialog.
// Returns { stream, settings, fellBack }: if a chosen device is gone (unplugged),
// the system default is used instead and its kind is listed in `fellBack`, so
// the caller can say so rather than silently recording from something else.
export async function getInputStream({ audio = true, video = false } = {}) {
  const settings = await loadInputSettings();
  const build = (useChosen) => {
    const c = {};
    if (audio) c.audio = useChosen.audio && settings.audioInputId ? { deviceId: { exact: settings.audioInputId } } : true;
    if (video) {
      c.video = {
        ...(useChosen.video && settings.videoInputId ? { deviceId: { exact: settings.videoInputId } } : {}),
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
      };
    }
    return c;
  };
  const gone = (e) => e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError');
  const attempts = [{ audio: true, video: true }, { audio: false, video: true }, { audio: true, video: false }, { audio: false, video: false }];
  let last;
  for (const use of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(build(use));
      const fellBack = [];
      if (audio && settings.audioInputId && !use.audio) fellBack.push('microphone');
      if (video && settings.videoInputId && !use.video) fellBack.push('camera');
      return { stream, settings, fellBack };
    } catch (e) { last = e; if (!gone(e)) throw e; }
  }
  throw last;
}

export async function listInputDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  // Chrome appends the USB ids, e.g. "W1 (32e6:9228)"; they only add noise.
  const name = (d, i, kind) => (d.label || `${kind} ${i + 1}`).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  return {
    mics: all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ value: d.deviceId, label: name(d, i, 'Microphone') })),
    cams: all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ value: d.deviceId, label: name(d, i, 'Camera') })),
  };
}

// Calls onLevel(peak 0..1) as audio arrives on `track`. Reads the samples
// directly where the browser allows it, so the meter works even when there is
// no audio output device. Returns a function that stops watching.
export function watchLevel(track, onLevel) {
  if (typeof window.MediaStreamTrackProcessor === 'function') {
    const clone = track.clone(); let stopped = false;
    const reader = new window.MediaStreamTrackProcessor({ track: clone }).readable.getReader();
    (async () => {
      while (!stopped) {
        let r; try { r = await reader.read(); } catch { break; }
        if (r.done) break;
        const frame = r.value; const buf = new Float32Array(frame.numberOfFrames);
        try { frame.copyTo(buf, { planeIndex: 0, format: 'f32-planar' }); } catch { try { frame.copyTo(buf, { planeIndex: 0 }); } catch {} }
        frame.close();
        let peak = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
        onLevel(peak);
      }
    })();
    return () => { stopped = true; reader.cancel().catch(() => {}); clone.stop(); };
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const buf = new Float32Array(analyser.fftSize); let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
    onLevel(peak); raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); ctx.close(); };
}
