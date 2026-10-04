"use client";

import { useEffect, useState } from "react";

type RetainedConversation = {
  nonlead_expires_at?: string | null;
  lead_id?: string | null;
  lead?: { id?: string | null } | null;
  historical_lead_view?: boolean;
  is_group?: boolean;
};

export function isExpiredWhatsAppNonLeadConversation(
  conversation: RetainedConversation | null | undefined,
  now: number | null,
): boolean {
  if (
    !conversation?.nonlead_expires_at
    || conversation.lead_id
    || conversation.lead?.id
    || conversation.historical_lead_view
    || conversation.is_group
  ) {
    return false;
  }

  const deadline = Date.parse(conversation.nonlead_expires_at);
  // Hide a retained non-lead until its deadline has been checked on this tab.
  return !Number.isFinite(deadline) || now === null || now >= deadline;
}

export function useWhatsAppNonLeadRetentionNow(
  expiresAtValues: readonly (string | null | undefined)[],
): number | null {
  const deadlinesKey = expiresAtValues.filter(Boolean).join("\u0000");
  const [clock, setClock] = useState<{ key: string; now: number } | null>(null);

  useEffect(() => {
    if (!deadlinesKey) return undefined;

    const deadlines = deadlinesKey
      .split("\u0000")
      .map((value) => Date.parse(value))
      .filter(Number.isFinite);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (timer !== undefined) clearTimeout(timer);
      const now = Date.now();
      setClock({ key: deadlinesKey, now });
      const nextDeadline = Math.min(...deadlines.filter((deadline) => deadline > now));
      if (Number.isFinite(nextDeadline)) {
        timer = setTimeout(refresh, Math.max(1, nextDeadline - now + 1));
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, [deadlinesKey]);

  return clock?.key === deadlinesKey ? clock.now : null;
}
