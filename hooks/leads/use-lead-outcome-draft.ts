import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TaskOutcomeDraft } from '@/components/features/leads/TaskOutcomeDialog';

const emptyDraft: TaskOutcomeDraft = { outcome: '', notes: '' };

/** Parent-owned: hiding the lead's portals must not discard an unsaved result. */
export function useLeadOutcomeDraft(key: string) {
  const identity = useMemo(() => ({ key }), [key]);
  const active = useRef<object | null>(identity);
  const [state, setState] = useState<{ identity: object; draft: TaskOutcomeDraft } | null>(null);
  useLayoutEffect(() => {
    active.current = identity;
    return () => { if (active.current === identity) active.current = null; };
  }, [identity]);
  const updateDraft = useCallback((draft: TaskOutcomeDraft) => {
    if (active.current === identity) setState({ identity, draft });
  }, [identity]);
  return { draft: state?.identity === identity ? state.draft : emptyDraft, updateDraft };
}
