export type CopyTextToClipboardOptions = {
  preserveWhitespace?: boolean;
};

function copyWithDOM(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const view = document.defaultView;
  if (!view) return false;

  // Capture only when the fallback actually begins. An asynchronous rejection
  // may arrive after the user has moved to another field or conversation.
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const anchor = selection?.anchorNode, anchorOffset = selection?.anchorOffset;
  const focus = selection?.focusNode, focusOffset = selection?.focusOffset;
  const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null;
  const caret = field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null;
  const scroll = [];
  for (let element = focused; element; element = element.parentElement) {
    scroll.push({ element, left: element.scrollLeft, top: element.scrollTop });
  }
  const windowScroll = { left: view.scrollX, top: view.scrollY };
  const textArea = document.createElement('textarea');
  let exactCopy = false, transferFailed = false;
  const writeExactText = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    try {
      // Textarea.value normalizes CRLF; supply the original text when the
      // browser exposes the copy event instead of serializing its selection.
      event.clipboardData.setData('text/plain', text);
      exactCopy = true;
    } catch {
      transferFailed = true;
    }
    event.preventDefault();
  };

  try {
    textArea.value = text;
    textArea.readOnly = true;
    textArea.tabIndex = -1;
    textArea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;';
    // Dropdown portals can temporarily own a focus scope above the dialog.
    const modal = focused?.closest('[role="menu"], [role="dialog"], [role="alertdialog"], dialog[open]') ||
      [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')].reverse().find(element => element.getClientRects().length > 0);
    (modal || document.body).appendChild(textArea);
    textArea.addEventListener('copy', writeExactText);
    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    if (document.activeElement !== textArea || typeof document.execCommand !== 'function') return false;
    return document.execCommand('copy') === true && !transferFailed && (exactCopy || textArea.value === text);
  } catch {
    return false;
  } finally {
    textArea.removeEventListener('copy', writeExactText);
    textArea.remove();
    try {
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    } catch { /* A failed focus restoration must not skip selection or scroll. */ }
    if (selection) {
      try {
        selection.removeAllRanges();
        if (ranges.length === 1 && typeof selection.setBaseAndExtent === 'function' && anchor?.isConnected && focus?.isConnected && anchorOffset !== undefined && focusOffset !== undefined) {
          selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
        } else {
          for (const range of ranges) {
            if (range.startContainer.isConnected && range.endContainer.isConnected) selection.addRange(range);
          }
        }
      } catch { /* A selected message may have been removed by a focus handler. */ }
    }
    if (field?.isConnected && caret && caret.start !== null && caret.end !== null) {
      try { field.setSelectionRange(caret.start, caret.end, caret.direction || undefined); } catch { /* Non-text input types do not expose a caret. */ }
    }
    for (const position of scroll) {
      try {
        if (position.element.isConnected) {
          position.element.scrollLeft = position.left;
          position.element.scrollTop = position.top;
        }
      } catch { /* Another focus handler may have replaced a scroll container. */ }
    }
    try {
      if (view.scrollX !== windowScroll.left || view.scrollY !== windowScroll.top) view.scrollTo(windowScroll.left, windowScroll.top);
    } catch { /* The original browsing context may have closed. */ }
  }
}

export async function copyTextToClipboard(value: string, options: CopyTextToClipboardOptions = {}): Promise<boolean> {
  const text = options.preserveWhitespace ? value : value.trim();
  if (!text) return false;

  try {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (typeof clipboard?.writeText === 'function') {
      // Invoke in the caller's click/touch handler before any asynchronous work.
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Insecure HTTP, denied writes and older browsers use the same fallback.
  }
  try {
    return copyWithDOM(text);
  } catch {
    return false;
  }
}
