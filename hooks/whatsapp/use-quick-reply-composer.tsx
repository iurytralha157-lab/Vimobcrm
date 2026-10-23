import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Bookmark } from "lucide-react";

import { useWhatsAppQuickReplies, useWhatsAppQuickReplyScope } from "@/hooks/whatsapp/use-whatsapp-quick-replies";
import type { QuickReply } from "@/lib/api/whatsapp-quick-replies";
import { filterQuickReplies, getQuickReplyTrigger, insertQuickReply, insertQuickReplyAtSelection } from "@/lib/whatsapp-quick-reply-input";
import { QuickReplyManager } from "@/components/features/whatsapp/quick-replies/QuickReplyManager";
import { QuickReplySuggestions } from "@/components/features/whatsapp/quick-replies/QuickReplySuggestions";

type Field = HTMLInputElement | HTMLTextAreaElement;
type View = { owner: string; visit: object; caret: number; selectionEnd: number; value: string; focused: boolean; dismissed: boolean; selected: number; manager: boolean };

/** Adds personal replies around the existing field; sending remains with its caller. */
export function useQuickReplyComposer({ contextKey, disabled, value, onChange, fieldRef, containerRef }: {
  contextKey: string; disabled: boolean; value: string; onChange: (value: string) => void;
  fieldRef: RefObject<Field | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const scope = useWhatsAppQuickReplyScope();
  const enabled = scope.enabled && !disabled;
  const owner = JSON.stringify([scope.identity, contextKey, enabled]);
  const token = useMemo(() => ({ owner }), [owner]);
  const live = useRef<object | null>(null);
  const focusRequest = useRef<{ token: object; position: number } | null>(null);
  const listId = useId();
  const empty: View = { owner, visit: token, caret: value.length, selectionEnd: value.length, value, focused: false, dismissed: false, selected: 0, manager: false };
  const [state, setState] = useState<View>(empty);
  const view = state.visit === token ? state : empty;
  const query = useWhatsAppQuickReplies(enabled);
  const items = enabled && !query.isError ? query.data || [] : [];
  const caret = view.value === value ? view.caret : value.length;
  const selectionEnd = view.value === value ? view.selectionEnd : value.length;
  const trigger = enabled && view.focused && !view.dismissed && !view.manager && caret === selectionEnd ? getQuickReplyTrigger(value, caret) : null;
  const filtered = trigger ? filterQuickReplies(items, trigger.query) : [];
  const selected = Math.min(view.selected, Math.max(0, filtered.length - 1));
  const visible = Boolean(trigger);
  const activeId = visible && filtered[selected] ? `${listId}-${filtered[selected].id}` : null;
  const patch = (next: Partial<View>) => setState(current => ({ ...(current.visit === token ? current : empty), ...next }));
  useLayoutEffect(() => { live.current = token; return () => { live.current = null; }; }, [token]);
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    if (request.token !== token || !enabled) return;
    fieldRef.current?.focus({ preventScroll: true });
    fieldRef.current?.setSelectionRange(request.position, request.position);
  }, [enabled, fieldRef, state, token, value]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setState(current => current.visit === token ? { ...current, focused: false, dismissed: true } : current);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [containerRef, token]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.setAttribute("aria-autocomplete", "list");
    if (visible) {
      field.setAttribute("aria-controls", listId);
      if (activeId) field.setAttribute("aria-activedescendant", activeId);
      else field.removeAttribute("aria-activedescendant");
    } else { field.removeAttribute("aria-controls"); field.removeAttribute("aria-activedescendant"); }
    return () => { field.removeAttribute("aria-autocomplete"); field.removeAttribute("aria-controls"); field.removeAttribute("aria-activedescendant"); };
  }, [activeId, fieldRef, listId, visible]);

  const restoreFocus = (position: number) => {
    focusRequest.current = { token, position };
  };
  const choose = (item: QuickReply) => {
    if (live.current !== token || !enabled) return;
    const field = fieldRef.current;
    const result = trigger ? insertQuickReply(value, trigger, item.content)
      : insertQuickReplyAtSelection(value, field?.selectionStart ?? caret, field?.selectionEnd ?? caret, item.content);
    restoreFocus(result.caret);
    patch({ value: result.value, caret: result.caret, selectionEnd: result.caret, manager: false, dismissed: true, focused: true, selected: 0 });
    onChange(result.value);
  };
  const captureSelection = (target: EventTarget | null) => {
    if (target !== fieldRef.current) return;
    const field = fieldRef.current;
    patch({ caret: field?.selectionStart ?? value.length, selectionEnd: field?.selectionEnd ?? value.length, value, focused: true });
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = visible ? document.getElementById(listId) : null;
    const optionIndex = event.target instanceof HTMLElement && list?.contains(event.target)
      ? Array.from(list.children).indexOf(event.target) : -1;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      if (event.key === "Enter") { event.stopPropagation(); if (optionIndex >= 0) event.preventDefault(); }
      return;
    }
    if (view.manager && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); restoreFocus(caret); patch({ manager: false, dismissed: true }); return;
    }
    if ((event.target !== fieldRef.current && optionIndex < 0) || !visible || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (optionIndex >= 0) restoreFocus(caret); patch({ dismissed: true }); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || (optionIndex >= 0 && ["Home", "End"].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      if (filtered.length) {
        const next = event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1
          : ((optionIndex >= 0 ? optionIndex : selected) + (event.key === "ArrowDown" ? 1 : filtered.length - 1)) % filtered.length;
        patch({ selected: next });
        if (optionIndex >= 0) (list?.children[next] as HTMLElement | undefined)?.focus({ preventScroll: true });
      }
    }
    if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (filtered[optionIndex >= 0 ? optionIndex : selected]) choose(filtered[optionIndex >= 0 ? optionIndex : selected]);
    }
  };
  const closeManager = () => { restoreFocus(caret); patch({ manager: false, dismissed: true }); };
  const retry = () => { void query.refetch(); };
  return {
    captureSelection, onKeyDownCapture,
    onChange: (next: string) => {
      patch({ value: next, caret: fieldRef.current?.selectionStart ?? next.length, selectionEnd: fieldRef.current?.selectionEnd ?? next.length,
        focused: true, dismissed: false, selected: 0, manager: view.manager });
      onChange(next);
    },
    button: scope.enabled ? <button type="button" aria-label="Mensagens salvas" title="Mensagens salvas" aria-expanded={view.manager && enabled}
      disabled={!enabled} onClick={() => patch({ manager: !view.manager, dismissed: true })}>
      <Bookmark className="h-4 w-4" aria-hidden="true" />
    </button> : null,
    panel: enabled && view.manager ? <QuickReplyManager key={owner} items={items} loading={query.isPending} failed={query.isError}
      draft={value} onRetry={retry} onInsert={choose} onClose={closeManager} />
      : visible ? <QuickReplySuggestions id={listId} items={filtered} selected={selected} loading={query.isPending} failed={query.isError}
        onRetry={retry} onSelect={choose} onHighlight={index => patch({ selected: index })} /> : null,
  };
}
