import { Button, Icon, Text } from '@ds/components';

export default function ProgramViewer() {
  return (
    <section className="pane viewer" id="programPanel" tabIndex={0}>
      <div className="pane-head">
        <Text variant="eyebrow-small" as="span">Program</Text>
        <span className="viewer-title text-ui-small" id="seqInfo"></span>
        <div className="spacer"></div>
        <span className="tc text-code-small" id="programDur"></span>
      </div>
      <div className="screen"><canvas id="programCanvas"></canvas></div>
      <div className="transport">
        <span className="tc text-code-medium" id="programTc">00:00:00:00</span>
        <div className="spacer"></div>
        <Button variant="subtle" iconOnly id="pgStart" title="Go to start (Home)" leftIcon={<Icon name="skip_previous" size="lg" />} />
        <Button variant="subtle" iconOnly id="pgPrev" title="Back one frame (←)" leftIcon={<Icon name="navigate_before" size="lg" />} />
        <Button variant="subtle" iconOnly id="pgPlay" title="Play / pause (Space) · J K L shuttle" leftIcon={<Icon name="play_arrow" size="lg" />} />
        <Button variant="subtle" iconOnly id="pgNext" title="Forward one frame (→)" leftIcon={<Icon name="navigate_next" size="lg" />} />
        <Button variant="subtle" iconOnly id="pgEnd" title="Go to end (End)" leftIcon={<Icon name="skip_next" size="lg" />} />
        <div className="spacer"></div>
        <span className="text-ui-small rate" id="rateLabel"></span>
      </div>
    </section>
  );
}
