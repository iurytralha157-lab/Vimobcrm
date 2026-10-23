import { Button } from '@/components/ui/button';
import type { LeadAttachmentUploadDraft } from '@/hooks/leads/use-lead-attachment-upload-draft';

export function LeadAttachmentUploadRecovery({ draft, canRetry, checking, onCheck, onRetry, onClear }: {
  draft: LeadAttachmentUploadDraft | null; canRetry: boolean; checking: boolean;
  onCheck: () => void; onRetry: () => void; onClear: () => void;
}) {
  if (!draft) return null;
  return <div role="status" className="space-y-2 pb-3 pt-2 text-xs font-light">
    <p className="truncate">{draft.file.name}</p>
    {draft.phase === 'pending' ? <p>Enviando documento...</p> : <>
      <p>O envio não foi confirmado. O arquivo foi mantido para tentar novamente sem duplicar esta tentativa. Verifique os documentos antes de iniciar outro envio.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-[6px] text-xs" disabled={checking} onClick={onCheck}>
          {checking ? 'Verificando...' : 'Verificar documentos'}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-[6px] text-xs" disabled={!canRetry} onClick={onRetry}>Tentar novamente</Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-[6px] text-xs" disabled={checking} onClick={onClear}>Encerrar tentativa</Button>
      </div>
    </>}
  </div>;
}
