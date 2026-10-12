'use client';

import { useEffect, useState } from 'react';
import { Button, Text } from '@ds/components';

// Warns when this project is also open in another window (the engine checks in
// with the server; see "presence" in editor/engine.js). Two open editors
// overwrite each other's saves, so the warning comes before anything is lost.
export default function PresenceBanner() {
  const [state, setState] = useState({ others: [], conflict: false });
  useEffect(() => {
    const on = (e) => setState(e.detail);
    window.addEventListener('cutroom:presence', on);
    if (window.__cutroomPresence) setState(window.__cutroomPresence);
    return () => window.removeEventListener('cutroom:presence', on);
  }, []);
  const where = [...new Set(state.others.map((o) => o.label))].join(' and ');
  if (state.conflict) {
    return (
      <div className="presence-banner conflict" role="alert">
        <Text variant="body-small">
          <b>Your recent changes in this window weren't saved.</b> This project was saved from {where || 'another window'} after you opened it, so this window has stopped saving rather than overwrite it. Reload to continue from the latest version.
        </Text>
        <Button variant="primary" onClick={() => window.dispatchEvent(new Event('cutroom:reload-project'))}>Reload</Button>
      </div>
    );
  }
  if (!state.others.length) return null;
  return (
    <div className="presence-banner" role="status">
      <Text variant="body-small">
        <b>This project is also open in {where}.</b> Two open editors overwrite each other's saves, so keep editing in one window and close the other.
      </Text>
    </div>
  );
}
