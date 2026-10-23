'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

type CapturedTrigger = {
  element: HTMLElement;
  accessScope: string;
  route: string;
  generation: number;
};

function isVisible(element: HTMLElement) {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.visibility !== 'hidden' && style?.visibility !== 'collapse' && style?.display !== 'none';
}

/** Return to the exact KPI that opened this dialog, while its page and access still own focus. */
export function useDashboardDialogFocus(accessScope: string | null) {
  const captured = useRef<CapturedTrigger | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const currentAccessScope = useRef(accessScope);
  const [generation, setGeneration] = useState(0);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    currentAccessScope.current = accessScope;
    if (captured.current?.accessScope !== accessScope) captured.current = null;
  }, [accessScope]);

  const captureTrigger = useCallback((element: HTMLElement) => {
    if (!accessScope || currentAccessScope.current !== accessScope) {
      captured.current = null;
      return;
    }
    const nextGeneration = ++sequence.current;
    captured.current = {
      element,
      accessScope,
      route: element.ownerDocument.defaultView?.location.href ?? '',
      generation: nextGeneration,
    };
    setGeneration(nextGeneration);
  }, [accessScope]);

  const skipRestore = useCallback(() => { captured.current = null; }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    // Radix has no DialogTrigger for these KPI cards. Its fallback must never run here.
    event.preventDefault();
    const trigger = captured.current;
    if (!trigger || trigger.generation !== generation) return;
    captured.current = null;
    if (!mounted.current || !currentAccessScope.current || trigger.accessScope !== currentAccessScope.current) return;

    const { element } = trigger;
    const document = element.ownerDocument;
    if (trigger.route !== (document.defaultView?.location.href ?? '')) return;
    if (!isVisible(element) || element.tabIndex < 0 || element.matches(':disabled, [aria-disabled="true"]')) return;

    const closingLayer = event.target instanceof HTMLElement ? event.target : null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active !== element
      && active.isConnected && !closingLayer?.contains(active)) return;

    // A second dialog/menu may have opened during this one's exit animation.
    const otherLayer = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')]
      .some((layer) => layer !== closingLayer && layer.dataset.state !== 'closed' && isVisible(layer));
    if (otherLayer) return;

    element.focus({ preventScroll: true });
  }, [generation]);

  return { captureTrigger, onCloseAutoFocus, skipRestore };
}
