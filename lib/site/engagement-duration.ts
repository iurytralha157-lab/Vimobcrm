export type EngagementClock = () => number;

export type EngagementDurationTracker = {
  flush: () => number;
  pause: () => number;
  resume: () => void;
};

export function createEngagementDurationTracker(
  initiallyVisible: boolean,
  now: EngagementClock = Date.now,
): EngagementDurationTracker {
  let activeSince = initiallyVisible ? now() : null;
  let remainderMs = 0;

  const consume = (pause: boolean) => {
    if (activeSince === null) return 0;

    const current = now();
    const elapsedMs = remainderMs + Math.max(0, current - activeSince);
    const seconds = Math.floor(elapsedMs / 1000);
    remainderMs = elapsedMs - seconds * 1000;
    activeSince = pause ? null : current;
    return seconds;
  };

  return {
    flush: () => consume(false),
    pause: () => consume(true),
    resume: () => {
      if (activeSince === null) activeSince = now();
    },
  };
}
