const ACCEPT = 'video/*,audio/*,.mov,.mp4,.m4v,.mkv,.avi,.mts,.mxf,.wav,.mp3,.m4a,.aac,.aif,.aiff,.flac';

// Bin items are added to #binGrid by the engine as media is imported.
export default function MediaBin() {
  return (
    <section className="panel bin" id="binPanel">
      <div className="panel-head">
        <span className="text-eyebrow-small">Media</span>
        <div className="spacer"></div>
        <button className="btn btn-outline btn-small" id="importBtn">Import</button>
        <input type="file" id="fileInput" multiple accept={ACCEPT} hidden />
      </div>
      <div className="bin-grid" id="binGrid"></div>
      <div className="bin-empty text-body-small" id="binEmpty">
        Drop videos or audio here, or click <b>Import</b>.<br />Files are copied into the project folder.
      </div>
      <button className="link text-ui-small" id="showHiddenBtn" hidden></button>
    </section>
  );
}
