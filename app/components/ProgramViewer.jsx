export default function ProgramViewer() {
  return (
    <section className="panel viewer" id="programPanel" tabIndex={0}>
      <div className="panel-head">
        <span className="text-eyebrow-small">Program</span>
        <span className="viewer-title text-ui-small" id="seqInfo"></span>
        <div className="spacer"></div>
        <span className="tc text-code-small" id="programDur"></span>
      </div>
      <div className="screen"><canvas id="programCanvas"></canvas></div>
      <div className="transport">
        <span className="tc text-code-medium" id="programTc">00:00:00:00</span>
        <div className="spacer"></div>
        <button className="btn btn-subtle btn-icon" id="pgStart" title="Go to start (Home)">⏮</button>
        <button className="btn btn-subtle btn-icon" id="pgPrev" title="Back one frame (←)">◂</button>
        <button className="btn btn-subtle btn-icon" id="pgPlay" title="Play / pause (Space) · J K L shuttle">▶</button>
        <button className="btn btn-subtle btn-icon" id="pgNext" title="Forward one frame (→)">▸</button>
        <button className="btn btn-subtle btn-icon" id="pgEnd" title="Go to end (End)">⏭</button>
        <div className="spacer"></div>
        <span className="text-ui-small rate" id="rateLabel"></span>
      </div>
    </section>
  );
}
