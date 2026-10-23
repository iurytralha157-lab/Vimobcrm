import type { QuickReply } from "@/lib/api/whatsapp-quick-replies";
import { useLayoutEffect, useRef } from "react";

export const quickReplyActionClass = "inline-flex min-h-8 items-center justify-center gap-1 rounded-[6px] border-0 px-2 text-[12px] font-light text-[var(--app-text-secondary)] outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/35 disabled:pointer-events-none disabled:opacity-45";
export const quickReplyPanelClass = "absolute bottom-[calc(100%+8px)] left-0 z-[160] w-full max-w-[380px] overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-lg";

export function QuickReplySuggestions({ id, items, selected, loading, failed, onRetry, onSelect, onHighlight }: {
  id: string; items: QuickReply[]; selected: number; loading: boolean; failed: boolean;
  onRetry: () => void; onSelect: (item: QuickReply) => void; onHighlight: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeId = items[selected]?.id;
  useLayoutEffect(() => {
    const list = listRef.current;
    const active = list?.children[selected];
    if (!list || !(active instanceof HTMLElement)) return;
    const viewport = list.getBoundingClientRect(), option = active.getBoundingClientRect();
    if (option.top < viewport.top) list.scrollTop -= viewport.top - option.top;
    else if (option.bottom > viewport.bottom) list.scrollTop += option.bottom - viewport.bottom;
  }, [activeId, selected]);
  return <div className={quickReplyPanelClass} data-quick-reply-suggestions>
    <p className="mb-1 px-2 text-[11px] text-[var(--app-text-tertiary)]" role="status">
      {loading ? "Carregando mensagens salvas…" : failed ? "Mensagens salvas indisponíveis." : "Mensagens salvas · Enter para inserir"}
    </p>
    {failed && <button type="button" className={quickReplyActionClass} onClick={onRetry}>Tentar novamente</button>}
    {!loading && !failed && !items.length && <p className="px-2 py-2 text-[11px] text-[var(--app-text-tertiary)]">Nenhum atalho encontrado.</p>}
    <div ref={listRef} id={id} role="listbox" aria-label="Atalhos de mensagens salvas" className="max-h-[min(240px,35dvh)] overflow-y-auto overscroll-contain">
      {items.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="option" aria-selected={selected === index}
        className={`flex w-full min-w-0 flex-col items-start gap-0.5 rounded-[6px] border-0 px-2 py-2 text-left outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/35 ${selected === index ? "bg-primary/10 text-primary" : ""}`}
        onFocus={() => onHighlight(index)}
        onPointerDown={event => event.preventDefault()} onClick={() => onSelect(item)}>
        <span className="w-full min-w-0 truncate text-[12px] font-light">/{item.shortcut}</span>
        <span className="line-clamp-2 w-full min-w-0 break-all text-[11px] font-light text-[var(--app-text-secondary)]">{item.content}</span>
      </button>)}
    </div>
  </div>;
}
