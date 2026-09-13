import { useEffect, useRef, useState, type MouseEvent } from "react";
import NextImage from "next/image";
import {
  AlertCircle,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  Video,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCreateLeadAttachment } from "@/hooks/use-lead-attachments";
import { cn } from "@/lib/utils";

import { MediaViewer } from "../MediaViewer";
import {
  buildMessageMediaFilename,
  downloadMessageMedia,
  getMessageMediaPolicyPresentation,
  getSafeAvatarUrl,
  getSafeMessageMediaUrl,
  type MessageMediaKind,
} from "../message-media";
import { MessageAudioPlayer } from "./MessageAudioPlayer";
import {
  formatMessageFileSize,
  formatMessageTime,
  normalizeMessageMediaMimeType,
} from "./model";
import { MessageStatus } from "./MessageStatus";

export interface MessageMediaProps {
  mediaKind: MessageMediaKind;
  content: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaStatus: "pending" | "ready" | "failed" | null;
  mediaError: string | null;
  mediaSize?: number | null;
  fromMe: boolean;
  status: string;
  sentAt: string;
  onRetryMedia?: () => void | Promise<void>;
  messageId: string;
  leadId: string;
  leadName: string;
  contactAvatarUrl?: string | null;
  audioAvatarName: string;
  audioAvatarInitial: string;
  compact?: boolean;
}

export function MessageMedia({
  mediaKind,
  content,
  mediaUrl,
  mediaMimeType,
  mediaStatus,
  mediaError,
  mediaSize,
  fromMe,
  status,
  sentAt,
  onRetryMedia,
  messageId,
  leadId,
  leadName,
  contactAvatarUrl,
  audioAvatarName,
  audioAvatarInitial,
  compact = false,
}: MessageMediaProps) {
  const createAttachment = useCreateLeadAttachment();
  const [attachConfirmOpen, setAttachConfirmOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [mediaReloadKey, setMediaReloadKey] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [mediaPendingNowMs, setMediaPendingNowMs] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [isRequestingManualDownload, setIsRequestingManualDownload] = useState(false);
  const downloadRequestRef = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMediaUrlRef = useRef<string | null>(null);

  const mediaPolicyPresentation = getMessageMediaPolicyPresentation({
    error: mediaError,
    kind: mediaKind,
    sizeBytes: mediaSize,
  });
  const safeMediaUrl = getSafeMessageMediaUrl(mediaUrl, mediaKind);
  const attachableMediaUrl = safeMediaUrl && /^https?:\/\//i.test(safeMediaUrl) ? safeMediaUrl : null;
  const safeAvatarUrl = getSafeAvatarUrl(contactAvatarUrl);
  const normalizedMediaMimeType = normalizeMessageMediaMimeType(mediaMimeType, mediaKind);

  useEffect(() => {
    const didUrlChange = mediaUrl !== lastMediaUrlRef.current || messageId !== lastMessageIdRef.current;
    lastMediaUrlRef.current = mediaUrl || null;
    lastMessageIdRef.current = messageId;

    if (didUrlChange) {
      downloadRequestRef.current += 1;
      let cancelled = false;

      queueMicrotask(() => {
        if (cancelled) return;

        if (mediaKind === "image" || mediaKind === "sticker") {
          setImageError(false);
          setImageLoading(Boolean(safeMediaUrl));
        }
        if (mediaKind === "video") {
          setVideoError(false);
          setVideoLoading(Boolean(safeMediaUrl));
        }
        setMediaReloadKey(0);
        setDownloadFeedback(null);
        setIsDownloading(false);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [mediaUrl, mediaKind, messageId, safeMediaUrl]);

  useEffect(() => () => {
    downloadRequestRef.current += 1;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncPendingTime = () => {
      if (cancelled) return;
      setMediaPendingNowMs(mediaStatus === "pending" ? Date.now() : null);
    };

    const initialTimer = window.setTimeout(syncPendingTime, 0);
    const interval = mediaStatus === "pending"
      ? window.setInterval(syncPendingTime, 30_000)
      : null;

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      if (interval) window.clearInterval(interval);
    };
  }, [mediaStatus, sentAt]);

  const handleImageError = () => {
    setImageError(true);
    setImageLoading(false);
  };

  const handleImageLoad = () => {
    setImageLoading(false);
  };

  const retryImage = async () => {
    setImageError(false);
    setImageLoading(true);
    try {
      await onRetryMedia?.();
      setMediaReloadKey((key) => key + 1);
    } catch {
      setImageError(true);
      setImageLoading(false);
    }
  };

  const retryVideo = async () => {
    setVideoError(false);
    setVideoLoading(true);
    try {
      await onRetryMedia?.();
      setMediaReloadKey((key) => key + 1);
    } catch {
      setVideoError(true);
      setVideoLoading(false);
    }
  };

  const getAttachmentFileName = () => buildMessageMediaFilename({
    content,
    kind: mediaKind,
    mimeType: normalizedMediaMimeType,
    sentAt,
  });

  const handleDownloadMedia = async (event?: MouseEvent) => {
    event?.stopPropagation();
    if (!safeMediaUrl || isDownloading) {
      setDownloadFeedback({ message: "Link de mídia inválido ou indisponível.", error: true });
      return;
    }

    const requestId = ++downloadRequestRef.current;
    setIsDownloading(true);
    setDownloadFeedback(null);
    try {
      const result = await downloadMessageMedia({
        url: safeMediaUrl,
        kind: mediaKind,
        filename: getAttachmentFileName(),
      });
      if (requestId !== downloadRequestRef.current) return;
      setDownloadFeedback({
        message: result === "opened"
          ? "O arquivo foi aberto em uma nova aba para download."
          : "Download iniciado.",
        error: false,
      });
    } catch {
      if (requestId !== downloadRequestRef.current) return;
      setDownloadFeedback({ message: "Não foi possível baixar esta mídia.", error: true });
    } finally {
      if (requestId === downloadRequestRef.current) setIsDownloading(false);
    }
  };

  const handleAttachToLead = async () => {
    if (!leadId || !attachableMediaUrl) return;

    try {
      await createAttachment.mutateAsync({
        lead_id: leadId,
        file_name: getAttachmentFileName(),
        file_url: attachableMediaUrl,
        file_type: mediaKind,
        file_size: mediaSize || undefined,
        message_id: messageId,
      });
      setAttachConfirmOpen(false);
    } catch {
      // The mutation owns the user-facing error. Keep the dialog open for retry.
    }
  };

  const handleManualMediaDownload = async () => {
    if (!onRetryMedia || isRequestingManualDownload) return;

    setIsRequestingManualDownload(true);
    try {
      await onRetryMedia();
    } catch {
      // The owning screen already presents the request error to the user.
    } finally {
      setIsRequestingManualDownload(false);
    }
  };

  const renderMediaPolicyPlaceholder = () => {
    if (!mediaPolicyPresentation) return null;

    const queued = mediaPolicyPresentation.isQueued || isRequestingManualDownload;
    return (
      <div className={cn(
        "flex min-w-[200px] max-w-[280px] flex-col items-center gap-2 rounded-[6px] p-4 text-center",
        fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
      )}>
        {queued ? (
          <Loader2 className="h-6 w-6 animate-spin opacity-70" aria-hidden="true" />
        ) : (
          <FileText className="h-6 w-6 opacity-70" aria-hidden="true" />
        )}
        <span className="text-[12px] font-medium" role={queued ? "status" : undefined}>
          {isRequestingManualDownload ? "Solicitando download" : mediaPolicyPresentation.title}
        </span>
        <span className="text-[11px] font-light leading-relaxed opacity-70">
          {isRequestingManualDownload
            ? "Estamos colocando o arquivo na fila."
            : mediaPolicyPresentation.description}
        </span>
        {mediaPolicyPresentation.canRequestDownload && onRetryMedia && !queued && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 rounded-[6px] font-light shadow-none"
            onClick={() => void handleManualMediaDownload()}
          >
            <Download className="mr-1 h-3 w-3" aria-hidden="true" />
            Baixar arquivo
          </Button>
        )}
      </div>
    );
  };

  const renderMediaPending = () => {
    if (mediaPolicyPresentation?.isQueued || isRequestingManualDownload) {
      return renderMediaPolicyPlaceholder();
    }

    const sentAtMs = new Date(sentAt).getTime();
    const ageMs = (mediaPendingNowMs ?? sentAtMs) - sentAtMs;
    const isStuck = !Number.isFinite(sentAtMs) || ageMs > 90_000;

    if (isStuck) {
      return (
        <div className={cn(
          "flex min-w-[180px] flex-col items-center gap-2 rounded-[6px] p-4",
          fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
        )}>
          <Clock className="h-5 w-5 opacity-70" aria-hidden="true" />
          <span className="text-center text-[12px] font-light opacity-90">Mídia demorando para chegar</span>
          {onRetryMedia && (
            <Button size="sm" variant="outline" className="mt-1 rounded-[6px] font-light shadow-none" onClick={onRetryMedia}>
              <RefreshCw className="w-3 h-3 mr-1" />
              Tentar novamente
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className={cn(
        "flex min-w-[180px] items-center gap-3 rounded-[6px] p-4",
        fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
      )}>
        <Loader2 className="h-5 w-5 animate-spin opacity-70" aria-hidden="true" />
        <div className="flex flex-col">
          <span className="text-[12px] font-light opacity-80" role="status">Carregando mídia...</span>
          <span className="text-[11px] font-light opacity-50">Aguarde um momento</span>
        </div>
      </div>
    );
  };

  const renderMediaFailed = () => {
    if (mediaPolicyPresentation) {
      return renderMediaPolicyPlaceholder();
    }

    return (
      <div className="flex min-w-[180px] flex-col items-center gap-2 rounded-[6px] bg-destructive/10 p-4">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        <span className="text-[12px] font-light text-muted-foreground">Mídia não disponível</span>
        {mediaError && (
          <span className="text-xs text-muted-foreground/70 text-center max-w-[180px] truncate">
            {mediaError}
          </span>
        )}
        {onRetryMedia && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 rounded-[6px] font-light shadow-none"
            onClick={onRetryMedia}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Tentar novamente
          </Button>
        )}
      </div>
    );
  };

  const renderMediaTimestamp = () => (
    <div
      data-message-timestamp-position={fromMe ? "bottom-left" : "bottom-right"}
      className={cn(
        "absolute bottom-1 flex items-center gap-1.5 rounded-[4px] bg-[var(--app-media-scrim)] px-1.5 py-0.5",
        fromMe ? "left-1" : "right-1",
      )}
    >
      {leadId && attachableMediaUrl && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setAttachConfirmOpen(true);
          }}
          className="hover:text-primary transition-colors p-0.5"
          title="Anexar ao Lead"
          aria-label="Anexar mídia à documentação do lead"
        >
          <Link2 className="w-3 h-3 text-white" aria-hidden="true" />
        </button>
      )}
      <span className="text-[11px] text-white/90 leading-none">{formatMessageTime(sentAt)}</span>
      {fromMe && <span className="text-white/90"><MessageStatus fromMe={fromMe} status={status} /></span>}
    </div>
  );

  const renderMedia = () => {
    const hasValidMedia = Boolean(safeMediaUrl);

    if (mediaStatus === "pending" && !hasValidMedia) {
      return renderMediaPending();
    }

    if (!hasValidMedia) {
      return renderMediaFailed();
    }

    switch (mediaKind) {
      case "image":
        if (!imageError) {
          return (
            <>
              <div className="relative w-full max-w-[280px] overflow-hidden rounded-[6px] sm:max-w-[300px]">
                {imageLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-overlay)]" role="status" aria-label="Carregando imagem">
                    <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-hidden="true" />
                  </div>
                )}
                <NextImage
                  key={`${messageId}-image-${mediaReloadKey}`}
                  src={safeMediaUrl!}
                  alt={content || "Imagem"}
                  width={300}
                  height={400}
                  sizes="(max-width: 640px) 75vw, 300px"
                  className="h-auto max-h-[400px] w-full cursor-zoom-in object-cover outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onError={handleImageError}
                  onLoad={handleImageLoad}
                  onClick={() => setViewerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setViewerOpen(true);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Abrir imagem em tela ampliada"
                  unoptimized
                />
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={safeMediaUrl!}
                type="image"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
                filename={getAttachmentFileName()}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex h-[180px] w-[min(260px,70vw)] flex-col items-center justify-center gap-2 rounded-[8px] p-4",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
          )}>
            <ImageIcon className="h-10 w-10 opacity-50" aria-hidden="true" />
            <span className="text-[12px] font-light opacity-70">Imagem não disponível</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryImage}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-[6px] px-2 font-light shadow-none"
                onClick={handleDownloadMedia}
                disabled={isDownloading}
              >
                {isDownloading
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                {isDownloading ? "Baixando..." : "Baixar"}
              </Button>
            </div>
          </div>
        );

      case "video":
        if (!videoError) {
          return (
            <>
              <div className="relative w-full max-w-[280px] overflow-hidden rounded-[6px] sm:max-w-[300px]">
                {videoLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-overlay)]" role="status" aria-label="Carregando vídeo">
                    <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-hidden="true" />
                  </div>
                )}
                <video
                  key={`${messageId}-video-${mediaReloadKey}`}
                  src={safeMediaUrl!}
                  className="h-auto max-h-[400px] w-full object-cover"
                  preload="metadata"
                  controls
                  playsInline
                  onLoadedData={() => setVideoLoading(false)}
                  onError={() => {
                    setVideoLoading(false);
                    setVideoError(true);
                  }}
                />
                <button
                  type="button"
                  className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--app-media-scrim)] text-[var(--app-on-media)] transition-colors hover:bg-[var(--app-media-scrim-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-on-media)]/70"
                  onClick={() => setViewerOpen(true)}
                  aria-label="Abrir vídeo em tela ampliada"
                  title="Ampliar vídeo"
                >
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={safeMediaUrl!}
                type="video"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
                filename={getAttachmentFileName()}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex h-[180px] w-[min(260px,70vw)] flex-col items-center justify-center gap-2 rounded-[8px] p-4",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
          )}>
            <Video className="h-10 w-10 opacity-50" aria-hidden="true" />
            <span className="text-[12px] font-light opacity-70">Vídeo não disponível</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryVideo}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={handleDownloadMedia} disabled={isDownloading}>
                {isDownloading
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                {isDownloading ? "Baixando..." : "Baixar"}
              </Button>
            </div>
          </div>
        );

      case "audio":
        return (
          <MessageAudioPlayer
            safeMediaUrl={safeMediaUrl}
            mediaUrl={mediaUrl}
            normalizedMediaMimeType={normalizedMediaMimeType}
            messageId={messageId}
            sentAt={sentAt}
            fromMe={fromMe}
            status={status}
            audioAvatarName={audioAvatarName}
            audioAvatarInitial={audioAvatarInitial}
            safeAvatarUrl={safeAvatarUrl}
            attachableMediaUrl={attachableMediaUrl}
            leadId={leadId}
            onRequestAttach={() => setAttachConfirmOpen(true)}
            onDownload={handleDownloadMedia}
            isDownloading={isDownloading}
            onRetryMedia={onRetryMedia}
          />
        );

      case "document":
        return (
          <div className={cn(
            "flex min-w-0 w-full max-w-[260px] flex-col rounded-[6px] p-2 transition-colors",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
          )}>
            <div className="flex min-w-0 items-center gap-2">
              <div className={cn(
                "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                fromMe ? "bg-primary-foreground/20" : "bg-primary/10",
              )}>
                <FileText className={cn(
                  "w-5 h-5",
                  fromMe ? "text-primary-foreground" : "text-primary",
                )} />
              </div>

              <div className="min-w-0 flex-1 overflow-hidden">
                <p
                  className={cn(compact ? "text-xs" : "text-sm", "truncate font-normal leading-tight")}
                  title={content || "Documento"}
                >
                  {content || "Documento"}
                </p>
                {normalizedMediaMimeType && (
                  <span className="text-[10px] opacity-50 block">
                    {normalizedMediaMimeType.split("/")[1]?.toUpperCase().replace("OCTET-STREAM", "DOC") || "DOC"}
                    {mediaSize ? ` · ${formatMessageFileSize(mediaSize)}` : ""}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDownloadMedia}
                  disabled={isDownloading}
                  className="rounded-[4px] p-0.5 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-50"
                  aria-label={isDownloading ? "Baixando documento" : "Baixar documento"}
                  title="Baixar documento"
                >
                  {isDownloading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                {leadId && attachableMediaUrl && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAttachConfirmOpen(true);
                    }}
                    className="hover:text-primary transition-colors p-0.5"
                    title="Anexar ao Lead"
                    aria-label="Anexar documento à documentação do lead"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <span
              data-message-timestamp-position={fromMe ? "bottom-left" : "bottom-right"}
              className={cn(
                "mt-1 flex items-center gap-0.5 whitespace-nowrap text-[11px] leading-none",
                fromMe
                  ? "mr-auto justify-start text-primary-foreground/60"
                  : "ml-auto justify-end text-[var(--app-text-tertiary)]",
              )}
            >
              {formatMessageTime(sentAt)}
              <MessageStatus fromMe={fromMe} status={status} />
            </span>
          </div>
        );

      case "sticker":
        if (!imageError) {
          return (
            <div className="relative max-h-[160px] max-w-[160px] p-1">
              {imageLoading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[6px] bg-[var(--app-overlay)]" role="status" aria-label="Carregando figurinha">
                  <Loader2 className="h-5 w-5 animate-spin text-white/70" aria-hidden="true" />
                </div>
              )}
              <NextImage
                key={`${messageId}-sticker-${mediaReloadKey}`}
                src={safeMediaUrl!}
                alt={content || "Figurinha"}
                width={150}
                height={150}
                sizes="150px"
                className="max-h-[150px] max-w-[150px] object-contain"
                onError={handleImageError}
                onLoad={handleImageLoad}
                unoptimized
              />
              {renderMediaTimestamp()}
            </div>
          );
        }
        return (
          <div className={cn(
            "flex min-h-[120px] min-w-[140px] flex-col items-center justify-center gap-2 rounded-[8px] p-3",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
          )}>
            <ImageIcon className="h-8 w-8 opacity-50" aria-hidden="true" />
            <span className="text-[11px] font-light opacity-70">Figurinha indisponível</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryImage}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-[6px] shadow-none" onClick={handleDownloadMedia} disabled={isDownloading} aria-label="Baixar figurinha">
                {isDownloading
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="h-3 w-3" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        );
    }
  };

  const isMediaWithOverlayTimestamp = (
    (mediaKind === "image" && Boolean(safeMediaUrl) && !imageError)
    || (mediaKind === "video" && Boolean(safeMediaUrl) && !videoError)
  );
  const isMediaWithOwnTimestamp = mediaKind === "audio" || mediaKind === "document";

  return (
    <>
      {renderMedia()}

      {!isMediaWithOverlayTimestamp && !isMediaWithOwnTimestamp && (
        <span
          data-message-timestamp-position={fromMe ? "bottom-left" : "bottom-right"}
          className={cn(
          "mt-1 flex items-center gap-0.5 whitespace-nowrap",
          fromMe
            ? "mr-auto justify-start text-primary-foreground/60"
            : "ml-auto justify-end text-[var(--app-text-tertiary)]",
          )}
        >
          <span className="text-[11px] leading-none">{formatMessageTime(sentAt)}</span>
          <MessageStatus fromMe={fromMe} status={status} />
        </span>
      )}

      {downloadFeedback && (
        <p
          className={cn(
            "mt-1 max-w-[260px] text-[10px] font-light",
            downloadFeedback.error
              ? "text-destructive"
              : fromMe
                ? "text-primary-foreground/75"
                : "text-[var(--app-text-secondary)]",
          )}
          role={downloadFeedback.error ? "alert" : "status"}
        >
          {downloadFeedback.message}
        </p>
      )}

      <AlertDialog
        open={attachConfirmOpen}
        onOpenChange={(open) => {
          if (!createAttachment.isPending) setAttachConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Anexar ao Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja anexar este arquivo de mídia à documentação do lead <strong>{leadName}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createAttachment.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={createAttachment.isPending || !attachableMediaUrl}
              onClick={(event) => {
                event.preventDefault();
                void handleAttachToLead();
              }}
            >
              {createAttachment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Anexar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
