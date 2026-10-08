// Modal dialogs. The engine opens them with showModal() and fills their lists.

export function ProjectDialog() {
  return (
    <dialog className="modal" id="projectDialog">
      <form method="dialog" className="modal-body">
        <h2 className="text-headers-h5">Projects</h2>
        <p className="text-body-small muted">Saved in <code className="text-code-small" id="projectsDir"></code></p>
        <div className="project-list" id="projectList"></div>
        <div className="row">
          <input className="input" id="newProjectName" placeholder="New project name" autoComplete="off" />
          <button className="btn btn-primary" id="createProjectBtn" value="create">Create</button>
        </div>
      </form>
    </dialog>
  );
}

export function ExportDialog() {
  return (
    <dialog className="modal" id="exportDialog">
      <form method="dialog" className="modal-body" id="exportForm">
        <h2 className="text-headers-h5">Export</h2>
        <label className="field text-labels-medium">Format &amp; compression<select className="input" id="exPreset"></select></label>
        <div className="row">
          <label className="field text-labels-medium">Resolution
            <select className="input" id="exRes">
              <option value="project">Sequence size</option>
              <option value="2160">2160p (4K)</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
            </select>
          </label>
          <label className="field text-labels-medium">Frame rate
            <select className="input" id="exFps">
              <option value="">Sequence</option>
              <option>23.976</option><option>24</option><option>25</option><option>29.97</option>
              <option>30</option><option>50</option><option>60</option>
            </select>
          </label>
        </div>
        <label className="field text-labels-medium">File name<input className="input" id="exName" autoComplete="off" /></label>
        <p className="text-body-small muted" id="exSummary"></p>
        <div className="progress" id="exProgressWrap" hidden><div className="bar" id="exBar"></div></div>
        <p className="text-body-small" id="exStatus"></p>
        <div className="row end">
          <button className="btn btn-subtle" value="close">Close</button>
          <button className="btn btn-outline" id="exCancel" type="button" hidden>Cancel export</button>
          <button className="btn btn-primary" id="exStart" type="button">Export</button>
        </div>
        <h3 className="text-eyebrow-small">Previous exports</h3>
        <div className="export-list" id="exportList"></div>
      </form>
    </dialog>
  );
}

export function HistoryDialog() {
  return (
    <dialog className="modal" id="historyDialog">
      <form method="dialog" className="modal-body">
        <h2 className="text-headers-h5">Versions</h2>
        <p className="text-body-small muted">A snapshot is written every 30 seconds while you edit, and whenever you press ⌘S. Restoring is undoable and keeps every version.</p>
        <div className="history-list" id="historyList"></div>
        <div className="row end"><button className="btn btn-subtle" value="close">Close</button></div>
      </form>
    </dialog>
  );
}

export function SettingsDialog() {
  return (
    <dialog className="modal" id="settingsDialog">
      <form method="dialog" className="modal-body">
        <h2 className="text-headers-h5">Sequence settings</h2>
        <p className="text-body-small muted">Set automatically from the first video you add. Change it any time; nothing in your edit is lost.</p>
        <div className="row">
          <label className="field text-labels-medium">Width<input className="input" id="setW" type="number" min="16" step="2" /></label>
          <label className="field text-labels-medium">Height<input className="input" id="setH" type="number" min="16" step="2" /></label>
          <label className="field text-labels-medium">FPS<input className="input" id="setFps" type="number" min="1" step="0.001" /></label>
        </div>
        <div className="row end">
          <button className="btn btn-subtle" value="close">Cancel</button>
          <button className="btn btn-primary" value="save" id="setSave">Apply</button>
        </div>
      </form>
    </dialog>
  );
}
