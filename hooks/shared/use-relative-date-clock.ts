'use client';

import { useEffect, useState } from 'react';
import { millisecondsUntilNextCivilDay, relativeDateClockKey } from '@/lib/filters/relative-date-clock';

/** Refresh relative presets at the civil-day boundary and after a suspended tab resumes. */
export function useRelativeDateClock(enabled = true) {
  const [clockKey, setClockKey] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timeout);
      const now = new Date();
      setClockKey(relativeDateClockKey(now));
      timeout = setTimeout(refresh, millisecondsUntilNextCivilDay(now));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    timeout = setTimeout(refresh, 0);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return clockKey;
}
