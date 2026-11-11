import { useEffect, useState } from 'react';
import { trackingSession } from '@/services/tracking';
import type { SessionState } from '@/services/tracking/session';

export function useTracking(): SessionState {
  const [state, setState] = useState<SessionState>(trackingSession.state);
  useEffect(() => trackingSession.subscribe(setState), []);
  // Re-render every second while recording so elapsed time ticks.
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.activity?.status !== 'recording') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state.activity?.status]);
  return { ...state, snapshot: trackingSession.state.snapshot };
}
