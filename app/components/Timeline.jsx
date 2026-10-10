import { Button, Toggle } from '@ds/components';

// Track headers are built by the engine; clips, ruler and playhead are drawn on #tlCanvas.
export default function Timeline() {
  return (
    <section className="timeline-panel" id="timelinePanel" tabIndex={0}>
      <div className="timeline-toolbar">
        <Button variant="subtle" id="undoBtn" title="Undo (⌘Z)">Undo</Button>
        <Button variant="subtle" id="redoBtn" title="Redo (⇧⌘Z)">Redo</Button>
        <span className="sep"></span>
        <Button variant="subtle" id="splitBtn" title="Split clips at playhead (S)">Split</Button>
        <Button variant="subtle" id="deleteBtn" title="Delete selected (⌫) · ⇧⌫ ripple delete">Delete</Button>
        <span className="sep"></span>
        <Toggle id="snapBtn" label="Snap" defaultChecked title="Snapping (N)" />
        <Toggle id="linkBtn" label="Link" defaultChecked title="Linked selection — move video and its audio together" />
        <span className="sep"></span>
        <Button variant="subtle" id="addVBtn">+ Video track</Button>
        <Button variant="subtle" id="addABtn">+ Audio track</Button>
        <div className="spacer"></div>
        <span className="text-ui-small hint" id="tlHint">Drag media here · drag edges to trim · ⌥-drag to unlink · scroll to zoom</span>
        <Button variant="subtle" id="fitBtn" title="Zoom to fit (\)">Fit</Button>
        <input type="range" id="zoomSlider" min="0" max="1000" defaultValue="400" title="Zoom (− / =)" />
      </div>
      <div className="timeline-body">
        <div className="track-heads" id="trackHeads"></div>
        <div className="timeline-canvas-wrap" id="tlWrap"><canvas id="tlCanvas"></canvas></div>
      </div>
      <div className="timeline-scroll-row">
        <div className="timeline-scroll-gap"></div>
        <div className="timeline-scroll" id="tlScroll" title="Drag to move along the timeline; click to jump"><div className="timeline-thumb" id="tlThumb"></div></div>
      </div>
    </section>
  );
}
