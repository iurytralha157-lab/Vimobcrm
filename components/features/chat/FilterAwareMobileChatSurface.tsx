'use client';

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';

type Props = {
  minimized: boolean;
  children: ReactNode;
  onOpenAutoFocus: (event: Event) => void;
  onEscapeKeyDown: (event: KeyboardEvent) => void;
};

/** Retire modal isolation while preserving the same composer/recorder subtree. */
export function FilterAwareMobileChatSurface({ minimized, children, onOpenAutoFocus, onEscapeKeyDown }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const parkingRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = document.createElement('div');
    node.dataset.floatingChatContentHost = '';
    parkingRef.current?.appendChild(node);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Create a browser-owned portal host after hydration; it remains stable across minimization.
    setHost(node);
    return () => { node.remove(); };
  }, []);
  const attachModal = useCallback((node: HTMLDivElement | null) => {
    modalRef.current = node;
    // Radix may recycle a composed ref during an ordinary child update. Moving
    // to the hidden parking node on every ref(null) would discard DOM focus.
    if (node && host && host.parentElement !== node) node.appendChild(host);
  }, [host]);
  useLayoutEffect(() => {
    if (minimized && host) parkingRef.current?.appendChild(host);
  }, [host, minimized]);
  useLayoutEffect(() => {
    if (!host) return;
    const forwardTabToModal = (event: KeyboardEvent) => {
      const modal = modalRef.current;
      if (event.key !== 'Tab' || event.defaultPrevented || !modal || !modal.contains(event.target as Node)) return;
      // The stable portal is a React sibling of Content. Forward only Tab to
      // Radix's existing loop so its visibility rules and paused scopes apply.
      const forwarded = new KeyboardEvent('keydown', {
        key: event.key, code: event.code, shiftKey: event.shiftKey, altKey: event.altKey,
        ctrlKey: event.ctrlKey, metaKey: event.metaKey, bubbles: true, cancelable: true,
      });
      modal.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
    };
    host.addEventListener('keydown', forwardTabToModal);
    return () => host.removeEventListener('keydown', forwardTabToModal);
  }, [host]);

  return <>
    <div ref={parkingRef} hidden inert aria-hidden="true" data-floating-chat-parking="" />
    {host && <DialogPrimitive.Root open={!minimized} modal>
      {createPortal(children, host, 'floating-chat-content')}
      <DialogPrimitive.Content
        ref={attachModal}
        role="presentation"
        aria-label={undefined}
        aria-labelledby={undefined}
        aria-modal={undefined}
        aria-describedby={undefined}
        data-floating-chat-modal=""
        className="fixed inset-0 z-50 outline-none"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <DialogPrimitive.Title className="sr-only">Chat do WhatsApp</DialogPrimitive.Title>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>}
  </>;
}
