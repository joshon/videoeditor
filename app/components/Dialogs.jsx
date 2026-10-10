import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Surface, Text, TextField, Toggle } from '@ds/components';
import { listInputDevices, loadInputSettings, saveInputSettings, watchLevel } from '../editor/inputs';

// Modal dialogs. The engine opens them with showModal(), fills their lists and
// reads their fields by id.

function Modal({ id, children, formId }) {
  return (
    <dialog className="modal" id={id}>
      <Surface as="form" method="dialog" id={formId} variant="surface-menu" padding="large" rounded="large" className="modal-body">
        {children}
      </Surface>
    </dialog>
  );
}

// A design-system Dropdown whose value is mirrored into a hidden input with the
// id the engine reads; changing it fires 'change' on that input.
function MirroredDropdown({ id, label, options, defaultValue }) {
  const mirror = useRef(null);
  const onChange = (e) => {
    mirror.current.value = e.target.value;
    mirror.current.dispatchEvent(new Event('change'));
  };
  return (
    <>
      <Dropdown label={label} options={options} defaultValue={defaultValue} onChange={onChange} />
      <input type="hidden" id={id} ref={mirror} defaultValue={defaultValue} />
    </>
  );
}

export function ProjectDialog() {
  return (
    <Modal id="projectDialog">
      <Text variant="headers-h5">Projects</Text>
      <Text variant="body-small" color="muted">Saved in <code className="text-code-small" id="projectsDir"></code></Text>
      <div className="project-list" id="projectList"></div>
      <div className="row">
        <TextField id="newProjectName" placeholder="New project name" autoComplete="off" />
        <Button variant="primary" id="createProjectBtn" value="create">Create</Button>
      </div>
    </Modal>
  );
}

const RESOLUTIONS = [
  { value: 'project', label: 'Sequence size' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
];
const FRAME_RATES = [
  { value: '', label: 'Sequence' },
  ...['23.976', '24', '25', '29.97', '30', '50', '60'].map((v) => ({ value: v, label: v })),
];

export function ExportDialog() {
  const [presets, setPresets] = useState([]);
  useEffect(() => {
    fetch('/api/info', { cache: 'no-store' }).then((r) => r.json())
      .then((info) => setPresets(Object.entries(info.presets).map(([value, p]) => ({ value, label: p.label }))))
      .catch(() => {});
  }, []);
  return (
    <Modal id="exportDialog" formId="exportForm">
      <Text variant="headers-h5">Export</Text>
      <MirroredDropdown id="exPreset" label="Format & compression" options={presets} defaultValue="h264-standard" />
      <div className="row">
        <MirroredDropdown id="exRes" label="Resolution" options={RESOLUTIONS} defaultValue="project" />
        <MirroredDropdown id="exFps" label="Frame rate" options={FRAME_RATES} defaultValue="" />
      </div>
      <TextField id="exName" label="File name" autoComplete="off" />
      <Text variant="body-small" color="muted" id="exSummary"></Text>
      <div className="progress" id="exProgressWrap" hidden><div className="bar" id="exBar"></div></div>
      <Text variant="body-small" id="exStatus"></Text>
      <div className="row end">
        <Button variant="subtle" value="close">Close</Button>
        <Button variant="outline" id="exCancel" type="button" hidden>Cancel export</Button>
        <Button variant="primary" id="exStart" type="button">Export</Button>
      </div>
      <Text variant="eyebrow-small">Previous exports</Text>
      <div className="export-list" id="exportList"></div>
    </Modal>
  );
}

export function HistoryDialog() {
  return (
    <Modal id="historyDialog">
      <Text variant="headers-h5">Versions</Text>
      <Text variant="body-small" color="muted">A snapshot is written every 30 seconds while you edit, and whenever you press ⌘S. Restoring is undoable and keeps every version.</Text>
      <div className="history-list" id="historyList"></div>
      <div className="row end"><Button variant="subtle" value="close">Close</Button></div>
    </Modal>
  );
}

export function SettingsDialog() {
  return (
    <Modal id="settingsDialog">
      <Text variant="headers-h5">Sequence settings</Text>
      <Text variant="body-small" color="muted">Set automatically from the first video you add. Change it any time; nothing in your edit is lost.</Text>
      <div className="row">
        <TextField id="setW" label="Width" type="number" min="16" step="2" />
        <TextField id="setH" label="Height" type="number" min="16" step="2" />
        <TextField id="setFps" label="FPS" type="number" min="1" step="0.001" />
      </div>
      <div className="row end">
        <Button variant="subtle" value="close">Cancel</Button>
        <Button variant="primary" value="save" id="setSave">Apply</Button>
      </div>
    </Modal>
  );
}

// Choose and test the microphone and camera used for recording. Opened from the
// top bar's Inputs button (a 'cutroom:open-inputs' event). The devices it holds
// open are released when it closes.
const SILENCE = 1e-4; // a level that never rises above this is digital silence

export function InputsDialog() {
  const dlg = useRef(null);
  const preview = useRef(null);
  const streams = useRef({ audio: null, video: null });
  const stopMeter = useRef(null);
  const loudest = useRef(0);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState({ mics: [], cams: [] });
  const [mic, setMic] = useState('');
  const [cam, setCam] = useState('');
  const [mirror, setMirror] = useState(false);
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const [error, setError] = useState('');

  const release = (kind) => {
    if (kind === 'audio' && stopMeter.current) { stopMeter.current(); stopMeter.current = null; }
    streams.current[kind]?.getTracks().forEach((t) => t.stop());
    streams.current[kind] = null;
  };

  const startMic = async (deviceId) => {
    release('audio'); setLevel(0); setSilent(false); loudest.current = 0;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      streams.current.audio = s;
      let latest = 0; const stop = watchLevel(s.getAudioTracks()[0], (p) => { latest = p; if (p > loudest.current) loudest.current = p; });
      const timer = setInterval(() => setLevel(latest), 60);
      const silenceCheck = setTimeout(() => setSilent(loudest.current < SILENCE), 3000);
      stopMeter.current = () => { stop(); clearInterval(timer); clearTimeout(silenceCheck); };
      return s.getAudioTracks()[0].getSettings().deviceId;
    } catch (e) { setError(`Microphone: ${e.message || e.name}`); return ''; }
  };

  const startCam = async (deviceId) => {
    release('video');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true });
      streams.current.video = s;
      if (preview.current) { preview.current.srcObject = s; preview.current.play().catch(() => {}); }
      return s.getVideoTracks()[0].getSettings().deviceId;
    } catch (e) { setError(`Camera: ${e.message || e.name}`); return ''; }
  };

  useEffect(() => {
    const onOpen = async () => {
      setError(''); setOpen(true); dlg.current.showModal();
      if (!navigator.mediaDevices?.getUserMedia) { setError("This browser can't use a microphone or camera here."); return; }
      const saved = await loadInputSettings();
      setMirror(!!saved.mirrorVideo);
      const micId = await startMic(saved.audioInputId);
      const camId = await startCam(saved.videoInputId);
      const found = await listInputDevices(); // labels appear once access is granted
      setDevices(found);
      // Show the saved choice if that device is present, else whichever device opened.
      const pick = (list, savedId, openedId) => (list.some((d) => d.value === savedId) ? savedId : list.some((d) => d.value === openedId) ? openedId : '');
      setMic(pick(found.mics, saved.audioInputId, micId)); setCam(pick(found.cams, saved.videoInputId, camId));
    };
    const onClose = () => { release('audio'); release('video'); setOpen(false); };
    window.addEventListener('cutroom:open-inputs', onOpen);
    const d = dlg.current; d.addEventListener('close', onClose);
    return () => { window.removeEventListener('cutroom:open-inputs', onOpen); d.removeEventListener('close', onClose); };
  }, []);

  const chooseMic = (e) => { setMic(e.target.value); saveInputSettings({ audioInputId: e.target.value }); startMic(e.target.value); };
  const chooseCam = (e) => { setCam(e.target.value); saveInputSettings({ videoInputId: e.target.value }); startCam(e.target.value); };

  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  return (
    <dialog className="modal" id="inputsDialog" ref={dlg}>
      <Surface as="form" method="dialog" variant="surface-menu" padding="large" rounded="large" className="modal-body">
        <Text variant="headers-h5">Inputs</Text>
        <Text variant="body-small" color="muted">The microphone and camera used when you record onto a track. Talk to check the level. Mirroring flips camera takes recorded from now on.</Text>
        {open && (
          <>
            <Dropdown label="Microphone" options={devices.mics} value={mic} onChange={chooseMic} placeholder="Default microphone" />
            <div className="level-meter" aria-label="Microphone level"><div className="level-fill" style={{ width: `${pct}%` }} data-hot={db > -6 || undefined}></div></div>
            {silent && (
              <Text variant="body-small" className="input-warning">
                No sound is coming from this microphone, not even background noise. On a Mac that usually means the app showing this page isn't allowed to use it: System Settings › Privacy &amp; Security › Microphone, then turn it on for this app (Claude, or Chrome). Or open http://localhost:4700 in Chrome.
              </Text>
            )}
            <Dropdown label="Camera" options={devices.cams} value={cam} onChange={chooseCam} placeholder="Default camera" />
            <Toggle label="Mirror camera" checked={mirror} onChange={(e) => { setMirror(e.target.checked); saveInputSettings({ mirrorVideo: e.target.checked }); }} />
            <video className="camera-preview" data-mirrored={mirror || undefined} ref={preview} muted playsInline></video>
          </>
        )}
        {error && <Text variant="body-small" className="input-warning">{error}</Text>}
        <div className="row end"><Button variant="primary" value="close">Done</Button></div>
      </Surface>
    </dialog>
  );
}
