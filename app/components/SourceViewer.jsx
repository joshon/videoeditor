import { Button, Icon, Text } from '@ds/components';

export default function SourceViewer() {
  return (
    <section className="pane viewer" id="sourcePanel" tabIndex={0}>
      <div className="pane-head">
        <Text variant="eyebrow-small" as="span">Source</Text>
        <span className="viewer-title text-ui-small" id="sourceTitle">No clip</span>
        <div className="spacer"></div>
        <span className="tc text-code-small" id="sourceDur"></span>
      </div>
      <div className="screen">
        <canvas id="sourceCanvas"></canvas>
        <div className="screen-msg text-ui-small" id="sourceMsg">Click a clip in Media or on the timeline</div>
      </div>
      <canvas className="scrubbar" id="sourceScrub"></canvas>
      <div className="transport">
        <span className="tc text-code-medium" id="sourceTc">00:00:00:00</span>
        <div className="spacer"></div>
        <Button variant="subtle" id="srcIn" title="Mark in (I)">In</Button>
        <Button variant="subtle" iconOnly id="srcPrev" title="Back one frame (←)" leftIcon={<Icon name="navigate_before" size="lg" />} />
        <Button variant="subtle" iconOnly id="srcPlay" title="Play / pause (Space)" leftIcon={<Icon name="play_arrow" size="lg" />} />
        <Button variant="subtle" iconOnly id="srcNext" title="Forward one frame (→)" leftIcon={<Icon name="navigate_next" size="lg" />} />
        <Button variant="subtle" id="srcOut" title="Mark out (O)">Out</Button>
        <div className="spacer"></div>
        <label className="vol text-ui-small" id="clipVolWrap" hidden>
          Gain <input type="range" id="clipVol" min="0" max="2" step="0.01" defaultValue="1" /><span id="clipVolVal">0 dB</span>
        </label>
        <Button variant="outline" id="srcInsert" title="Place marked range at the playhead (overwrite) — or drag the picture onto the timeline">Place at playhead</Button>
      </div>
      <div className="inout text-code-small" id="sourceInOut"></div>
    </section>
  );
}
