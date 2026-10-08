// Track headers are built by the engine; clips, ruler and playhead are drawn on #tlCanvas.
export default function Timeline() {
  return (
    <section className="timeline-panel" id="timelinePanel" tabIndex={0}>
      <div className="timeline-toolbar">
        <button className="btn btn-subtle btn-small" id="undoBtn" title="Undo (⌘Z)">Undo</button>
        <button className="btn btn-subtle btn-small" id="redoBtn" title="Redo (⇧⌘Z)">Redo</button>
        <span className="sep"></span>
        <button className="btn btn-subtle btn-small" id="splitBtn" title="Split clips at playhead (S)">Split</button>
        <button className="btn btn-subtle btn-small" id="deleteBtn" title="Delete selected (⌫) · ⇧⌫ ripple delete">Delete</button>
        <button className="btn btn-subtle btn-small toggle" id="snapBtn" aria-pressed="true" title="Snapping (N)">Snap</button>
        <button className="btn btn-subtle btn-small toggle" id="linkBtn" aria-pressed="true" title="Linked selection — move video and its audio together">Link</button>
        <span className="sep"></span>
        <button className="btn btn-subtle btn-small" id="addVBtn">+ Video track</button>
        <button className="btn btn-subtle btn-small" id="addABtn">+ Audio track</button>
        <div className="spacer"></div>
        <span className="text-ui-small hint" id="tlHint">Drag media here · drag edges to trim · ⌥-drag to unlink</span>
        <button className="btn btn-subtle btn-small" id="fitBtn" title="Zoom to fit (\)">Fit</button>
        <input type="range" id="zoomSlider" min="0" max="1000" defaultValue="400" title="Zoom (− / =)" />
      </div>
      <div className="timeline-body">
        <div className="track-heads" id="trackHeads"></div>
        <div className="timeline-canvas-wrap" id="tlWrap"><canvas id="tlCanvas"></canvas></div>
      </div>
    </section>
  );
}
