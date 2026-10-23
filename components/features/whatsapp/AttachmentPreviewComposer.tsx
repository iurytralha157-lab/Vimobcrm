'use client';
import { FileText, Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import type { WhatsAppAttachments } from '@/hooks/use-whatsapp-attachments';

export function AttachmentPreviewComposer({ attachments }: { attachments: WhatsAppAttachments }) {
  if (!attachments.entries.length && !attachments.error) return null;
  return <section aria-label="Revisar arquivos antes de enviar" className="mb-2 rounded-[8px] border bg-[var(--app-surface-soft)] p-2">
    <div className="max-h-56 space-y-2 overflow-y-auto">
      {attachments.entries.map(entry => <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-[6px] bg-[var(--app-surface)] p-2">
        {entry.url && entry.file.type.startsWith('image/')
          ? <Image src={entry.url} alt={`Prévia de ${entry.file.name}`} width={56} height={56} unoptimized className="h-14 w-14 shrink-0 rounded-[6px] object-contain" />
          : entry.url && entry.file.type.startsWith('video/') ? <video src={entry.url} muted preload="metadata" className="h-14 w-14 shrink-0 rounded-[6px] object-contain" />
            : <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1"><p className="truncate text-xs" title={entry.file.name}>{entry.file.name}</p>
          <p className="mb-1 text-[11px] text-muted-foreground">{(entry.file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</p>
          <Input aria-label={`Legenda de ${entry.file.name}`} placeholder="Adicionar legenda…" maxLength={1024} value={entry.caption} disabled={attachments.disabled || attachments.busy || entry.outcome === 'unconfirmed'} onChange={event => attachments.setCaption(entry.id, event.target.value)} className="h-8 rounded-[6px] px-2 py-2 text-xs font-light md:text-xs focus:shadow-none! focus-visible:shadow-none! focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0" />
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]" aria-label={`Remover ${entry.file.name} da seleção`} disabled={attachments.busy} onClick={() => attachments.remove(entry.id)}><X className="h-4 w-4" /></Button>
      </div>)}
    </div>
    {attachments.error && <p role="status" className="mt-2 text-xs text-muted-foreground">{attachments.error}</p>}
    {!!attachments.entries.length && <div className="mt-2 flex justify-end"><Button type="button" size="sm" className="h-8 rounded-[6px] bg-primary/50 text-xs font-light text-primary-foreground hover:bg-primary/70" disabled={attachments.disabled || attachments.busy} onClick={() => void attachments.send()}>
      {attachments.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="mr-2 h-4 w-4" />}
      {attachments.entries.some(entry => entry.outcome === 'unconfirmed') ? 'Verificar envio' : `Enviar ${attachments.entries.length === 1 ? 'arquivo' : 'arquivos'}`}
    </Button></div>}
  </section>;
}
