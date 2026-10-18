'use client';

import { useEffect } from 'react';
import TopBar from './components/TopBar';
import PresenceBanner from './components/PresenceBanner';
import MediaBin from './components/MediaBin';
import Inspector from './components/Inspector';
import SourceViewer from './components/SourceViewer';
import ProgramViewer from './components/ProgramViewer';
import Timeline from './components/Timeline';
import { ProjectDialog, ExportDialog, HistoryDialog, SettingsDialog, InputsDialog } from './components/Dialogs';
import { TimelinesDialog } from './components/Timelines';

// The components render the editor's static structure once; the engine
// (editor/engine.js) then drives it imperatively — canvases, scrubbing,
// playback, autosave. Nothing the engine touches re-renders after mount, so its
// DOM updates are never overwritten by React. (The Inputs dialog is the
// exception: it is self-contained React state and the engine never touches it.)
export default function Editor() {
  useEffect(() => {
    import('./editor/engine').then((m) => m.startEditor());
  }, []);

  return (
    <div className="app">
      <TopBar />
      <PresenceBanner />
      <main className="workspace">
        <MediaBin />
        <Inspector />
        <SourceViewer />
        <ProgramViewer />
      </main>
      <Timeline />
      <div className="drop-overlay text-headers-h4" id="dropOverlay">Drop to import into this project</div>
      <ProjectDialog />
      <ExportDialog />
      <HistoryDialog />
      <SettingsDialog />
      <InputsDialog />
      <TimelinesDialog />
      <div className="toast text-ui-small" id="toast"></div>
    </div>
  );
}
