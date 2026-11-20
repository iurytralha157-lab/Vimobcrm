import type { ChangeEvent, RefObject } from 'react';
import { FileText, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LeadAttachmentsStatus } from '@/components/features/leads/LeadAttachmentsStatus';
import { LeadAttachmentUploadRecovery } from '@/components/features/leads/lead-detail/LeadAttachmentUploadRecovery';
import type { LeadAttachment } from '@/hooks/use-lead-attachments';
import type { LeadAttachmentUploadDraft } from '@/hooks/leads/use-lead-attachment-upload-draft';
import { cn } from '@/lib/utils';

type LeadDetailAttachmentsProps = {
  mobile: boolean;
  canOperate: boolean;
  attachments: LeadAttachment[];
  loading: boolean;
  error: boolean;
  fetching: boolean;
  uploading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  uploadDraft: LeadAttachmentUploadDraft | null;
  onUpload: (event: ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => void;
  onOpen: (attachment: LeadAttachment) => void;
  onRefetch: () => void;
  onClearDraft: () => void;
};

export function LeadDetailAttachments({
  mobile, canOperate, attachments, loading, error, fetching, uploading,
  inputRef, uploadDraft, onUpload, onOpen, onRefetch, onClearDraft,
}: LeadDetailAttachmentsProps) {
  const Container = mobile ? 'section' : 'div';
  return (
    <Container data-tour={mobile ? undefined : 'lead-detail-documents'} className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3">
      <div className="flex h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[var(--app-text-secondary)]">
          <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
          <h3 className="leading-none" style={{ color: 'var(--app-text-secondary)', fontSize: '11px', fontWeight: 400 }}>Documentação</h3>
        </div>
        {canOperate && (
          <>
            <Button variant="ghost" size="sm" className="lead-detail-subtle-action h-6 rounded-[6px] px-2 text-[10px] font-light" disabled={uploading || Boolean(uploadDraft)} onClick={() => inputRef.current?.click()}>
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
              Anexar
            </Button>
            <input ref={inputRef} type="file" className="hidden" onChange={onUpload} />
          </>
        )}
      </div>
      {(loading || error) && (
        <div className="pb-3 pt-2">
          <LeadAttachmentsStatus loading={loading} error={error} empty={attachments.length === 0} retrying={fetching} onRetry={onRefetch} />
        </div>
      )}
      <LeadAttachmentUploadRecovery draft={uploadDraft} canRetry={canOperate} checking={fetching}
        onCheck={onRefetch} onRetry={() => { if (uploadDraft) void onUpload({ target: { files: [uploadDraft.file] } }); }} onClear={onClearDraft} />
      {attachments.length > 0 && (
        <div className={cn('space-y-2 pb-3 pt-2', !mobile && 'max-h-44 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}>
          {attachments.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={cn('flex w-full items-center gap-2 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 py-2 text-left text-xs font-light outline-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30', mobile && 'min-h-10')}
              onClick={() => void onOpen(doc)}
            >
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="truncate">{doc.file_name}</span>
            </button>
          ))}
        </div>
      )}
    </Container>
  );
}
