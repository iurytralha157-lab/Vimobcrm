import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";

import type { QuickReply } from "@/lib/api/whatsapp-quick-replies";
import { useCreateWhatsAppQuickReply, useDeleteWhatsAppQuickReply, useUpdateWhatsAppQuickReply } from "@/hooks/whatsapp/use-whatsapp-quick-replies";
import { suggestQuickReplyShortcut } from "@/lib/whatsapp-quick-reply-input";
import { whatsAppQuickReplyInputSchema, WHATSAPP_QUICK_REPLY_LIMIT } from "@/lib/validation/whatsapp-quick-replies";
import { quickReplyActionClass, quickReplyPanelClass } from "./QuickReplySuggestions";

type Form = { id?: string; shortcut: string; content: string };
const fieldClass = "w-full min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 py-2 text-[12px] font-light text-[var(--app-text-primary)] outline-none placeholder:text-[11px] placeholder:text-[var(--app-text-tertiary)] focus-visible:ring-1 focus-visible:ring-[var(--app-border)]";

export function QuickReplyManager({ items, loading, failed, draft, onRetry, onInsert, onClose }: {
  items: QuickReply[]; loading: boolean; failed: boolean; draft: string;
  onRetry: () => void; onInsert: (item: QuickReply) => void; onClose: () => void;
}) {
  const create = useCreateWhatsAppQuickReply();
  const update = useUpdateWhatsAppQuickReply();
  const remove = useDeleteWhatsAppQuickReply();
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const [error, setError] = useState("");
  const [lastOperation, setLastOperation] = useState<"save" | "delete" | null>(null);
  const live = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<string | null>("Fechar mensagens salvas");
  const returnFocus = useRef("Fechar mensagens salvas");
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // Only a mount or an explicit local gesture requests focus. A late CRUD
  // response must not pull focus out of the composer or a different chat.
  useLayoutEffect(() => {
    const label = focusRequest.current;
    if (!label) return;
    focusRequest.current = null;
    const target = [...(panelRef.current?.querySelectorAll<HTMLElement>("[aria-label]") || [])]
      .find(element => element.getAttribute("aria-label") === label);
    target?.focus({ preventScroll: true });
  });
  const busy = create.isPending || update.isPending || remove.isPending;
  const save = async () => {
    if (!form || busy) return;
    const parsed = whatsAppQuickReplyInputSchema.safeParse({ shortcut: form.shortcut, content: form.content });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Confira o atalho e a mensagem."); return; }
    const { shortcut, content } = parsed.data;
    setError(""); setLastOperation("save");
    try {
      if (form.id) await update.mutateAsync({ id: form.id, shortcut, content });
      else await create.mutateAsync({ shortcut, content });
      if (live.current) { setForm(null); setLastOperation(null); }
    } catch (failure) {
      if (live.current && !(failure instanceof Error && failure.name === "AbortError")) setError("Não foi possível salvar. Seu texto foi mantido; tente novamente.");
    }
  };
  const deleteReply = async () => {
    if (!deleting || busy) return;
    setError(""); setLastOperation("delete");
    try {
      await remove.mutateAsync(deleting.id);
      if (live.current) { setDeleting(null); setLastOperation(null); }
    } catch (failure) {
      if (live.current && !(failure instanceof Error && failure.name === "AbortError")) setError("Não foi possível excluir a mensagem. Tente novamente.");
    }
  };
  const openForm = (next: Form, origin: string) => { returnFocus.current = origin; focusRequest.current = "Atalho da mensagem salva"; setForm(next); setDeleting(null); setError(""); setLastOperation(null); };
  return <section ref={panelRef} aria-label="Gerenciar mensagens salvas" className={quickReplyPanelClass} data-quick-reply-manager
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="mb-1 flex items-center justify-between gap-2 px-1">
      <span className="text-[12px] font-light">Minhas mensagens salvas</span>
      <button type="button" className={quickReplyActionClass} aria-label="Fechar mensagens salvas" onClick={onClose}><X className="h-3.5 w-3.5" /></button>
    </header>
    <div className="max-h-[min(380px,50dvh)] overflow-y-auto overscroll-contain">
      {form ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-2 p-1">
        <label className="block space-y-1"><span className="text-[11px] text-[var(--app-text-secondary)]">Atalho</span>
          <input aria-label="Atalho da mensagem salva" className={fieldClass} value={form.shortcut} maxLength={41} placeholder="boas_vindas" autoComplete="off" disabled={busy}
            onChange={event => { setForm({ ...form, shortcut: event.target.value }); setError(""); }} /></label>
        <label className="block space-y-1"><span className="text-[11px] text-[var(--app-text-secondary)]">Mensagem</span>
          <textarea aria-label="Conteúdo da mensagem salva" className={`${fieldClass} min-h-20 max-h-40 resize-y`} value={form.content} rows={3} disabled={busy}
            onChange={event => { setForm({ ...form, content: event.target.value }); setError(""); }} /></label>
        <p className="text-[11px] text-[var(--app-text-tertiary)]">{[...form.content].length}/4.000 caracteres · disponível apenas para você</p>
        <div className="flex justify-end gap-1">
          <button type="button" className={quickReplyActionClass} disabled={busy} onClick={() => { focusRequest.current = returnFocus.current; setForm(null); setError(""); }}>Cancelar</button>
          <button type="submit" className={`${quickReplyActionClass} bg-primary/50 !text-white hover:!bg-primary`} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form> : <>
        <button type="button" aria-label="Salvar mensagem atual" className={`${quickReplyActionClass} mb-1 w-full !justify-start bg-[var(--app-surface-soft)]`} disabled={busy || !draft.trim() || loading || failed || items.length >= WHATSAPP_QUICK_REPLY_LIMIT}
          onClick={() => openForm({ shortcut: suggestQuickReplyShortcut(draft), content: draft }, "Salvar mensagem atual")}>Salvar mensagem atual</button>
        {items.length >= WHATSAPP_QUICK_REPLY_LIMIT && <p className="px-2 py-1 text-[11px] text-[var(--app-text-tertiary)]">Limite de 200 mensagens. Edite ou exclua uma para salvar outra.</p>}
        {loading && <p role="status" className="px-2 py-2 text-[11px] text-[var(--app-text-tertiary)]">Carregando mensagens salvas…</p>}
        {failed && <div role="alert" className="px-1 py-2"><p>Mensagens salvas indisponíveis.</p><button type="button" className={quickReplyActionClass} onClick={onRetry}>Tentar novamente</button></div>}
        {!loading && !failed && !items.length && <p className="px-2 py-2 text-[11px] text-[var(--app-text-tertiary)]">Suas mensagens salvas aparecerão aqui. Digite / no campo para inserir um atalho.</p>}
        {!failed && items.map(item => <div key={item.id} className="flex min-w-0 items-center gap-0.5 rounded-[6px] hover:bg-[var(--app-surface-soft)]">
          <button type="button" className="min-w-0 flex-1 rounded-[6px] px-2 py-2 text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-primary/35"
            onPointerDown={event => event.preventDefault()} onClick={() => onInsert(item)} disabled={busy} aria-label={`Inserir /${item.shortcut}`}>
            <span className="block truncate text-[12px] font-light">/{item.shortcut}</span><span className="block truncate text-[11px] font-light text-[var(--app-text-tertiary)]">{item.content}</span>
          </button>
          <button type="button" aria-label={`Editar /${item.shortcut}`} className={quickReplyActionClass} disabled={busy} onClick={() => openForm(item, `Editar /${item.shortcut}`)}><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={`Excluir /${item.shortcut}`} className={quickReplyActionClass} disabled={busy} onClick={() => { returnFocus.current = `Excluir /${item.shortcut}`; focusRequest.current = "Cancelar"; setDeleting(item); setError(""); }}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>)}
      </>}
      {deleting && !form && <div className="mt-1 rounded-[6px] bg-[var(--app-surface-soft)] p-2" role="alert">
        <p className="text-[11px]">Excluir /{deleting.shortcut}?</p><div className="flex justify-end gap-1">
          <button type="button" aria-label="Cancelar" className={quickReplyActionClass} disabled={busy} onClick={() => { focusRequest.current = returnFocus.current; setDeleting(null); setError(""); }}>Cancelar</button>
          <button type="button" className={quickReplyActionClass} disabled={busy} onClick={() => void deleteReply()}>{busy ? "Excluindo…" : "Confirmar exclusão"}</button>
        </div>
      </div>}
      {error && <div role="alert" className="px-2 py-2 text-[11px]"><p>{error}</p>{lastOperation && <button type="button" className={quickReplyActionClass} disabled={busy}
        onClick={() => { if (lastOperation === "delete") void deleteReply(); else void save(); }}>Tentar novamente</button>}</div>}
    </div>
  </section>;
}
