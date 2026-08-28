import { useRef, useState } from "react";
import NextImage from "next/image";
import { AlertCircle, Download, Loader2, RefreshCw, X, ZoomIn, ZoomOut } from "lucide-react";

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

interface MediaViewerProps {
  src: string;
  type: "image" | "video";
  isOpen: boolean;
  onClose: () => void;
  filename?: string;
}

type MediaLoadStatus = "loading" | "ready" | "error";

export function MediaViewer({ src, type, isOpen, onClose, filename }: MediaViewerProps) {
  const safeSrc = getSafeMessageMediaUrl(src, type);
  const identity = `${type}:${safeSrc || "invalid"}`;
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

  const zoom = zoomState.identity === identity ? zoomState.value : 1;
  const loadStatus = !safeSrc
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

  const handleRetry = () => {
    if (!safeSrc) return;
    downloadRequestRef.current += 1;
    setLoadState({ identity, status: "loading" });
    setReloadState({ identity, key: reloadKey + 1 });
    setDownloadState({ identity, loading: false, message: null, error: false });
  };

  const handleClose = () => {
    downloadRequestRef.current += 1;
    setZoomState({ identity, value: 1 });
    setLoadState({ identity, status: safeSrc ? "loading" : "error" });
    setDownloadState({ identity, loading: false, message: null, error: false });
    onClose();
  };

  const handleDownload = async () => {
    if (!safeSrc || activeDownloadState.loading) return;
    const requestId = ++downloadRequestRef.current;
    setDownloadState({ identity, loading: true, message: null, error: false });

    try {
      const result = await downloadMessageMedia({
        url: safeSrc,
        kind: type,
        filename: safeFilename,
      });
      if (requestId !== downloadRequestRef.current) return;
      setDownloadState({
        identity,
        loading: false,
        message: result === "opened"
          ? "Arquivo aberto em uma nova aba para download."
          : "Download iniciado.",
        error: false,
      });
    } catch {
      if (requestId !== downloadRequestRef.current) return;
      setDownloadState({
        identity,
        loading: false,
        message: "Não foi possível baixar esta mídia.",
        error: true,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="h-[95dvh] w-[95vw] max-w-[95vw] overflow-hidden rounded-[8px] border-0 bg-[var(--app-media-backdrop)] p-0 shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">{safeFilename || "Visualizar mídia"}</DialogTitle>
        <DialogDescription className="sr-only">
          Visualizador de {type === "image" ? "imagem" : "vídeo"} recebido pelo WhatsApp.
        </DialogDescription>

        <div className="relative flex h-full w-full flex-col">
          <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2 sm:p-4">
            <div className="flex items-center gap-1 sm:gap-2">
              {type === "image" && loadStatus === "ready" && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-[6px] bg-[var(--app-overlay-soft)] text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)]"
                    onClick={() => setZoom(zoom - 0.25)}
                    disabled={zoom <= 0.5}
                    aria-label="Diminuir zoom"
                  >
                    <ZoomOut className="h-5 w-5" aria-hidden="true" />
                  </Button>
                  <span className="min-w-[3rem] text-center text-[12px] font-light text-white" aria-live="polite">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-[6px] bg-[var(--app-overlay-soft)] text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)]"
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
              className="rounded-[6px] bg-[var(--app-overlay-soft)] text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-scrim)] hover:text-[var(--app-on-media)]"
              onClick={handleClose}
              aria-label="Fechar visualizador"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-auto px-2 pb-16 pt-14 sm:p-8">
            {loadStatus === "error" ? (
              <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white" role="alert">
                <AlertCircle className="h-10 w-10 opacity-70" aria-hidden="true" />
                <p className="text-[14px] font-normal">
                  {safeSrc ? "Erro ao carregar mídia" : "Link de mídia inválido"}
                </p>
                <p className="text-[12px] font-light text-white/60">
                  {safeSrc
                    ? "O arquivo pode estar corrompido, expirado ou temporariamente inacessível."
                    : "Este endereço não pode ser aberto com segurança."}
                </p>
                {safeSrc && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-[6px] bg-[var(--app-media-control)] font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                        onClick={handleRetry}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Tentar novamente
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-[6px] bg-[var(--app-media-control)] font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                        onClick={() => void handleDownload()}
                        disabled={activeDownloadState.loading}
                      >
                        {activeDownloadState.loading
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
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
                key={`${identity}-${reloadKey}`}
                src={safeSrc!}
                controls
                playsInline
                preload="metadata"
                className="max-h-[80dvh] max-w-full"
                onLoadedData={() => setLoadState({ identity, status: "ready" })}
                onError={() => setLoadState({ identity, status: "error" })}
                aria-label={filename ? `Visualização de ${safeFilename}` : "Vídeo recebido"}
              />
            )}

            {loadStatus === "loading" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--app-overlay)] text-[var(--app-on-media)]" role="status">
                <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-media-scrim)] px-3 py-2 text-[12px] font-light">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
                className="rounded-[6px] bg-[var(--app-media-control)] font-light text-[var(--app-on-media)] shadow-none hover:bg-[var(--app-media-control-hover)] hover:text-[var(--app-on-media)]"
                onClick={() => void handleDownload()}
                disabled={activeDownloadState.loading}
              >
                {activeDownloadState.loading
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
