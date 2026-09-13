export function findElementBySelector(selectorOrSelectors: string | string[]) {
  const selectors = Array.isArray(selectorOrSelectors)
    ? selectorOrSelectors
    : [selectorOrSelectors];
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        element.getClientRects().length > 0
      )
        return element;
    }
  }
  return null;
}

export function activateTourElement(element: HTMLElement | null) {
  if (!element) return;

  const mouseOptions: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
  };
  const pointerOptions: PointerEventInit = {
    ...mouseOptions,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };

  element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
  element.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
  element.dispatchEvent(new PointerEvent("pointerup", pointerOptions));
  element.dispatchEvent(new MouseEvent("mouseup", mouseOptions));
  element.click();
}

export function closeOpenLayer() {
  const documentEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
  });
  const bodyEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
  });
  document.dispatchEvent(documentEvent);
  document.body.dispatchEvent(bodyEvent);
}
