export default function SourceViewer() {
  return (
    <section className="panel viewer" id="sourcePanel" tabIndex={0}>
      <div className="panel-head">
        <span className="text-eyebrow-small">Source</span>
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
        <button className="btn btn-subtle btn-icon" id="srcIn" title="Mark in (I)">⇤ In</button>
        <button className="btn btn-subtle btn-icon" id="srcPrev" title="Back one frame (←)">◂</button>
        <button className="btn btn-subtle btn-icon" id="srcPlay" title="Play / pause (Space)">▶</button>
        <button className="btn btn-subtle btn-icon" id="srcNext" title="Forward one frame (→)">▸</button>
        <button className="btn btn-subtle btn-icon" id="srcOut" title="Mark out (O)">Out ⇥</button>
        <div className="spacer"></div>
        <label className="vol text-ui-small" id="clipVolWrap" hidden>
          Gain <input type="range" id="clipVol" min="0" max="2" step="0.01" defaultValue="1" /><span id="clipVolVal">0 dB</span>
        </label>
        <button className="btn btn-outline btn-small" id="srcInsert" title="Place marked range at the playhead (overwrite) — or drag the picture onto the timeline">Place at playhead</button>
      </div>
      <div className="inout text-code-small" id="sourceInOut"></div>
    </section>
  );
}
