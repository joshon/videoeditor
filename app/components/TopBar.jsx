'use client';

import { Button, Text } from '@ds/components';

export default function TopBar() {
  return (
    <header className="topbar">
      <Text variant="labels-large" as="div" className="brand">Cutroom</Text>
      <Button variant="subtle" id="projectBtn" title="Switch project"><span id="projectName">—</span></Button>
      <div className="save-state text-ui-small" id="saveState" data-state="idle"><span className="dot"></span><span id="saveText">Not loaded</span></div>
      <div className="spacer"></div>
      <Button variant="subtle" id="inputsBtn" title="Choose and test the microphone and camera" onClick={() => window.dispatchEvent(new Event('cutroom:open-inputs'))}>Inputs</Button>
      <Button variant="subtle" id="settingsBtn" title="Sequence settings">Sequence</Button>
      <Button variant="subtle" id="historyBtn" title="Restore an earlier version">Versions</Button>
      <Button variant="subtle" id="revealBtn" title="Open the project folder in Finder">Project folder</Button>
      <Button variant="primary" id="exportBtn">Export</Button>
    </header>
  );
}
