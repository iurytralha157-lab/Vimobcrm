"use client";

import { useCallback, useLayoutEffect, useState } from "react";

// The useful page width must fit the list, a readable chat, and the lead pane.
const DOCKED_DETAILS_MIN_WIDTH = 1100;

export function useConversationDetailsLayout({ selectionKey, isMobile, available }: {
  selectionKey: string;
  isMobile: boolean;
  available: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [measurement, setMeasurement] = useState<{ container: HTMLDivElement; width: number } | null>(null);
  const [choice, setChoice] = useState<{ key: string; open: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!container) return;
    let current = true;
    const measure = () => {
      if (current) setMeasurement({ container, width: container.getBoundingClientRect().width });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    queueMicrotask(measure);
    return () => { current = false; observer.disconnect(); };
  }, [container]);

  const width = measurement?.container === container ? measurement.width : 0;
  const docked = !isMobile && width >= DOCKED_DETAILS_MIN_WIDTH;
  const open = available && (choice?.key === selectionKey ? choice.open : docked);
  const setOpen = useCallback((value: boolean) => {
    setChoice({ key: selectionKey, open: value });
  }, [selectionKey]);

  return { bindContainer: setContainer, docked, open, setOpen };
}
