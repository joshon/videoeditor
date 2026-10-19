import { Button, Icon, Toggle } from '@ds/components';
import { TimelineSwitcher } from './Timelines';

// Track headers are built by the engine; clips, ruler and playhead are drawn on #tlCanvas.
export default function Timeline() {
  return (
    <section className="timeline-panel" id="timelinePanel" tabIndex={0}>
      <div className="timeline-resize" id="tlResize" title="Drag to make the timeline taller or shorter · double-click to reset"></div>
      <div className="timeline-toolbar">
        <TimelineSwitcher />
        <span className="sep"></span>
        <Button variant="subtle" id="undoBtn" title="Undo (⌘Z)">Undo</Button>
        <Button variant="subtle" id="redoBtn" title="Redo (⇧⌘Z)">Redo</Button>
        <span className="sep"></span>
        <Button variant="subtle" id="splitBtn" title="Split clips at playhead (S)">Split</Button>
        <Button variant="subtle" id="deleteBtn" title="Delete selected (⌫) · ⇧⌫ ripple delete">Delete</Button>
        <span className="sep"></span>
        <Toggle id="snapBtn" label="Snap" defaultChecked title="Snapping (N)" />
        <Toggle id="linkBtn" label="Link" defaultChecked title="Linked selection — move video and its audio together" />
        <span className="sep"></span>
        {/* What moving or deleting a clip does to the clips after it. The engine marks the active one. */}
        <Button variant="primary" iconOnly id="pushOffBtn" aria-pressed="true" title="Overwrite: a moved clip covers whatever is under it" leftIcon={<Icon name="layers" size="lg" />} />
        <Button variant="subtle" iconOnly id="pushTrackBtn" aria-pressed="false" title="Push track: moving or deleting a clip also moves everything after it on its track (and its linked audio/video)" leftIcon={<Icon name="keyboard_tab" size="lg" />} />
        <Button variant="subtle" iconOnly id="pushAllBtn" aria-pressed="false" title="Push all tracks: moving or deleting a clip also moves everything after it on every track" leftIcon={<Icon name="double_arrow" size="lg" />} />
        <span className="sep"></span>
        <Button variant="subtle" id="addVBtn">+ Video track</Button>
        <Button variant="subtle" id="addABtn">+ Audio track</Button>
        <Button variant="subtle" id="addTextBtn" title="Add a text card at the playhead">+ Text</Button>
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
