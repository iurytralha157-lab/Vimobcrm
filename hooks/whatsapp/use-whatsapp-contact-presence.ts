"use client";

import { useMemo, useSyncExternalStore } from "react";

// UI fallback for a missing stop event, not a provider delivery guarantee.
// A new timestamp renews this short-lived signal; persisted old presence does not.
export const WHATSAPP_PRESENCE_TTL_MS = 15_000;
type ContactPresence = "composing" | "recording" | "available";
const emptySnapshot = () => null;

function createPresenceSource(presence: string | null | undefined, updatedAt: string | null | undefined, enabled: boolean) {
  const candidate: ContactPresence | null = presence === "composing" || presence === "recording" || presence === "available" ? presence : null;
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
  const expiresAt = timestamp + WHATSAPP_PRESENCE_TTL_MS;
  let retired = !enabled || !candidate || !Number.isFinite(timestamp);

  const read = (): ContactPresence | null => {
    if (retired) return null;
    const now = Date.now();
    // Reject future values conservatively. Once expired/rejected, this event
    // cannot reappear after clock changes or an A -> B -> A view transition.
    if (now < timestamp || now >= expiresAt) retired = true;
    return retired ? null : candidate;
  };

  const subscribe = (notify: () => void) => {
    if (!read()) return () => {};
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const detach = () => {
      clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    function refresh() {
      if (!active) return;
      clearTimeout(timeout);
      if (!read()) detach();
      else if (document.visibilityState !== "hidden") {
        timeout = setTimeout(refresh, Math.max(1, expiresAt - Date.now()));
      }
      notify();
    }
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => { active = false; detach(); };
  };
  return { read, subscribe };
}

/** Local temporal projection only: never changes the authorized conversation cache. */
export function useWhatsAppContactPresence(presence: string | null | undefined, updatedAt: string | null | undefined, enabled = true) {
  const source = useMemo(() => createPresenceSource(presence, updatedAt, enabled), [presence, updatedAt, enabled]);
  return useSyncExternalStore(source.subscribe, source.read, emptySnapshot);
}
