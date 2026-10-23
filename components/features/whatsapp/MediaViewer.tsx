import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import { AlertCircle, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, X, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  downloadMessageMedia,
  getSafeMessageMediaUrl,
  sanitizeMediaFilename,
} from "./message-media";
import { getMessageMediaGallery, getMessageMediaGalleryNeighbor, type MessageMediaGalleryItem } from "./message-bubble/media-gallery-model";
import { releaseMessageAudio } from "./message-bubble/audio-playback-coordinator";
import { useMediaGallerySource } from "./message-bubble/use-media-gallery-source";
import { useMessagePlaybackSource } from "@/hooks/whatsapp/use-message-playback-source";

interface MediaViewerProps {
  src: string;
  type: "image" | "video";
  isOpen: boolean;
  onClose: () => void;
  filename?: string;
  onRefreshMedia?: () => Promise<string | null>;
  messageId?: string;
  gallery?: readonly MessageMediaGalleryItem[];
  galleryScopeKey?: string;
  playbackIdentity?: string;
}

type MediaLoadStatus = "loading" | "ready" | "error";

export function MediaViewer({ src: initialSrc, type: initialType, isOpen, onClose, filename: initialFilename, onRefreshMedia: initialRefresh, messageId = initialSrc, gallery: suppliedGallery = [], galleryScopeKey = messageId, playbackIdentity }: MediaViewerProps) {
  const [selection, setSelection] = useState({ scopeKey: galleryScopeKey, originId: messageId, id: messageId, isOpen });
  if (selection.scopeKey !== galleryScopeKey || selection.originId !== messageId || selection.isOpen !== isOpen) {
    setSelection({ scopeKey: galleryScopeKey, originId: messageId, id: messageId, isOpen });
  }
  const gallery = getMessageMediaGallery(suppliedGallery, { id: messageId, url: initialSrc, type: initialType, filename: initialFilename, refresh: initialRefresh });
  const selected = selection.scopeKey === galleryScopeKey && selection.originId === messageId && selection.isOpen === isOpen
    ? gallery.find((item) => item.id === selection.id) || gallery.find((item) => item.id === messageId)!
    : gallery.find((item) => item.id === messageId)!;
  const { type, filename } = selected;
  const source = useMediaGallerySource(selected, galleryScopeKey, isOpen);
  const onRefreshMedia = source.refresh;
  const safeSrc = getSafeMessageMediaUrl(source.url, type);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoPlayback = useMessagePlaybackSource(JSON.stringify([playbackIdentity, galleryScopeKey, selected.id, type, isOpen]),
    isOpen && type === "video" ? safeSrc : null, videoRef);
  const identity = `${galleryScopeKey}:${selected.id}:${type}:${type === "video" ? videoPlayback.url || "invalid" : safeSrc || "invalid"}`;
  const safeFilename = sanitizeMediaFilename(filename, type === "image" ? "Imagem" : "Video");
  const [zoomState, setZoomState] = useState({ identity, value: 1 });
  const [loadState, setLoadState] = useState<{ identity: string; status: MediaLoadStatus }>({
    identity,
    status: safeSrc ? "loading" : "error",
  });
  const [reloadState, setReloadState] = useState({ identity, key: 0 });
  const [downloadState, setDownloadState] = useState<{
    identity: string;
    loading: boolean;
    message: string | null;
    error: boolean;
  }>({ identity, loading: false, message: null, error: false });
  const downloadRequestRef = useRef(0);
  const downloadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    return () => { if (video) { video.pause(); releaseMessageAudio(video); } };
  }, [identity, isOpen]);
  useEffect(() => () => {
    downloadRequestRef.current += 1;
    downloadControllerRef.current?.abort();
  }, [identity, isOpen]);

  const zoom = zoomState.identity === identity ? zoomState.value : 1;
  const loadStatus = source.loading ? "loading" : !safeSrc
    ? "error"
    : loadState.identity === identity
      ? loadState.status
      : "loading";
  const reloadKey = reloadState.identity === identity ? reloadState.key : 0;
  const activeDownloadState = downloadState.identity === identity
    ? downloadState
    : { identity, loading: false, message: null, error: false };

  const setZoom = (value: number) => {
    setZoomState({ identity, value: Math.min(Math.max(value, 0.5), 3) });
  };

  const handleRetry = async () => {
    if (!safeSrc && !onRefreshMedia) return;
    const requestId = ++downloadRequestRef.current;
    downloadControllerRef.current?.abort();
    try {
      if (onRefreshMedia && !await onRefreshMedia()) return;
    } catch { return; }
    if (requestId !== downloadRequestRef.current) return;
    setLoadState({ identity, status: "loading" });
    setReloadState({ identity, key: reloadKey + 1 });
    setDownloadState({ identity, loading: false, message: null, error: false });
  };

  const handleClose = () => {
    downloadRequestRef.current += 1;
    downloadControllerRef.current?.abort();
    setZoomState({ identity, value: 1 });
    setLoadState({ identity, status: safeSrc ? "loading" : "error" });
    setDownloadState({ identity, loading: false, message: null, error: false });
    setSelection({ scopeKey: galleryScopeKey, originId: messageId, id: messageId, isOpen });
    onClose();
  };
  const navigateGallery = (delta: -1 | 1) => {
    const neighbor = getMessageMediaGalleryNeighbor(gallery, selected.id, delta);
    if (!neighbor) return;
    videoRef.current?.pause();
    downloadRequestRef.current += 1;
    downloadControllerRef.current?.abort();
    setSelection({ scopeKey: galleryScopeKey, originId: messageId, id: neighbor.id, isOpen });
  };

  const handleDownload = async () => {
    if (!safeSrc || activeDownloadState.loading) return;
    const requestId = ++downloadRequestRef.current;
    const controller = new AbortController();
    downloadControllerRef.current?.abort();
    downloadControllerRef.current = controller;
    setDownloadState({ identity, loading: true, message: null, error: false });

    try {
      const result = await downloadMessageMedia({
        url: safeSrc,
        kind: type,
        filename: safeFilename,
        signal: controller.signal,
      });
      if (requestId !== downloadRequestRef.current) return;
      setDownloadState({
        identity,
        loading: false,
        message: result === "opened"
          ? "Link aberto em outra aba. Confira se o download foi iniciado."
          : "Download iniciado.",
        error: false,
      });
    } catch (error) {
      if (requestId !== downloadRequestRef.current) return;
      setDownloadState({
        identity,
        loading: false,
        message: error instanceof Error ? error.message : "Não foi possível baixar esta mídia.",
        error: true,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="h-[95dvh] w-[95vw] max-w-[95vw] overflow-hidden rounded-[8px] border-0 bg-[var(--app-media-backdrop)] p-0 shadow-none [&>button]:hidden"
        onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); handleClose(); }}
        onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); handleClose(); } }}
        onKeyDown={(event) => {
          if (!isOpen || event.target instanceof HTMLElement && event.target.closest("input,textarea,video,[role=slider]")) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); event.stopPropagation(); navigateGallery(event.key === "ArrowLeft" ? -1 : 1);
        }}>
        <DialogTitle className="sr-only">{safeFilename || "Visualizar mídia"}</DialogTitle>
        <DialogDescription className="sr-only">
          Visualizador de {type === "image" ? "imagem" : "vídeo"} recebido pelo WhatsApp.
        </DialogDescription>

        <div className="relative flex h-full w-full flex-col">
          <div data-media-viewer-toolbar className="absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2 sm:items-center sm:p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
              {gallery.length > 1 && <>
                <Button type="button" variant="ghost" size="icon" aria-label="Mídia anterior" disabled={!getMessageMediaGalleryNeighbor(gallery, selected.id, -1)} onClick={() => navigateGallery(-1)} className="h-8 w-8 shrink-0 rounded-[6px] text-xs font-light text-white hover:bg-white/10 hover:text-white sm:h-10 sm:w-10"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
                <span className="whitespace-nowrap text-xs text-white" role="status">{gallery.findIndex((item) => item.id === selected.id) + 1} de {gallery.length}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Próxima mídia" disabled={!getMessageMediaGalleryNeighbor(gallery, selected.id, 1)} onClick={() => navigateGallery(1)} className="h-8 w-8 shrink-0 rounded-[6px] text-xs font-light text-white hover:bg-white/10 hover:text-white sm:h-10 sm:w-10"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
              </>}
              {type === "image" && loadStatus === "ready" && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-[6px] bg-[var(--app-overlay-soft)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)] sm:h-10 sm:w-10"
                    onClick={() => setZoom(zoom - 0.25)}
                    disabled={zoom <= 0.5}
                    aria-label="Diminuir zoom"
                  >
                    <ZoomOut className="h-5 w-5" aria-hidden="true" />
                  </Button>
                  <span className="min-w-[2.25rem] text-center text-[12px] font-light text-white sm:min-w-[3rem]" aria-live="polite">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-[6px] bg-[var(--app-overlay-soft)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)] sm:h-10 sm:w-10"
                    onClick={() => setZoom(zoom + 0.25)}
                    disabled={zoom >= 3}
                    aria-label="Aumentar zoom"
                  >
                    <ZoomIn className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-[6px] bg-[var(--app-overlay-soft)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)] sm:h-10 sm:w-10"
              onClick={handleClose}
              aria-label="Fechar visualizador"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-auto px-2 pb-16 pt-14 sm:p-8">
            {source.loading ? null : loadStatus === "error" ? (
              <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white" role="alert">
                <AlertCircle className="h-10 w-10 opacity-70" aria-hidden="true" />
                <p className="text-[14px] font-normal">
                  {source.failed ? "Mídia indisponível" : safeSrc ? "Erro ao carregar mídia" : "Link de mídia inválido"}
                </p>
                <p className="text-[12px] font-light text-white/60">
                  {source.failed ? "Não foi possível abrir esta mídia. Confira suas permissões e tente atualizar o link." : safeSrc
                    ? "O arquivo pode estar corrompido, expirado ou temporariamente inacessível."
                    : "Este endereço não pode ser aberto com segurança."}
                </p>
                {(safeSrc || onRefreshMedia) && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-[6px] bg-[var(--app-media-control)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                        onClick={() => void handleRetry()}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Tentar novamente
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-[6px] bg-[var(--app-media-control)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                        onClick={() => void handleDownload()}
                        disabled={activeDownloadState.loading}
                      >
                        {activeDownloadState.loading
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {activeDownloadState.loading ? "Baixando..." : "Tentar baixar"}
                      </Button>
                    </div>
                    {activeDownloadState.message && (
                      <p
                        className={cn(
                          "text-[10px] font-light",
                          activeDownloadState.error ? "text-red-300" : "text-white/70",
                        )}
                        role={activeDownloadState.error ? "alert" : "status"}
                      >
                        {activeDownloadState.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : type === "image" ? (
              <button
                type="button"
                className="flex max-h-full max-w-full cursor-zoom-in items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                onClick={() => setZoom(zoom === 1 ? 1.25 : 1)}
                aria-label={zoom === 1 ? "Aumentar imagem" : "Restaurar zoom da imagem"}
              >
                <NextImage
                  key={`${identity}-${reloadKey}`}
                  src={safeSrc!}
                  alt={filename ? `Visualização de ${safeFilename}` : "Imagem recebida"}
                  width={1200}
                  height={900}
                  sizes="95vw"
                  className={cn(
                    "max-h-[80dvh] max-w-full object-contain transition-transform duration-200",
                    zoom !== 1 && "cursor-zoom-out",
                  )}
                  style={{ transform: `scale(${zoom})` }}
                  onLoad={() => setLoadState({ identity, status: "ready" })}
                  onError={() => setLoadState({ identity, status: "error" })}
                  unoptimized
                />
              </button>
            ) : (
              <video
                ref={videoRef}
                key={`${identity}-${videoPlayback.generation}-${reloadKey}`}
                src={videoPlayback.url!}
                controls
                playsInline
                preload="metadata"
                className="max-h-[80dvh] max-w-full"
                onLoadedData={() => setLoadState(current => current.identity === identity && current.status === "error"
                  ? current : { identity, status: "ready" })}
                {...videoPlayback.nativeEvents(() => setLoadState({ identity, status: "error" }))}
                onError={(event) => {
                  if (videoPlayback.recoverRotatedSource(event.currentTarget)) return;
                  videoPlayback.stop(event.currentTarget);
                  setLoadState({ identity, status: "error" });
                }}
                aria-label={filename ? `Visualização de ${safeFilename}` : "Vídeo recebido"}
              />
            )}

            {loadStatus === "loading" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--app-overlay)] text-[var(--app-on-media)]" role="status">
                <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-media-scrim)] px-3 py-2 text-[12px] font-light">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Carregando mídia...
                </div>
              </div>
            )}
          </div>

          {safeSrc && loadStatus !== "error" && (
            <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 sm:p-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-[6px] bg-[var(--app-media-control)] text-xs font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                onClick={() => void handleDownload()}
                disabled={activeDownloadState.loading}
              >
                {activeDownloadState.loading
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
                {activeDownloadState.loading ? "Baixando..." : "Baixar"}
              </Button>
              {activeDownloadState.message && (
                <p
                  className={cn(
                    "text-[10px] font-light",
                    activeDownloadState.error ? "text-red-300" : "text-white/70",
                  )}
                  role={activeDownloadState.error ? "alert" : "status"}
                >
                  {activeDownloadState.message}
                </p>
              )}
              {activeDownloadState.error && onRefreshMedia && (
                <Button type="button" variant="secondary" size="sm" className="rounded-[6px] text-xs font-light" onClick={() => void handleRetry()}>
                  Atualizar link da mídia
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
