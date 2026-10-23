import { useRef, useState } from "react";
import { Copy, Info, MoreHorizontal, Paperclip, Reply } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMessageDetailsTime, formatMessageFileSize } from "./model";
import { getMessageAuthorPresentation, type MessageAuthorInput } from "@/components/features/whatsapp/message-bubble/message-author-model";

export type MessageActionMenuProps = {
  content: string;
  status: string;
  sentAt: string;
  messageType: string;
  mediaFilename?: string | null;
  mediaSize?: number | null;
  onCopy: () => void | Promise<void>;
  onReply?: () => void;
  onAttach?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & MessageAuthorInput;

const STATUS_LABELS: Record<string, string> = {
  received: "Recebida", pending: "Na fila", queued: "Na fila", sending: "Enviando",
  confirming: "Confirmando envio", unconfirmed: "Envio não confirmado", sent: "Enviada",
  delivered: "Entregue", read: "Lida", played: "Reproduzida", failed: "Falha no envio", error: "Falha no envio",
};

const menuItemClassName = "h-8 rounded-[6px] px-2 py-1 text-[length:var(--app-font-size-caption)] font-light";
const detailsContentClassName = "w-[calc(100%_-_2rem)] max-w-sm gap-3 p-4 text-left font-sans " +
  "[&>button]:right-3 [&>button]:top-3 [&>button]:inline-flex [&>button]:h-7 [&>button]:w-7 [&>button]:items-center [&>button]:justify-center " +
  "[&>button]:rounded-[6px] [&>button]:border-0 [&>button]:bg-[var(--app-surface-soft)] [&>button]:text-[var(--app-text-secondary)] [&>button]:opacity-100 [&>button]:hover:bg-[var(--app-surface-hover)] " +
  "[&>button]:focus:ring-0 [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-offset-2 [&>button]:focus-visible:outline-[var(--app-text-tertiary)]";

/** Shows only actions backed by existing UI contracts; no provider mutations. */
export function MessageActionMenu({ content, status, sentAt, fromMe, senderName, senderUserId, viewerUserId, messageType, mediaFilename, mediaSize, onCopy, onReply, onAttach, open, onOpenChange }: MessageActionMenuProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const attachmentSelected = useRef(false);
  const author = getMessageAuthorPresentation({ fromMe, senderName, senderUserId, viewerUserId });
  return <>
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button ref={triggerRef} type="button" data-message-menu-outside aria-label="Mais opções da mensagem" title="Mais opções"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[160] min-w-44 font-sans" onCloseAutoFocus={(event) => { if (detailsOpen || attachmentSelected.current) event.preventDefault(); attachmentSelected.current = false; }}
        onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); onOpenChange(false); }}
        onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onOpenChange(false); } }}>
        {content.trim() && <DropdownMenuItem className={menuItemClassName} onSelect={() => void onCopy()}><Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Copiar texto</DropdownMenuItem>}
        {onReply && <DropdownMenuItem className={menuItemClassName} onSelect={onReply}><Reply className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Responder</DropdownMenuItem>}
        {onAttach && <DropdownMenuItem className={menuItemClassName} onSelect={() => { attachmentSelected.current = true; onOpenChange(false); onAttach(); }}><Paperclip className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Anexar ao lead</DropdownMenuItem>}
        {(content.trim() || onReply || onAttach) && <DropdownMenuSeparator />}
        <DropdownMenuItem className={menuItemClassName} onSelect={() => setDetailsOpen(true)}><Info className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Dados da mensagem</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DialogContent className={detailsContentClassName} aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}
        onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); setDetailsOpen(false); }}
        onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDetailsOpen(false); } }}>
        <DialogHeader className="pr-8 text-left"><DialogTitle className="text-[length:var(--app-font-size-card-title)] font-normal">Dados da mensagem</DialogTitle></DialogHeader>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-left text-[length:var(--app-font-size-caption)] font-light leading-[var(--app-line-height-body)]">
          <dt className="text-muted-foreground">Direção</dt><dd>{author.directionLabel}</dd>
          <dt className="text-muted-foreground">Remetente</dt><dd className="break-words">{author.senderLabel}</dd>
          <dt className="text-muted-foreground">Estado</dt><dd>{STATUS_LABELS[status] || "Estado indisponível"}</dd>
          <dt className="text-muted-foreground">Data</dt><dd>{formatMessageDetailsTime(sentAt) || "Indisponível"}</dd>
          <dt className="text-muted-foreground">Tipo</dt><dd>{({ text: "Texto", image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", deleted: "Mensagem apagada" } as Record<string, string>)[messageType] || "Mensagem"}</dd>
          {mediaFilename && <><dt className="text-muted-foreground">Arquivo</dt><dd className="break-all">{mediaFilename}</dd></>}
          {formatMessageFileSize(mediaSize) && <><dt className="text-muted-foreground">Tamanho</dt><dd>{formatMessageFileSize(mediaSize)}</dd></>}
        </dl>
      </DialogContent>
    </Dialog>
  </>;
}
