import type { ChangeEventHandler, RefObject } from "react";
import { FileText, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LeadAttachment } from "@/hooks/use-lead-attachments";
import {
  safeExternalURL,
  sectionTitleClassName,
  sectionTitleStyle,
} from "@/components/features/whatsapp/conversations/conversation-lead-panel-ui";

type ConversationLeadAttachmentsProps = {
  attachments: readonly LeadAttachment[];
  loading: boolean;
  failed: boolean;
  uploading: boolean;
  canOperateLead: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: ChangeEventHandler<HTMLInputElement>;
  onRetry: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

function getAttachmentLabel(attachment: LeadAttachment) {
  return attachment.file_name || "Documento";
}

export function ConversationLeadAttachments({
  attachments,
  loading,
  failed,
  uploading,
  canOperateLead,
  fileInputRef,
  onFileUpload,
  onRetry,
  expanded,
  onToggleExpanded,
}: ConversationLeadAttachmentsProps) {
  return (
    <section className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
      <div className="flex h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]">
          <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
          <h3 className={sectionTitleClassName} style={sectionTitleStyle}>
            Documentação
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="lead-detail-subtle-action h-6 rounded-[6px] px-2 text-[10px] font-light"
          disabled={!canOperateLead || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          Anexar
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileUpload}
        />
      </div>

      {loading ? (
        <div
          className="flex items-center gap-2 pb-3 pt-2 text-xs text-[var(--app-text-tertiary)]"
          role="status"
        >
          <Loader2
            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Carregando documentos...
        </div>
      ) : failed ? (
        <div
          className="mb-3 mt-2 rounded-[6px] bg-destructive/8 p-2 text-xs"
          role="alert"
        >
          <p>Não foi possível carregar os documentos.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 px-2"
            onClick={onRetry}
          >
            <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
      ) : attachments.length > 0 ? (
        <div className="space-y-2 pb-3 pt-2">
          {(expanded ? attachments : attachments.slice(0, 4)).map((attachment) => {
            const attachmentURL = safeExternalURL(attachment.file_url);
            const attachmentLabel = getAttachmentLabel(attachment);
            return (
              <button
                key={attachment.id}
                type="button"
                disabled={!attachmentURL}
                className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs outline-none ring-0 hover:bg-[var(--app-surface-hover)] focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() =>
                  window.open(
                    attachmentURL,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                aria-label={
                  attachmentURL
                    ? `Abrir documento ${attachmentLabel}`
                    : `Documento ${attachmentLabel} indisponível`
                }
              >
                <FileText
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="truncate">{attachmentLabel}</span>
              </button>
            );
          })}
          {attachments.length > 4 && (
            <Button type="button" variant="ghost" size="sm" className="h-7 rounded-[6px] px-2 text-[11px] font-light"
              aria-expanded={expanded}
              onClick={onToggleExpanded}>
              {expanded ? "Mostrar menos documentos" : `Ver todos os ${attachments.length} documentos`}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
