'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import { MAX_OUTBOUND_MESSAGE_MEDIA_BYTES } from '@/components/features/whatsapp/message-media';

export type WhatsAppAttachmentOutcome = 'queued' | 'failed' | 'unconfirmed' | 'cancelled';
export type WhatsAppAttachmentSendContext = {
  /** Called only after the caller confirms its own null -> physical conversation preparation. */
  adoptScope: (nextScopeKey: string) => boolean;
  /** The same unconfirmed selection only checks its original send. */
  verificationOnly: boolean;
};
type Attachment = { id: number; file: File; caption: string; url: string | null; outcome?: WhatsAppAttachmentOutcome };
type Options = { scopeKey: string; disabled: boolean; allowScopeAdoption?: boolean; onSend: (file: File, caption: string, context: WhatsAppAttachmentSendContext) => Promise<WhatsAppAttachmentOutcome> };
type State = { owner: string; entries: Attachment[]; busy: boolean; error: string };
type Attempt = { initialOwner: string; adoptedOwner: string | null; transitions: string[]; invalid: boolean; permitsAdoption: boolean };
const empty = (owner: string): State => ({ owner, entries: [], busy: false, error: '' });

/** Bytes remain in this runtime. Scope changes hide them immediately; only explicit confirmation sends. */
export function useWhatsAppAttachments(options: Options) {
  const [state, setState] = useState<State>(() => empty(options.scopeKey));
  const ownerToken = useMemo(() => ({ key: options.scopeKey, disabled: options.disabled }), [options.scopeKey, options.disabled]);
  const committedOwner = useRef<typeof ownerToken | null>(ownerToken);
  const stateRef = useRef(state), current = useRef(options), active = useRef<Attempt | null>(null);
  const identity = useRef({ key: options.scopeKey, disabled: options.disabled });
  const urls = useRef(new Set<string>()), serial = useRef(0), mounted = useRef(false);
  const update = useCallback((next: State) => { stateRef.current = next; setState(next); }, []);
  const release = useCallback((url: string | null) => {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);
  const clear = useCallback(() => {
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear();
    update(empty(current.current.scopeKey));
  }, [update]);
  useLayoutEffect(() => { current.current = options; });
  useLayoutEffect(() => {
    committedOwner.current = ownerToken;
    return () => { committedOwner.current = null; };
  }, [ownerToken]);
  useLayoutEffect(() => {
    mounted.current = true;
    const ownedUrls = urls.current;
    return () => { mounted.current = false; active.current = null; ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); };
  }, []);
  useLayoutEffect(() => {
    const previous = identity.current;
    identity.current = { key: options.scopeKey, disabled: options.disabled };
    if (previous.key === options.scopeKey && previous.disabled === options.disabled) return;
    const attempt = active.current;
    if (attempt?.permitsAdoption && !options.disabled) {
      if (previous.key !== options.scopeKey) attempt.transitions.push(options.scopeKey);
      // The active sender can confirm exactly one preparation transition. Other changes retire the bytes.
      if (attempt.transitions.length <= 1 && (!attempt.adoptedOwner || attempt.adoptedOwner === options.scopeKey)) {
        if (attempt.adoptedOwner === options.scopeKey) update({ ...stateRef.current, owner: options.scopeKey });
        return;
      }
    }
    if (attempt) attempt.invalid = true;
    active.current = null;
    clear();
  }, [clear, options.disabled, options.scopeKey, update]);
  const value = state.owner === options.scopeKey && !options.disabled ? state : empty(options.scopeKey);
  const addFiles = useCallback((files: readonly File[]) => {
    if (!mounted.current || committedOwner.current !== ownerToken || current.current.scopeKey !== options.scopeKey || current.current.disabled) return;
    const pending = active.current;
    if (pending && current.current.scopeKey !== pending.initialOwner && current.current.scopeKey !== pending.adoptedOwner) {
      // Selecting a fresh file in the new route retires an unconfirmed preparation handoff.
      pending.invalid = true; active.current = null; clear();
    }
    if (active.current) return;
    const old = stateRef.current.owner === options.scopeKey ? stateRef.current.entries : [];
    const entries: Attachment[] = [], invalid: string[] = [];
    const capacity = Math.max(0, 10 - old.length);
    for (const file of files) {
      if (!file.size || file.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) { invalid.push(file.name); continue; }
      if (entries.length >= capacity) continue;
      let url: string | null = null;
      if (/^(image|video|audio)\//i.test(file.type)) { url = URL.createObjectURL(file); urls.current.add(url); }
      entries.push({ id: ++serial.current, file, caption: '', url });
    }
    update({ owner: options.scopeKey, entries: [...old, ...entries], busy: false,
      error: invalid.length ? 'Selecione arquivos não vazios de até 5 MB.' : files.length > capacity ? 'Prepare até 10 arquivos por vez.' : '' });
  }, [clear, options.scopeKey, ownerToken, update]);
  const onFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); event.target.value = ''; addFiles(files);
  }, [addFiles]);
  const onPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length && !current.current.disabled) { event.preventDefault(); addFiles(files); }
  }, [addFiles]);
  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = current.current.disabled ? 'none' : 'copy'; }
  }, []);
  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) { event.preventDefault(); event.stopPropagation(); addFiles(files); }
  }, [addFiles]);
  const remove = useCallback((id: number) => {
    if (active.current || committedOwner.current !== ownerToken || current.current.scopeKey !== options.scopeKey) return;
    const previous = stateRef.current;
    if (previous.owner !== options.scopeKey) return;
    release(previous.entries.find(item => item.id === id)?.url ?? null);
    update({ ...previous, entries: previous.entries.filter(item => item.id !== id), error: '' });
  }, [options.scopeKey, ownerToken, release, update]);
  const setCaption = useCallback((id: number, caption: string) => {
    if (active.current || committedOwner.current !== ownerToken || current.current.scopeKey !== options.scopeKey) return;
    const previous = stateRef.current;
    if (previous.owner === options.scopeKey) update({ ...previous,
      entries: previous.entries.map(entry => entry.id === id && entry.outcome !== 'unconfirmed' ? { ...entry, caption: caption.slice(0, 1024) } : entry) });
  }, [options.scopeKey, ownerToken, update]);
  const send = useCallback(async () => {
    const selection = stateRef.current;
    if (active.current || committedOwner.current !== ownerToken || current.current.scopeKey !== options.scopeKey || current.current.disabled
      || selection.owner !== options.scopeKey || !selection.entries.length) return;
    const attempt: Attempt = { initialOwner: options.scopeKey, adoptedOwner: null, transitions: [], invalid: false, permitsAdoption: Boolean(options.allowScopeAdoption) };
    const isCurrent = () => mounted.current && active.current === attempt && !attempt.invalid && !current.current.disabled
      && (current.current.scopeKey === attempt.initialOwner || current.current.scopeKey === attempt.adoptedOwner)
      && attempt.transitions.length <= 1;
    const context: WhatsAppAttachmentSendContext = { verificationOnly: false, adoptScope: next => {
      if (!attempt.permitsAdoption || !mounted.current || active.current !== attempt || attempt.invalid || current.current.disabled || attempt.transitions.length > 1
        || (attempt.adoptedOwner && attempt.adoptedOwner !== next) || (attempt.transitions[0] && attempt.transitions[0] !== next)) return false;
      attempt.adoptedOwner = next;
      if (current.current.scopeKey === next) update({ ...stateRef.current, owner: next });
      return true;
    } };
    active.current = attempt; update({ ...selection, busy: true, error: '' });
    try {
      for (const entry of selection.entries) {
        if (!isCurrent()) return;
        let outcome: WhatsAppAttachmentOutcome;
        try { outcome = await current.current.onSend(entry.file, entry.caption, { ...context, verificationOnly: entry.outcome === 'unconfirmed' }); } catch { outcome = 'failed'; }
        if (!isCurrent()) return;
        const previous = stateRef.current;
        if (outcome === 'queued') {
          release(entry.url);
          update({ ...previous, owner: current.current.scopeKey, entries: previous.entries.filter(item => item.id !== entry.id) });
          // Let mutation and route state commit before the next handler captures its authorization.
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
          if (!isCurrent()) return;
        } else {
          update({ ...previous, owner: current.current.scopeKey,
            entries: previous.entries.map(item => item.id === entry.id ? { ...item, outcome } : item),
            error: outcome === 'unconfirmed' ? 'Envio em confirmação. Verifique a mensagem na conversa antes de continuar.' : outcome === 'cancelled' ? 'O envio foi cancelado.' : 'O arquivo não foi enviado. Confira a mensagem na conversa.' });
          break;
        }
      }
    } finally {
      if (active.current === attempt) {
        active.current = null;
        if (isCurrentOwner(attempt, current.current.scopeKey) && mounted.current && !current.current.disabled) update({ ...stateRef.current, owner: current.current.scopeKey, busy: false });
        else if (mounted.current) clear();
      }
    }
  }, [clear, options.allowScopeAdoption, options.scopeKey, ownerToken, release, update]);
  return { ...value, disabled: options.disabled, addFiles, onFileSelect, onPaste, onDragOver, onDrop, remove, setCaption, send };
}
function isCurrentOwner(attempt: Attempt, key: string) {
  return !attempt.invalid && attempt.transitions.length <= 1 && (key === attempt.initialOwner || key === attempt.adoptedOwner);
}
export type WhatsAppAttachments = ReturnType<typeof useWhatsAppAttachments>;
