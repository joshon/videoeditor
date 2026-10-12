'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Icon, Surface, Text, TextField } from '@ds/components';

// Timelines live in the engine (editor/engine.js); these components hear about
// them through 'cutroom:timelines' and ask for changes with 'cutroom:timeline'.
const ask = (detail) => window.dispatchEvent(new CustomEvent('cutroom:timeline', { detail }));

function useTimelines() {
  const [state, setState] = useState(() => (typeof window !== 'undefined' && window.__cutroomTimelines) || { slug: null, active: null, list: [] });
  useEffect(() => {
    const on = (e) => setState(e.detail);
    window.addEventListener('cutroom:timelines', on);
    if (window.__cutroomTimelines) setState(window.__cutroomTimelines);
    return () => window.removeEventListener('cutroom:timelines', on);
  }, []);
  return state;
}

// Toolbar: pick the timeline, or open the Timelines dialog.
export function TimelineSwitcher() {
  const { active, list } = useTimelines();
  return (
    <div className="timeline-switcher">
      <Dropdown options={list.map((t) => ({ value: t.id, label: t.name }))} value={active || ''} placeholder="Timeline"
        onChange={(e) => ask({ action: 'switch', id: e.target.value })} />
      <Button variant="subtle" iconOnly title="Timelines: new, duplicate, rename, import a cut list"
        onClick={() => window.dispatchEvent(new Event('cutroom:open-timelines'))} leftIcon={<Icon name="view_timeline" size="lg" />} />
    </div>
  );
}

export function TimelinesDialog() {
  const dlg = useRef(null);
  const { slug, active, list } = useTimelines();
  const [names, setNames] = useState({});
  const [cutlists, setCutlists] = useState([]);

  useEffect(() => {
    const onOpen = async () => {
      dlg.current.showModal(); setNames({});
      const s = window.__cutroomTimelines?.slug;
      if (s) { try { setCutlists(await (await fetch(`/api/projects/${encodeURIComponent(s)}/cutlists`, { cache: 'no-store' })).json()); } catch { setCutlists([]); } }
    };
    window.addEventListener('cutroom:open-timelines', onOpen);
    return () => window.removeEventListener('cutroom:open-timelines', onOpen);
  }, []);

  const close = () => dlg.current.close();
  return (
    <dialog className="modal" id="timelinesDialog" ref={dlg}>
      <Surface as="form" method="dialog" variant="surface-menu" padding="large" rounded="large" className="modal-body">
        <Text variant="headers-h5">Timelines</Text>
        <Text variant="body-small" color="muted">Each timeline is a separate edit of this project's media. They're saved with the project; earlier states are in Versions.</Text>
        <div className="timeline-list">
          {list.map((t) => (
            <div className={'timeline-row' + (t.id === active ? ' current' : '')} key={t.id}>
              <TextField aria-label="Timeline name" value={names[t.id] ?? t.name}
                onChange={(e) => setNames({ ...names, [t.id]: e.target.value })}
                onBlur={() => { if (names[t.id] != null && names[t.id].trim() && names[t.id] !== t.name) ask({ action: 'rename', id: t.id, name: names[t.id] }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
              {t.id === active
                ? <Text variant="body-small" color="muted">Open</Text>
                : <Button variant="outline" type="button" onClick={() => { ask({ action: 'switch', id: t.id }); close(); }}>Open</Button>}
            </div>
          ))}
        </div>
        <div className="row">
          <Button variant="outline" type="button" onClick={() => { ask({ action: 'new' }); close(); }}>New empty timeline</Button>
          <Button variant="outline" type="button" onClick={() => { ask({ action: 'duplicate' }); close(); }}>Duplicate this timeline</Button>
        </div>
        <Text variant="eyebrow-small">Cut lists</Text>
        <Text variant="body-small" color="muted">
          JSON edit lists in this project's <code className="text-code-small">cutlists/</code> folder. Importing one makes a new timeline; nothing existing changes.
        </Text>
        <div className="timeline-list">
          {cutlists.length === 0 && <Text variant="body-small" color="muted">None yet.</Text>}
          {cutlists.map((c) => (
            <div className="timeline-row" key={c.file}>
              <div className="grow">
                <Text variant="body-small">{c.name}</Text>
                <Text variant="body-small" color="muted">{c.file} · {c.valid ? `${c.clips} clips` : 'not a valid cut list'} · {new Date(c.mtime).toLocaleString()}</Text>
              </div>
              <Button variant="outline" type="button" disabled={!c.valid} onClick={() => { ask({ action: 'import', file: c.file }); close(); }}>Import</Button>
            </div>
          ))}
        </div>
        <div className="row end"><Button variant="primary" value="close">Done</Button></div>
      </Surface>
    </dialog>
  );
}
