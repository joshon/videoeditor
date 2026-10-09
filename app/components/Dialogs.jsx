import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Surface, Text, TextField } from '@ds/components';

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
