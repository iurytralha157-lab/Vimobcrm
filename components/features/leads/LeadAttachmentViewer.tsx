'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileAudio, FileText, FileVideo, ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { LeadAttachment } from '@/lib/api/lead-attachments';
import { prepareLeadPDFPreview } from '@/lib/lead-attachment-preview';
import { useLeadAttachmentAccess } from '@/hooks/use-lead-attachments';

type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

interface LeadAttachmentViewerProps {
  attachment: LeadAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getAttachmentKind(attachment: LeadAttachment | null): AttachmentKind {
  if (!attachment) return 'file';

  const fileType = (attachment.file_type || '').toLowerCase();
  const fileName = attachment.file_name.toLowerCase();
  const extension = fileName.split('.').pop() || '';

  if (fileType === 'audio' || fileType.startsWith('audio/')) return 'audio';
  if (fileType === 'video' || fileType.startsWith('video/')) return 'video';
  if (fileType === 'image' || fileType.startsWith('image/')) return 'image';
  if (fileType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(extension)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'avi'].includes(extension)) return 'video';
  if (['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav'].includes(extension)) return 'audio';

  return 'file';
}

function getKindLabel(kind: AttachmentKind) {
  switch (kind) {
    case 'image':
      return 'Imagem';
    case 'video':
      return 'Vídeo';
    case 'audio':
      return 'Áudio';
    case 'pdf':
      return 'PDF';
    default:
      return 'Arquivo';
  }
}

function AttachmentKindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  switch (kind) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'video':
      return <FileVideo className={className} />;
    case 'audio':
      return <FileAudio className={className} />;
    default:
      return <FileText className={className} />;
  }
}

function normalizeAttachmentFileURL(value: string | null | undefined) {
  const fileURL = (value || '').trim();
  if (!fileURL) return '';

  if (fileURL.startsWith('/') && !fileURL.startsWith('//')) {
    return fileURL.startsWith('/object/') ? `/storage/v1${fileURL}` : fileURL;
  }

  try {
    const parsed = new URL(fileURL);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.pathname.startsWith('/object/')) {
      parsed.pathname = `/storage/v1${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export async function readLeadAttachmentBlob(fileURL: string, signal: AbortSignal, pdf = false, timeoutMs = 30_000): Promise<Blob> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(fileURL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('attachment_fetch_failed');
    const blob = await response.blob();
    controller.signal.throwIfAborted();
    if (!blob.size) throw new Error('attachment_empty_blob');
    const safeBlob = pdf ? await prepareLeadPDFPreview(blob) : blob;
    controller.signal.throwIfAborted();
    return safeBlob;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

export function LeadAttachmentViewer({ attachment, open, onOpenChange }: LeadAttachmentViewerProps) {
  const access = useLeadAttachmentAccess(attachment, open);
  const [failedAttachmentId, setFailedAttachmentId] = useState<string | null>(null);
  const [previewObject, setPreviewObject] = useState<{ attachmentId: string; fileURL: string; url: string } | null>(null);
  const [preparingAttachmentId, setPreparingAttachmentId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const previewRequestRef = useRef<AbortController | null>(null);
  const downloadRequestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const attachmentId = attachment?.id ?? null;
  const kind = useMemo(() => getAttachmentKind(attachment), [attachment]);
  const fileURL = useMemo(() => normalizeAttachmentFileURL(access.authorizedAttachment?.file_url), [access.authorizedAttachment?.file_url]);
  const hasError = Boolean(attachment?.id && failedAttachmentId === attachment.id);
  const previewObjectUrl = fileURL && previewObject && previewObject.attachmentId === attachment?.id && previewObject.fileURL === fileURL ? previewObject.url : null;
  const isPreparingPreview = Boolean(attachment?.id && preparingAttachmentId === attachment.id);

  useEffect(() => {
    const objectUrl = previewObject?.url;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewObject?.url]);

  const loadPreviewBlob = useCallback(async () => {
    if (!open || !attachmentId || !fileURL || previewRequestRef.current) return;

    const generation = generationRef.current;
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setPreparingAttachmentId(attachmentId);
    try {
      const blob = await readLeadAttachmentBlob(fileURL, controller.signal, kind === 'pdf');
      if (generationRef.current !== generation || controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);

      setPreviewObject({ attachmentId, fileURL, url: objectUrl });
      setFailedAttachmentId(null);
    } catch {
      if (generationRef.current === generation) setFailedAttachmentId(attachmentId);
    } finally {
      if (previewRequestRef.current === controller) previewRequestRef.current = null;
      if (generationRef.current === generation) setPreparingAttachmentId(null);
    }
  }, [attachmentId, fileURL, kind, open]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (generationRef.current !== generation) return;
      setDownloading(false);
      setDownloadError(false);
      setFailedAttachmentId(null);
      setPreparingAttachmentId(null);
      setPreviewObject(null);
      if (open && kind === 'pdf') void loadPreviewBlob();
    });
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      previewRequestRef.current?.abort();
      previewRequestRef.current = null;
      downloadRequestRef.current?.abort();
      downloadRequestRef.current = null;
    };
  }, [loadPreviewBlob, kind, open]);

  const handlePreviewError = () => {
    if (!attachment?.id) return;
    if (!previewObjectUrl) {
      void loadPreviewBlob();
      return;
    }
    setFailedAttachmentId(attachment.id);
  };

  const handleDownload = async () => {
    if (!fileURL || !attachment || downloadRequestRef.current) return;
    const currentAttachment = attachment;
    const generation = generationRef.current;
    const controller = new AbortController();
    downloadRequestRef.current = controller;
    setDownloading(true);
    setDownloadError(false);

    try {
      const blob = await readLeadAttachmentBlob(fileURL, controller.signal, kind === 'pdf');
      if (generationRef.current !== generation || controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = currentAttachment.file_name || 'arquivo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      if (generationRef.current === generation) setDownloadError(true);
    } finally {
      if (downloadRequestRef.current === controller) downloadRequestRef.current = null;
      if (generationRef.current === generation) setDownloading(false);
    }
  };

  if (!attachment) return null;

  const previewUnavailable = hasError || kind === 'file' || !fileURL;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      access.cancel();
      generationRef.current += 1;
      previewRequestRef.current?.abort();
      previewRequestRef.current = null;
      downloadRequestRef.current?.abort();
      downloadRequestRef.current = null;
      setDownloading(false);
      setDownloadError(false);
      setFailedAttachmentId(null);
      setPreparingAttachmentId(null);
      setPreviewObject((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return null;
      });
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[88vh] w-[94vw] max-w-5xl flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">{attachment.file_name}</DialogTitle>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
                <AttachmentKindIcon kind={kind} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-normal">{attachment.file_name}</p>
                <p className="text-xs font-light text-[var(--app-text-tertiary)]">{getKindLabel(kind)}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-[6px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                onClick={handleDownload}
                disabled={!fileURL || downloading}
                aria-label={`Baixar ${attachment.file_name}`}
                title="Baixar"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-[6px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                onClick={() => handleOpenChange(false)}
                aria-label="Fechar visualização do anexo"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--app-surface-soft)]">
            {access.isFetching || isPreparingPreview ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--app-text-secondary)]" />
                <p className="text-sm font-light text-[var(--app-text-secondary)]">Carregando prévia...</p>
              </div>
            ) : previewUnavailable ? (
              <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
                {hasError ? (
                  <AlertCircle className="h-10 w-10 text-red-400" />
                ) : (
                  <AttachmentKindIcon kind={kind} className="h-12 w-12 text-[var(--app-text-secondary)]" />
                )}
                <div>
                  <p className="text-base font-normal">
                    {access.isError ? 'Não foi possível confirmar o acesso ao documento' : hasError ? 'Não foi possível carregar a prévia' : 'Prévia indisponível'}
                  </p>
                  <p className="mt-1 text-sm font-light text-[var(--app-text-tertiary)]">
                    {hasError
                      ? 'Não foi possível abrir este arquivo. Tente baixar ou reabra o documento para atualizar o link.'
                      : !fileURL
                        ? 'O link deste anexo está indisponível. Feche e reabra o documento para tentar gerar um novo link.'
                        : 'Este tipo de arquivo não tem visualização direta no navegador. O arquivo está anexado e pode ser baixado.'}
                  </p>
                </div>
                {access.isError && <Button type="button" variant="ghost" className="h-8 rounded-[6px] px-3 text-xs font-light" onClick={() => void access.refetch()}>Tentar novamente</Button>}
                <Button type="button" onClick={handleDownload} disabled={!fileURL || downloading} className="mt-2 h-8 rounded-[6px] px-3 text-xs font-light">
                  {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {downloading ? 'Baixando...' : 'Baixar arquivo'}
                </Button>
                {fileURL && kind !== 'pdf' && <a href={fileURL} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Abrir arquivo original</a>}
              </div>
            ) : kind === 'pdf' && !previewObjectUrl ? (
              <p role="status" className="text-xs">Preparando PDF...</p>
            ) : kind === 'image' ? (
              // URL assinada do Storage precisa ser renderizada direto pelo navegador.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewObjectUrl || fileURL}
                alt={attachment.file_name}
                className="max-h-full max-w-full object-contain"
                onError={handlePreviewError}
              />
            ) : kind === 'video' ? (
              <video
                src={previewObjectUrl || fileURL}
                controls
                className="max-h-full max-w-full"
                onError={handlePreviewError}
              />
            ) : kind === 'audio' ? (
              <div className="w-full max-w-lg px-6">
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4">
                  <div className="mb-4 flex items-center gap-3">
                    <FileAudio className="h-6 w-6 text-[var(--app-text-secondary)]" />
                    <span className="min-w-0 truncate text-sm font-normal">{attachment.file_name}</span>
                  </div>
                  <audio src={previewObjectUrl || fileURL} controls className="w-full" onError={handlePreviewError} />
                </div>
              </div>
            ) : (
              <iframe
                src={previewObjectUrl || undefined}
                title={attachment.file_name}
                sandbox=""
                className="h-full w-full border-0 bg-[var(--app-surface-solid)]"
                referrerPolicy="no-referrer"
                onError={() => attachment?.id && setFailedAttachmentId(attachment.id)}
              />
            )}
          </div>
          {kind === 'pdf' && previewObjectUrl && !hasError && <p className="px-4 py-2 text-xs text-[var(--app-text-tertiary)]">Se o navegador não exibir a prévia, use Baixar para abrir o PDF no seu leitor.</p>}
          {downloadError && <div role="alert" className="px-4 py-2 text-xs text-destructive"><p>Não foi possível baixar o arquivo. Tente novamente ou reabra o documento para atualizar o link.</p>{fileURL && kind !== 'pdf' && <a href={fileURL} target="_blank" rel="noopener noreferrer" className="text-primary underline">Abrir arquivo original</a>}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
