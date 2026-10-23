"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";

/** Prefetch only near the viewport; an explicit media action can still refresh. */
export function useWhatsAppMediaVisibility(ref: RefObject<HTMLElement | null>, key: string, enabled: boolean) {
  const intent = useMemo(() => ({ key, enabled }), [key, enabled]);
  const [intersection, setIntersection] = useState<{ intent: typeof intent | null; visible: boolean }>({ intent: null, visible: false });
  const supported = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || !supported) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      const visible = entries.some(entry => entry.target === element && entry.isIntersecting);
      setIntersection(current => current.intent === intent && current.visible === visible ? current : { intent, visible });
    }, { root: element.closest('[data-radix-scroll-area-viewport]'), rootMargin: "200px 0px" });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [enabled, intent, ref, supported]);
  return enabled && (!supported || (intersection.intent === intent && intersection.visible));
}
