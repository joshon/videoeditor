import { Button, Text } from '@ds/components';

const ACCEPT = 'video/*,audio/*,.mov,.mp4,.m4v,.mkv,.avi,.mts,.mxf,.wav,.mp3,.m4a,.aac,.aif,.aiff,.flac';

// Bin items are added to #binGrid by the engine as media is imported.
export default function MediaBin() {
  return (
    <section className="pane bin" id="binPanel">
      <div className="pane-head">
        <Text variant="eyebrow-small" as="span">Media</Text>
        <div className="spacer"></div>
        <Button variant="outline" id="importBtn">Import</Button>
        <input type="file" id="fileInput" multiple accept={ACCEPT} hidden />
      </div>
      <div className="bin-grid" id="binGrid"></div>
      <Text variant="body-small" color="muted" className="bin-empty" id="binEmpty">
        Drop videos or audio here, or click <b>Import</b>.<br />Files are copied into the project folder.
      </Text>
      <Button variant="subtle" id="showHiddenBtn" hidden>Show removed items</Button>
    </section>
  );
}
