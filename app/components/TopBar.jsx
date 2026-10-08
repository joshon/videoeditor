export default function TopBar() {
  return (
    <header className="topbar">
      <div className="brand text-labels-large">Cutroom</div>
      <button className="btn btn-subtle" id="projectBtn" title="Switch project"><span id="projectName" className="text-ui-medium">—</span></button>
      <div className="save-state text-ui-small" id="saveState" data-state="idle"><span className="dot"></span><span id="saveText">Not loaded</span></div>
      <div className="spacer"></div>
      <button className="btn btn-subtle" id="settingsBtn" title="Sequence settings">Sequence</button>
      <button className="btn btn-subtle" id="historyBtn" title="Restore an earlier version">Versions</button>
      <button className="btn btn-subtle" id="revealBtn" title="Open the project folder in Finder">Project folder</button>
      <button className="btn btn-primary" id="exportBtn">Export</button>
    </header>
  );
}
